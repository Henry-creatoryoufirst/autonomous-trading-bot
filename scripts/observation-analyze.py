#!/usr/bin/env python3
"""
NVR-SPEC-022 — Observation pass deep analysis

Reads the per-token JSON dumps from observation-pass-base.ts and produces
the signature analysis: recurring buyers, time-concentration patterns,
volume-tier distributions, and candidate pattern hypotheses.

Run:
  python3 scripts/observation-analyze.py
"""

from collections import defaultdict, Counter
from pathlib import Path
import json
import statistics

DATA_DIR = Path(__file__).parent.parent / "data" / "observation-pass"

# ----------------------------------------------------------------------------
# Load all per-token data
# ----------------------------------------------------------------------------

def load_all():
    out = {}
    for path in sorted(DATA_DIR.glob("*-moves.json")):
        if "-summary" in path.name:
            continue
        # filename: 2026-04-29-AERO-moves.json
        parts = path.stem.split("-")
        symbol = parts[3]  # 2026 04 29 AERO moves
        out[symbol] = json.load(open(path))
    return out


def median(xs):
    xs = [x for x in xs if x is not None]
    if not xs: return 0
    return statistics.median(xs)


def percentile(xs, p):
    xs = sorted(x for x in xs if x is not None)
    if not xs: return 0
    idx = max(0, min(len(xs) - 1, int(p * len(xs))))
    return xs[idx]


# ----------------------------------------------------------------------------
# Analysis 1: Recurring buyers across moves
# ----------------------------------------------------------------------------

def analyze_recurring_buyers(symbol, moves):
    print(f"\n=== {symbol}: Recurring buyers (appeared in multiple pre-windows) ===")

    # Track each wallet's appearances
    walletAppearances = defaultdict(lambda: {
        "appearances": 0,
        "totalUsd": 0,
        "buyCount": 0,
        "movesPreceded": [],  # (date, direction, magnitude)
    })

    for m in moves:
        ax = m.get('preWindowAxes') or {}
        for tb in (ax.get('topUserBuyers') or []):
            w = tb['wallet']
            walletAppearances[w]["appearances"] += 1
            walletAppearances[w]["totalUsd"] += tb['totalUsd']
            walletAppearances[w]["buyCount"] += tb['buyCount']
            walletAppearances[w]["movesPreceded"].append({
                "date": m['anchorCloseISO'],
                "dir": "↑" if m['pctChange'] > 0 else "↓",
                "pct": m['pctChange'],
            })

    recurring = sorted(
        [(w, info) for w, info in walletAppearances.items() if info["appearances"] >= 2],
        key=lambda x: -x[1]["appearances"],
    )

    if not recurring:
        print("  No wallets appeared in >= 2 pre-windows (top-10 only).")
        return []

    print(f"  {len(recurring)} wallets appeared in >= 2 pre-windows (out of {len(moves)} moves).")
    print(f"  {'Wallet':<44} {'Appears':>8} {'Total $':>14} {'Buys':>6} {'Up→':>6} {'Down→':>6}")
    print(f"  {'-'*44} {'-'*8} {'-'*14} {'-'*6} {'-'*6} {'-'*6}")
    for w, info in recurring[:30]:
        ups = sum(1 for m in info["movesPreceded"] if m["pct"] > 0)
        downs = len(info["movesPreceded"]) - ups
        print(f"  {w:<44} {info['appearances']:>8} ${info['totalUsd']:>13,.0f} {info['buyCount']:>6} {ups:>6} {downs:>6}")

    return recurring


# ----------------------------------------------------------------------------
# Analysis 2: Pre-window volume tiers vs direction
# ----------------------------------------------------------------------------

def analyze_volume_signal(symbol, moves):
    print(f"\n=== {symbol}: User pre-window volume vs move direction ===")

    if not moves: return

    user_vols = [(m.get('preWindowAxes') or {}).get('userBuyVolumeUsd', 0) for m in moves]

    p25 = percentile(user_vols, 0.25)
    p50 = percentile(user_vols, 0.50)
    p75 = percentile(user_vols, 0.75)
    p90 = percentile(user_vols, 0.90)

    print(f"  User-vol distribution: p25=${p25:,.0f}, p50=${p50:,.0f}, p75=${p75:,.0f}, p90=${p90:,.0f}")

    # Categorize moves by pre-window vol tier
    tiers = {
        "low (<p25)": [],
        "med (p25-p75)": [],
        "high (p75-p90)": [],
        "very-high (>p90)": [],
    }
    for m in moves:
        v = (m.get('preWindowAxes') or {}).get('userBuyVolumeUsd', 0)
        if v < p25: tiers["low (<p25)"].append(m)
        elif v < p75: tiers["med (p25-p75)"].append(m)
        elif v < p90: tiers["high (p75-p90)"].append(m)
        else: tiers["very-high (>p90)"].append(m)

    print(f"  {'Tier':<22} {'n':>4} {'%up':>6} {'medΔ':>8}")
    print(f"  {'-'*22} {'-'*4} {'-'*6} {'-'*8}")
    for tier, ms in tiers.items():
        if not ms: continue
        ups = sum(1 for m in ms if m['pctChange'] > 0)
        med_delta = median([m['pctChange']*100 for m in ms])
        print(f"  {tier:<22} {len(ms):>4} {100*ups/len(ms):>5.0f}% {med_delta:>+7.1f}%")


# ----------------------------------------------------------------------------
# Analysis 3: Pre-window time-concentration (late vs early)
# ----------------------------------------------------------------------------

def analyze_time_concentration(symbol, moves):
    print(f"\n=== {symbol}: Pre-window time concentration (late vs early) ===")

    if not moves: return

    print(f"  {'Date':<22} {'Δ':>7} {'early':>8} {'mid':>8} {'late':>8} {'late_ratio':>11}")

    late_ratios_by_dir = {"up": [], "down": []}

    for m in moves:
        ax = m.get('preWindowAxes') or {}
        buckets = ax.get('buyBuckets') or []
        if not buckets: continue

        # Pre-window is 2h = 24x 5-min buckets. early=first 8, mid=next 8, late=last 8.
        # But we may have fewer buckets if buy activity is sparse.
        from_ts = ax.get('fromTs', 0)
        to_ts = ax.get('toTs', 0)
        if to_ts <= from_ts: continue
        third = (to_ts - from_ts) // 3
        early_end = from_ts + third
        mid_end = from_ts + 2 * third

        early_v = sum(b['userTotalAmountUsd'] for b in buckets if b['bucketStartTs'] < early_end)
        mid_v = sum(b['userTotalAmountUsd'] for b in buckets if early_end <= b['bucketStartTs'] < mid_end)
        late_v = sum(b['userTotalAmountUsd'] for b in buckets if b['bucketStartTs'] >= mid_end)
        total_v = early_v + mid_v + late_v
        late_ratio = late_v / total_v if total_v > 0 else 0

        d = "↑" if m['pctChange'] > 0 else "↓"
        print(f"  {m['anchorCloseISO']:<22} {m['pctChange']*100:>+6.1f}% ${early_v:>7,.0f} ${mid_v:>7,.0f} ${late_v:>7,.0f} {late_ratio:>10.2%}")

        if m['pctChange'] > 0: late_ratios_by_dir["up"].append(late_ratio)
        else: late_ratios_by_dir["down"].append(late_ratio)

    print()
    print(f"  Median late-third ratio (last 40min of 2h pre-window):")
    print(f"    UP moves (n={len(late_ratios_by_dir['up'])}):   {median(late_ratios_by_dir['up']):.2%}")
    print(f"    DOWN moves (n={len(late_ratios_by_dir['down'])}): {median(late_ratios_by_dir['down']):.2%}")
    print(f"  ({'>33% = back-loaded buying; <33% = early-loaded; ~33% = uniform'})")


# ----------------------------------------------------------------------------
# Analysis 4: Largest single user buy in pre-window
# ----------------------------------------------------------------------------

def analyze_largest_buy(symbol, moves):
    print(f"\n=== {symbol}: Largest single user buy in pre-window vs move direction ===")

    if not moves: return

    largest_by_dir = {"up": [], "down": []}

    print(f"  {'Date':<22} {'Δ':>7} {'#largest':>9} {'$/largest':>12}")
    for m in moves:
        ax = m.get('preWindowAxes') or {}
        largest = ax.get('largestUserBuys') or []
        if not largest:
            continue
        biggest = largest[0]['amountUsd'] or 0
        n_above_5k = sum(1 for b in largest if (b.get('amountUsd') or 0) > 5000)
        d = "↑" if m['pctChange'] > 0 else "↓"
        if m['pctChange'] > 0:
            largest_by_dir["up"].append(biggest)
        else:
            largest_by_dir["down"].append(biggest)
        print(f"  {m['anchorCloseISO']:<22} {m['pctChange']*100:>+6.1f}% {n_above_5k:>9} ${biggest:>11,.0f}")

    print()
    print(f"  Median largest-single-buy:")
    print(f"    UP moves:   ${median(largest_by_dir['up']):,.0f}")
    print(f"    DOWN moves: ${median(largest_by_dir['down']):,.0f}")


# ----------------------------------------------------------------------------
# Analysis 5: Forward-validated wallet seed list
# ----------------------------------------------------------------------------

def build_smart_money_seed_list(all_data):
    print(f"\n=== CROSS-TOKEN: Forward-validated wallet seed list ===")
    print(f"  Wallets that appeared in pre-windows of UP-moves across multiple tokens.")
    print(f"  This is the curated smart-money byproduct.")
    print()

    wallet_track = defaultdict(lambda: {
        "tokens": set(),
        "ups": 0,
        "downs": 0,
        "totalUsd": 0,
        "moveDates": [],
    })

    for symbol, data in all_data.items():
        for m in data['moves']:
            ax = m.get('preWindowAxes') or {}
            for tb in (ax.get('topUserBuyers') or []):
                w = tb['wallet']
                wallet_track[w]["tokens"].add(symbol)
                wallet_track[w]["totalUsd"] += tb['totalUsd']
                wallet_track[w]["moveDates"].append((symbol, m['anchorCloseISO'], m['pctChange']))
                if m['pctChange'] > 0: wallet_track[w]["ups"] += 1
                else: wallet_track[w]["downs"] += 1

    # Filter: appeared in >= 3 up-move pre-windows OR >= 2 tokens
    candidates = [
        (w, info) for w, info in wallet_track.items()
        if (info["ups"] >= 3) or (len(info["tokens"]) >= 2 and info["ups"] >= 2)
    ]
    candidates.sort(key=lambda x: (-x[1]["ups"], -x[1]["totalUsd"]))

    print(f"  {len(candidates)} candidate wallets (appeared before >=3 up-moves OR multi-token >=2 ups)")
    print()
    print(f"  {'Wallet':<44} {'Tokens':>8} {'Ups':>4} {'Downs':>6} {'Total $':>14} {'Win %':>6}")
    print(f"  {'-'*44} {'-'*8} {'-'*4} {'-'*6} {'-'*14} {'-'*6}")
    for w, info in candidates[:50]:
        win_rate = info["ups"] / max(1, info["ups"] + info["downs"])
        print(f"  {w:<44} {len(info['tokens']):>8} {info['ups']:>4} {info['downs']:>6} ${info['totalUsd']:>13,.0f} {win_rate*100:>5.0f}%")

    return candidates


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    all_data = load_all()
    print("=" * 90)
    print("NVR-SPEC-022 OBSERVATION PASS — Deep Analysis")
    print(f"Tokens loaded: {sorted(all_data.keys())}")
    for s, d in all_data.items():
        print(f"  {s}: {len(d['moves'])} moves")
    print("=" * 90)

    for symbol in sorted(all_data.keys()):
        data = all_data[symbol]
        moves = data['moves']
        if not moves:
            print(f"\n[{symbol}] no moves — skipping")
            continue
        analyze_volume_signal(symbol, moves)
        analyze_largest_buy(symbol, moves)
        analyze_time_concentration(symbol, moves)
        analyze_recurring_buyers(symbol, moves)

    candidates = build_smart_money_seed_list(all_data)

    # Persist seed list
    seedPath = DATA_DIR / "smart-money-seed-list.json"
    seed_data = [
        {
            "wallet": w,
            "tokens": sorted(info["tokens"]),
            "upMovesPreceded": info["ups"],
            "downMovesPreceded": info["downs"],
            "totalUsdInPreWindows": info["totalUsd"],
            "winRate": info["ups"] / max(1, info["ups"] + info["downs"]),
            "appearances": [
                {"token": d[0], "date": d[1], "pctChange": d[2]} for d in info["moveDates"]
            ],
        }
        for w, info in candidates
    ]
    json.dump(seed_data, open(seedPath, "w"), indent=2)
    print(f"\nWrote {len(seed_data)} candidates to {seedPath}")


if __name__ == "__main__":
    main()
