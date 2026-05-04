#!/usr/bin/env python3
"""
NVR-SPEC-022 — Edge calculator: smart-money candidates vs null distribution

For each candidate wallet from observation-analyze, compute:
  appearance_rate_in_move_prewindows   (signal)
  appearance_rate_in_null_windows      (baseline)
  edge = signal - baseline

Wallets with positive edge AND adequate sample count are the
forward-validated smart-money seed list — pre-window appearance is
predictive of an upcoming move, not just a sign of being active.

Run:
  python3 scripts/observation-edge.py
"""

from collections import defaultdict
from pathlib import Path
import json

DATA_DIR = Path(__file__).parent.parent / "data" / "observation-pass"
TOKENS = ["AERO", "BRETT", "DEGEN"]


def load_per_token():
    out = {}
    for s in TOKENS:
        moves_path = DATA_DIR / f"2026-04-29-{s}-moves.json"
        null_path = DATA_DIR / f"2026-04-29-{s}-null-windows.json"
        # Volume-weighted null is opt-in (added 2026-05-04 per FINDING_2026-05-04
        # Lesson 1). If absent, edge calc falls back to random-null only with a
        # printed warning so the operator knows the baseline is loose.
        vol_null_path = DATA_DIR / f"2026-05-04-{s}-volume-null-windows.json"
        if not moves_path.exists() or not null_path.exists():
            print(f"  ⚠ missing data for {s}")
            continue
        per_tok = {
            "moves": json.load(open(moves_path)),
            "null": json.load(open(null_path)),
            "volNull": None,
        }
        if vol_null_path.exists():
            per_tok["volNull"] = json.load(open(vol_null_path))
        else:
            print(
                f"  ⚠ {s}: no volume-null file at {vol_null_path.name} — "
                f"edge will use random-null only (looser baseline). Run "
                f"`npx tsx scripts/observation-volume-null.ts` to tighten."
            )
        out[s] = per_tok
    return out


def build_wallet_table(data):
    """
    Returns:
      {
        wallet: {
          symbol: {
            "moveHits": int,           # # of move pre-windows this wallet was a top-buyer in
            "moveCount": int,
            "nullHits": int,           # # of null windows this wallet was a top-buyer in
            "nullCount": int,
            "moveDirections": [{"date","pct"}],  # which moves did they precede
          }
        }
      }
    """
    wallet_data = defaultdict(lambda: {
        s: {
            "moveHits": 0, "moveCount": 0,
            "nullHits": 0, "nullCount": 0,
            "volNullHits": 0, "volNullCount": 0,
            "moveDirections": [],
        }
        for s in data.keys()
    })

    for sym, d in data.items():
        moves = d["moves"]["moves"]
        null_windows = d["null"]["windows"]
        vol_null_windows = (d.get("volNull") or {}).get("windows") or []

        # Move pre-window hits
        for m in moves:
            ax = m.get("preWindowAxes") or {}
            top = ax.get("topUserBuyers") or []
            for tb in top:
                wallet_data[tb["wallet"]][sym]["moveHits"] += 1
                wallet_data[tb["wallet"]][sym]["moveDirections"].append({
                    "date": m["anchorCloseISO"],
                    "pct": m["pctChange"],
                })

        # Set move count for ALL wallets that appear in this token's data
        for w in wallet_data:
            wallet_data[w][sym]["moveCount"] = len(moves)

        # Random-null hits
        for nw in null_windows:
            top = nw.get("topUserBuyers") or []
            for tb in top:
                wallet_data[tb["wallet"]][sym]["nullHits"] += 1
        for w in wallet_data:
            wallet_data[w][sym]["nullCount"] = len(null_windows)

        # Volume-weighted-null hits (Lesson 1, FINDING_2026-05-04).
        # Empty list when the volume-null pass hasn't been run yet.
        for nw in vol_null_windows:
            top = nw.get("topUserBuyers") or []
            for tb in top:
                wallet_data[tb["wallet"]][sym]["volNullHits"] += 1
        for w in wallet_data:
            wallet_data[w][sym]["volNullCount"] = len(vol_null_windows)

    return wallet_data


def main():
    print("=" * 100)
    print("NVR-SPEC-022 — EDGE COMPUTATION (move pre-window appearance vs null)")
    print("=" * 100)

    data = load_per_token()
    wallet_data = build_wallet_table(data)

    # Compute aggregate edge across all 3 tokens.
    # Edge baseline = max(random_null_rate, volume_null_rate). The volume-null
    # rate dominates when an actor is correlated with high activity (the
    # P-IntermediarySurge artifact); the random-null rate dominates for low-
    # activity actors. Using max() makes both classes of artifact catchable.
    rows = []
    for w, by_sym in wallet_data.items():
        total_move_hits = sum(s["moveHits"] for s in by_sym.values())
        total_move_count = sum(s["moveCount"] for s in by_sym.values())
        total_null_hits = sum(s["nullHits"] for s in by_sym.values())
        total_null_count = sum(s["nullCount"] for s in by_sym.values())
        total_vol_null_hits = sum(s["volNullHits"] for s in by_sym.values())
        total_vol_null_count = sum(s["volNullCount"] for s in by_sym.values())

        if total_move_count == 0 or total_null_count == 0:
            continue

        move_rate = total_move_hits / total_move_count
        null_rate = total_null_hits / total_null_count
        vol_null_rate = (
            total_vol_null_hits / total_vol_null_count
            if total_vol_null_count > 0 else 0.0
        )
        # Tighter baseline (Lesson 1, FINDING_2026-05-04)
        baseline = max(null_rate, vol_null_rate)
        edge = move_rate - baseline

        # Direction distribution from moves
        all_dirs = []
        for s in by_sym.values():
            all_dirs.extend(s["moveDirections"])
        ups = sum(1 for d in all_dirs if d["pct"] > 0)
        downs = len(all_dirs) - ups

        # Token coverage
        tokens_active = sum(
            1 for s in by_sym.values() if s["moveHits"] > 0 or s["nullHits"] > 0
        )
        tokens_in_moves = sum(1 for s in by_sym.values() if s["moveHits"] > 0)

        rows.append({
            "wallet": w,
            "moveHits": total_move_hits,
            "moveCount": total_move_count,
            "moveRate": move_rate,
            "nullHits": total_null_hits,
            "nullCount": total_null_count,
            "nullRate": null_rate,
            "volNullHits": total_vol_null_hits,
            "volNullCount": total_vol_null_count,
            "volNullRate": vol_null_rate,
            "baselineUsed": baseline,
            "edge": edge,
            "ups": ups,
            "downs": downs,
            "winRate": ups / max(1, ups + downs),
            "tokensInMoves": tokens_in_moves,
            "tokensActive": tokens_active,
        })

    # ----- Filter: must appear in >= 3 move pre-windows AND have positive edge
    filtered = [
        r for r in rows
        if r["moveHits"] >= 3 and r["edge"] > 0
    ]
    filtered.sort(key=lambda r: -r["edge"])

    print(f"\n{len(filtered)} wallets with ≥3 move-prewindow appearances AND positive edge over MAX(null, vol-null):\n")
    print(f"  {'Wallet':<44}  {'mvHit':>5} {'mvRate':>7} {'nlRate':>7} {'vNlRt':>6} {'base':>6} {'edge':>7} {'ups/dn':>7} {'win':>5} {'tkns':>5}")
    print(f"  {'-'*44}  {'-'*5} {'-'*7} {'-'*7} {'-'*6} {'-'*6} {'-'*7} {'-'*7} {'-'*5} {'-'*5}")
    for r in filtered[:50]:
        print(
            f"  {r['wallet']:<44}  {r['moveHits']:>5d} "
            f"{r['moveRate']*100:>6.1f}% {r['nullRate']*100:>6.1f}% "
            f"{r['volNullRate']*100:>5.1f}% {r['baselineUsed']*100:>5.1f}% "
            f"{r['edge']*100:>+6.1f}% {r['ups']}/{r['downs']:<3d} "
            f"{r['winRate']*100:>4.0f}% {r['tokensInMoves']:>5d}"
        )

    # Statistical filter: must be SIGNIFICANT
    # For each row, compute z-score: (move_rate - null_rate) / sqrt(p(1-p)/n)
    # where p is the pooled rate across both, n is total trials.
    import math
    print(f"\n--- Statistical significance ---\n")
    print(f"  {'Wallet':<44}  {'edge':>7} {'p-pool':>7} {'z':>5} {'sig':>6}")
    print(f"  {'-'*44}  {'-'*7} {'-'*7} {'-'*5} {'-'*6}")
    significant = []
    for r in filtered:
        # 2-proportion z-test against the TIGHTER of the two null distributions.
        # Picks the null with higher rate as the more conservative comparison.
        n1 = r["moveCount"]
        p1 = r["moveRate"]
        if r["volNullRate"] >= r["nullRate"] and r["volNullCount"] > 0:
            n2 = r["volNullCount"]
            p2 = r["volNullRate"]
            hits2 = r["volNullHits"]
        else:
            n2 = r["nullCount"]
            p2 = r["nullRate"]
            hits2 = r["nullHits"]
        p_pool = (r["moveHits"] + hits2) / (n1 + n2)
        denom = math.sqrt(p_pool * (1 - p_pool) * (1/n1 + 1/n2)) if p_pool > 0 else 0
        z = (p1 - p2) / denom if denom > 0 else 0
        sig = "***" if z >= 3 else ("**" if z >= 2 else ("*" if z >= 1.5 else ""))
        if z >= 1.5:
            significant.append({**r, "zScore": z, "sigTier": sig})
    significant.sort(key=lambda r: -r["zScore"])
    for r in significant[:30]:
        print(
            f"  {r['wallet']:<44}  "
            f"{r['edge']*100:>+6.1f}% "
            f"{(r['moveHits']+r['nullHits'])/(r['moveCount']+r['nullCount'])*100:>6.1f}% "
            f"{r['zScore']:>4.1f} {r['sigTier']:>6}"
        )

    # Persist
    out_path = DATA_DIR / "smart-money-validated.json"
    payload = {
        "all": filtered,
        "significant": significant,
        "criteriaNote": (
            "Two-proportion z-test of move-prewindow appearance rate vs null-window rate. "
            "z >= 1.5 = *, z >= 2 = ** (95%), z >= 3 = *** (99.7%). "
            "Hits = wallet appeared in topUserBuyers (top-10 by USD). "
            "Trials = number of windows examined."
        ),
    }
    json.dump(payload, open(out_path, "w"), indent=2)
    print(f"\n✓ Wrote {len(filtered)} candidates ({len(significant)} significant) to {out_path}")


if __name__ == "__main__":
    main()
