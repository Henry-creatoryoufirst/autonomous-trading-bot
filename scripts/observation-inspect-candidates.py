#!/usr/bin/env python3
"""
Inspect the top significant candidates — what do their BUY patterns look like?

For each, dump:
  - Pre-windows they appeared in (with direction)
  - Null windows they appeared in
  - Average buy size
  - Buy frequency
  - Cross-token presence
"""

from collections import defaultdict
from pathlib import Path
import json

DATA_DIR = Path(__file__).parent.parent / "data" / "observation-pass"
TOKENS = ["AERO", "BRETT", "DEGEN"]
TOP_N = 12

validated = json.load(open(DATA_DIR / "smart-money-validated.json"))
significant = validated["significant"]

per_token = {}
for s in TOKENS:
    moves = json.load(open(DATA_DIR / f"2026-04-29-{s}-moves.json"))
    nulls = json.load(open(DATA_DIR / f"2026-04-29-{s}-null-windows.json"))
    per_token[s] = {"moves": moves, "null": nulls}

print("=" * 100)
print("DEEP DIVE — top significant candidates")
print("=" * 100)

for r in significant[:TOP_N]:
    w = r["wallet"]
    print(f"\n--- {w}  (z={r['zScore']:.1f}, edge=+{r['edge']*100:.1f}%) ---")
    print(f"  Move appearances: {r['moveHits']}/{r['moveCount']}  ({r['moveRate']*100:.1f}%)")
    print(f"  Null appearances: {r['nullHits']}/{r['nullCount']}  ({r['nullRate']*100:.1f}%)")
    print(f"  Up→/Down→: {r['ups']}/{r['downs']}  Win-rate: {r['winRate']*100:.0f}%")
    print(f"  Tokens: {r['tokensInMoves']} (in moves)")

    # Per-token detail
    for s in TOKENS:
        moves = per_token[s]["moves"]["moves"]
        moveHits = []
        for m in moves:
            ax = m.get("preWindowAxes") or {}
            for tb in (ax.get("topUserBuyers") or []):
                if tb["wallet"] == w:
                    moveHits.append({
                        "date": m["anchorCloseISO"],
                        "pct": m["pctChange"],
                        "buyCount": tb["buyCount"],
                        "totalUsd": tb["totalUsd"],
                    })
        nullHits = []
        for nw in per_token[s]["null"]["windows"]:
            for tb in (nw.get("topUserBuyers") or []):
                if tb["wallet"] == w:
                    nullHits.append({
                        "fromTs": nw["fromTs"],
                        "buyCount": tb["buyCount"],
                    })
        if not moveHits and not nullHits:
            continue
        print(f"  {s}: moves {len(moveHits)}/{len(moves)}, nulls {len(nullHits)}/{len(per_token[s]['null']['windows'])}")
        if moveHits:
            avg_usd = sum(m["totalUsd"] for m in moveHits) / len(moveHits)
            avg_buys = sum(m["buyCount"] for m in moveHits) / len(moveHits)
            print(f"    move-window avg: {avg_buys:.1f} buys, ${avg_usd:,.0f} per window")
            for mh in moveHits[:5]:
                d = "↑" if mh["pct"] > 0 else "↓"
                print(f"      {mh['date']}  {d}{mh['pct']*100:+.1f}%  {mh['buyCount']} buys  ${mh['totalUsd']:,.0f}")
            if len(moveHits) > 5:
                print(f"      ... and {len(moveHits) - 5} more")
