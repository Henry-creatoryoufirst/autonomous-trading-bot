#!/usr/bin/env python3
"""
NVR-SPEC-022 — Pattern P-IntermediarySurge live verdict

Reads the JSONL output of `observation-forward-harness.ts` and computes
the live ship/kill metrics:

  hit_rate          target >= 40%   (clusters with +3% move in next 60min)
  fp_rate           target <= 30%   (clusters with |move| < 3% in next 60min)
  sample size n     target >= 15    (number of measured cluster triggers)
  time-to-target    when does sample size reach 15?

Decision matrix:
    n >= 15 AND hit_rate >= 40% AND fp_rate <= 30%   → SHIP candidate
    n >= 15 AND hit_rate < 40%                       → KILL
    n < 15                                            → keep watching

Per-tier breakdown (tier-1 only, tier-1+2, all) so we can isolate where
edge concentrates if the aggregate is mixed.

Run:
  python3 scripts/observation-verdict.py
  python3 scripts/observation-verdict.py --since 2026-04-29
"""

import argparse
import json
import statistics
import sys
from pathlib import Path
from collections import Counter, defaultdict

DATA_DIR = Path(__file__).parent.parent / "data" / "observation-pass" / "forward"


def load_jsonl(path: Path):
    if not path.exists():
        return []
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default=None, help="UTC date (YYYY-MM-DD) to start aggregation")
    args = ap.parse_args()

    if not DATA_DIR.exists():
        print(f"  No data dir at {DATA_DIR} yet — harness hasn't written any output.")
        sys.exit(0)

    # Load all daily files
    triggers = []
    outcomes = []
    events = []
    for p in sorted(DATA_DIR.glob("*-triggers.jsonl")):
        if args.since and p.name[:10] < args.since:
            continue
        triggers.extend(load_jsonl(p))
    for p in sorted(DATA_DIR.glob("*-outcomes.jsonl")):
        if args.since and p.name[:10] < args.since:
            continue
        outcomes.extend(load_jsonl(p))
    for p in sorted(DATA_DIR.glob("*-events.jsonl")):
        if args.since and p.name[:10] < args.since:
            continue
        events.extend(load_jsonl(p))

    print("=" * 90)
    print("Pattern P-IntermediarySurge — Live Verdict")
    if args.since:
        print(f"  Since: {args.since}")
    print("=" * 90)
    print()
    print(f"  Raw events:     {len(events):>4}  (intermediary buys observed)")
    print(f"  Cluster triggers: {len(triggers):>4}  (>= 2 intermediaries within 30min)")
    print(f"  Outcomes measured: {len(outcomes):>4}  (60min after each trigger)")
    print()

    if len(events) == 0:
        print("  No events yet. The harness needs runtime to accumulate observations.")
        return

    # Per-token event distribution
    print("Events by token:")
    by_tok = Counter(e.get("tokenSymbol", "?") for e in events)
    for tok, n in by_tok.most_common():
        print(f"    {tok:<8} {n:>5}")
    print()

    # Per-intermediary event count
    print("Events by intermediary (top 10):")
    by_int = Counter(e.get("intermediary", "?") for e in events)
    for addr, n in by_int.most_common(10):
        tier = next((e.get("tier") for e in events if e.get("intermediary") == addr), "?")
        print(f"    T{tier} {addr}  {n:>5}")
    print()

    if len(outcomes) == 0:
        print("  No outcomes yet — triggers fired but waiting on +60min measurement.")
        if len(triggers) > 0:
            print(f"  {len(triggers)} pending.")
        return

    # Hit / FP / null rate
    hits = sum(1 for o in outcomes if o.get("hit") is True)
    fps = sum(1 for o in outcomes if o.get("fp") is True)
    measured = sum(1 for o in outcomes if o.get("pctChange") is not None)
    if measured == 0:
        print("  Outcomes recorded but no price-resolved measurements (price feed gap).")
        return

    pcts = [o["pctChange"] for o in outcomes if o.get("pctChange") is not None]
    avg = statistics.mean(pcts)
    med = statistics.median(pcts)
    min_p = min(pcts) if pcts else 0
    max_p = max(pcts) if pcts else 0

    hit_rate = hits / measured
    fp_rate = fps / measured

    print("Outcome distribution:")
    print(f"  HIT (>= +3% in 60min):     {hits:>3} / {measured:>3} = {hit_rate*100:.1f}%   [target >= 40%]")
    print(f"  FP  (|move| < 3% in 60min): {fps:>3} / {measured:>3} = {fp_rate*100:.1f}%   [target <= 30%]")
    print(f"  Avg move: {avg*100:+.2f}%   Median: {med*100:+.2f}%   Range: [{min_p*100:+.2f}%, {max_p*100:+.2f}%]")
    print()

    # Per-tier breakdown
    print("By tier composition of trigger:")
    tier_breakdown = defaultdict(lambda: {"n": 0, "hits": 0, "fps": 0})
    trig_by_id = {t.get("triggerId"): t for t in triggers}
    for o in outcomes:
        if o.get("pctChange") is None:
            continue
        t = trig_by_id.get(o.get("triggerId"))
        if not t:
            continue
        tiers = [i.get("tier") for i in t.get("intermediariesFired", [])]
        # Categorize
        has_t1 = "1" in tiers
        only_t3 = all(t == "3" for t in tiers) if tiers else False
        bucket = "T1+" if has_t1 else ("T2/3 mix" if not only_t3 else "T3 only")
        slot = tier_breakdown[bucket]
        slot["n"] += 1
        if o.get("hit"): slot["hits"] += 1
        if o.get("fp"): slot["fps"] += 1
    for bucket in ["T1+", "T2/3 mix", "T3 only"]:
        s = tier_breakdown[bucket]
        if s["n"] == 0:
            print(f"    {bucket:<10}  n=0")
            continue
        hr = s["hits"] / s["n"]
        fr = s["fps"] / s["n"]
        print(f"    {bucket:<10}  n={s['n']:>3}  hit={hr*100:.0f}%  fp={fr*100:.0f}%")
    print()

    # Verdict
    print("=" * 90)
    print("VERDICT")
    print("=" * 90)
    if measured < 15:
        days_so_far = (max(o.get("measuredAtTs", 0) for o in outcomes) - min(o.get("measuredAtTs", 0) for o in outcomes)) / 86400 if measured >= 2 else 0
        rate_per_day = measured / max(0.1, days_so_far)
        eta_days = (15 - measured) / max(0.1, rate_per_day) if rate_per_day > 0 else "unknown"
        print(f"  KEEP WATCHING — sample size {measured} < 15.")
        print(f"  Current rate: {rate_per_day:.1f} measured triggers/day. ETA to n=15: ~{eta_days:.1f} days." if isinstance(eta_days, float) else f"  ETA to n=15: {eta_days}")
    elif hit_rate >= 0.40 and fp_rate <= 0.30:
        print(f"  ✅ SHIP CANDIDATE — n={measured}, hit={hit_rate*100:.0f}% (≥40%), fp={fp_rate*100:.0f}% (≤30%)")
        print(f"  Pattern P-IntermediarySurge meets validation criteria.")
        print(f"  Next: bring to staging via the runtime carve-out path in SPEC-022 §6.")
    elif hit_rate < 0.40:
        print(f"  ❌ KILL — n={measured} sufficient but hit={hit_rate*100:.0f}% < 40%.")
        print(f"  The pattern fires but doesn't predict moves at the required rate.")
        print(f"  The morning's z-test was correct about correlation; live data shows it's not actionable.")
    else:
        print(f"  ⚠ MIXED — n={measured}, hit={hit_rate*100:.0f}%, fp={fp_rate*100:.0f}%")
        print(f"  Consider tightening: T1-only trigger, larger sleeve, or higher MIN_INTERMEDIARIES.")


if __name__ == "__main__":
    main()
