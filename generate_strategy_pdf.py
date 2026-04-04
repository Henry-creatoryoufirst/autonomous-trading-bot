#!/usr/bin/env python3
"""
NVR Capital — Autonomous Trading Bot: Strategy & Parameters Manual
Generates a comprehensive PDF of all trading strategies, parameters, and principles.
v20.4.2 — March 26, 2026
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)

# ============================================================================
# COLOR PALETTE & STYLES
# ============================================================================

DARK_BG = HexColor("#0D1117")
ACCENT_GREEN = HexColor("#2EA043")
ACCENT_BLUE = HexColor("#58A6FF")
ACCENT_ORANGE = HexColor("#D29922")
ACCENT_RED = HexColor("#F85149")
ACCENT_PURPLE = HexColor("#BC8CFF")
LIGHT_GRAY = HexColor("#8B949E")
MEDIUM_GRAY = HexColor("#30363D")
TABLE_BG = HexColor("#161B22")
TABLE_HEADER_BG = HexColor("#21262D")
TEXT_PRIMARY = HexColor("#1A1A2E")
TEXT_SECONDARY = HexColor("#444466")
SECTION_BG = HexColor("#F0F4F8")
HEADER_BG = HexColor("#0D1117")
BORDER_COLOR = HexColor("#D0D7DE")
ROW_ALT = HexColor("#F6F8FA")

def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'CoverTitle', parent=styles['Title'],
        fontSize=28, leading=34, textColor=white,
        alignment=TA_CENTER, spaceAfter=6,
        fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'CoverSubtitle', parent=styles['Normal'],
        fontSize=14, leading=18, textColor=HexColor("#8B949E"),
        alignment=TA_CENTER, spaceAfter=4,
        fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'SectionHeader', parent=styles['Heading1'],
        fontSize=18, leading=22, textColor=HEADER_BG,
        spaceBefore=24, spaceAfter=10,
        fontName='Helvetica-Bold',
        borderWidth=0, borderPadding=0,
        leftIndent=0
    ))
    styles.add(ParagraphStyle(
        'SubHeader', parent=styles['Heading2'],
        fontSize=13, leading=16, textColor=HexColor("#24292F"),
        spaceBefore=14, spaceAfter=6,
        fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'Body', parent=styles['Normal'],
        fontSize=9.5, leading=13, textColor=TEXT_PRIMARY,
        spaceAfter=6, fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'BodyBold', parent=styles['Normal'],
        fontSize=9.5, leading=13, textColor=TEXT_PRIMARY,
        spaceAfter=6, fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'BulletCustom', parent=styles['Normal'],
        fontSize=9.5, leading=13, textColor=TEXT_PRIMARY,
        spaceAfter=3, fontName='Helvetica',
        leftIndent=18, bulletIndent=6
    ))
    styles.add(ParagraphStyle(
        'SmallNote', parent=styles['Normal'],
        fontSize=8, leading=10, textColor=LIGHT_GRAY,
        spaceAfter=4, fontName='Helvetica-Oblique'
    ))
    styles.add(ParagraphStyle(
        'TableCell', parent=styles['Normal'],
        fontSize=8.5, leading=11, textColor=TEXT_PRIMARY,
        fontName='Helvetica'
    ))
    styles.add(ParagraphStyle(
        'TableHeader', parent=styles['Normal'],
        fontSize=8.5, leading=11, textColor=white,
        fontName='Helvetica-Bold'
    ))
    styles.add(ParagraphStyle(
        'TOCEntry', parent=styles['Normal'],
        fontSize=11, leading=16, textColor=ACCENT_BLUE,
        spaceAfter=4, fontName='Helvetica',
        leftIndent=12
    ))
    return styles

# ============================================================================
# TABLE HELPERS
# ============================================================================

def make_table(headers, rows, col_widths=None):
    """Create a styled table."""
    data = [headers] + rows
    if col_widths:
        t = Table(data, colWidths=col_widths)
    else:
        t = Table(data)

    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), HEADER_BG),
        ('TEXTCOLOR', (0, 0), (-1, 0), white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8.5),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 8.5),
        ('LEADING', (0, 0), (-1, -1), 12),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
    ]
    # Alternate row colors
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, i), (-1, i), ROW_ALT))

    t.setStyle(TableStyle(style_cmds))
    return t

def hr():
    return HRFlowable(width="100%", thickness=1, color=BORDER_COLOR, spaceBefore=6, spaceAfter=6)

def section(title, story, styles):
    story.append(Paragraph(title, styles['SectionHeader']))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT_BLUE, spaceBefore=0, spaceAfter=10))

def sub(title, story, styles):
    story.append(Paragraph(title, styles['SubHeader']))

def body(text, story, styles):
    story.append(Paragraph(text, styles['Body']))

def bullet(text, story, styles):
    story.append(Paragraph(text, styles['BulletCustom'], bulletText="\u2022"))

def note(text, story, styles):
    story.append(Paragraph(text, styles['SmallNote']))

# ============================================================================
# COVER PAGE
# ============================================================================

def build_cover(story, styles):
    story.append(Spacer(1, 1.5*inch))

    # Dark banner
    cover_data = [[""]]
    cover_table = Table(cover_data, colWidths=[7*inch], rowHeights=[3.2*inch])
    cover_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HEADER_BG),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))

    # Build cover content separately
    story.append(Spacer(1, 0.5*inch))

    # Title block with dark bg
    title_data = [
        [Paragraph("NVR CAPITAL", ParagraphStyle('t', fontSize=12, leading=14, textColor=ACCENT_GREEN, alignment=TA_CENTER, fontName='Helvetica-Bold', spaceAfter=4))],
        [Paragraph("Autonomous Trading Bot", ParagraphStyle('t2', fontSize=28, leading=34, textColor=HEADER_BG, alignment=TA_CENTER, fontName='Helvetica-Bold', spaceAfter=2))],
        [Paragraph("Strategy & Parameters Manual", ParagraphStyle('t3', fontSize=18, leading=22, textColor=TEXT_SECONDARY, alignment=TA_CENTER, fontName='Helvetica', spaceAfter=12))],
        [Spacer(1, 8)],
        [Paragraph("Version 20.4.2", ParagraphStyle('v', fontSize=11, leading=14, textColor=ACCENT_BLUE, alignment=TA_CENTER, fontName='Helvetica-Bold'))],
        [Paragraph("March 26, 2026", ParagraphStyle('d', fontSize=10, leading=13, textColor=LIGHT_GRAY, alignment=TA_CENTER, fontName='Helvetica'))],
        [Spacer(1, 20)],
        [Paragraph("Base Chain  |  On-Chain Intelligence  |  Multi-Agent Swarm  |  Self-Improving", ParagraphStyle('tags', fontSize=8, leading=10, textColor=LIGHT_GRAY, alignment=TA_CENTER, fontName='Helvetica'))],
    ]
    title_table = Table(title_data, colWidths=[6*inch])
    title_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
    ]))
    story.append(title_table)

    story.append(Spacer(1, 1*inch))

    # Classification box
    class_data = [[Paragraph("CONFIDENTIAL \u2014 INTERNAL USE ONLY", ParagraphStyle('c', fontSize=9, leading=12, textColor=ACCENT_RED, alignment=TA_CENTER, fontName='Helvetica-Bold'))]]
    class_table = Table(class_data, colWidths=[4*inch])
    class_table.setStyle(TableStyle([
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('BOX', (0, 0), (-1, -1), 1, ACCENT_RED),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    story.append(class_table)

    story.append(PageBreak())

# ============================================================================
# TABLE OF CONTENTS
# ============================================================================

def build_toc(story, styles):
    section("Table of Contents", story, styles)
    toc_items = [
        "1. Core Philosophy & Principles",
        "2. Sector Allocations & Token Universe",
        "3. Position Sizing (Kelly Criterion)",
        "4. Entry Rules (Buy Signals)",
        "5. Exit Rules (Sell Signals & Profit Harvesting)",
        "6. Stop-Loss Framework",
        "7. Circuit Breakers & Safety",
        "8. Market Regime Detection",
        "9. Confluence Scoring Engine",
        "10. Cash Deployment Engine",
        "11. Fear & Greed Handling",
        "12. Scout Mode & Surge Mode",
        "13. Multi-Agent Swarm Architecture",
        "14. Self-Improvement Engine",
        "15. Execution Quality (TWAP, MEV, Liquidity)",
        "16. On-Chain Intelligence",
        "17. Token Discovery & Curation",
        "18. Derivatives Strategy",
        "19. Macro & Commodity Signals",
        "20. Polymarket Arbitrage",
        "21. Cycle Timing & Adaptive Speed",
        "22. Gas Management & Routing",
        "23. Profit Distribution & Payouts",
        "24. Telegram Monitoring",
        "25. Evolving Principles (Version History)",
    ]
    for item in toc_items:
        story.append(Paragraph(item, styles['TOCEntry']))
    story.append(PageBreak())

# ============================================================================
# DOCUMENT CONTENT
# ============================================================================

def build_content(story, styles):

    # === 1. CORE PHILOSOPHY ===
    section("1. Core Philosophy & Principles", story, styles)
    principles = [
        "<b>Let AI decide, don't kill-switch.</b> Every gate is graduated, not binary. F&G, momentum, and deployment all use multipliers that reduce size but let the AI reason.",
        "<b>Blockchain is source of truth.</b> P&amp;L, deposits, withdrawals, and token balances are all derived from on-chain queries, not snapshots or heuristics.",
        "<b>100% data coverage before trading.</b> Tokens without DEX flow data get auto-sold. Can't trade what you can't see.",
        "<b>Graduated everything.</b> Deployment has 4 tiers. Fear response has 4 levels. Momentum scales proportionally. No binary blocks.",
        "<b>Stops must always execute.</b> Cycle speed never slows for stop-losses. Trailing stops fire every cycle until the sell succeeds.",
        "<b>Curate signal, reduce noise.</b> AI receives top 5 curated opportunities (not 15+). Thin-liquidity tokens get de-listed.",
        "<b>Multi-router resilience.</b> Swap routing: Aggregator (0x/1inch) \u2192 Aerodrome Slipstream \u2192 Uniswap V3 \u2192 Multi-hop.",
        "<b>Opportunity cost feedback loops.</b> Blocked deploys get scored 4 hours later. Walk-forward validation requires 2+ regime diversity.",
        "<b>Trade based on DEX order flow, not sentiment.</b> F&amp;G is noise. Capital flow is signal. Flow agent has 35% weight in the swarm.",
    ]
    for p in principles:
        bullet(p, story, styles)

    story.append(PageBreak())

    # === 2. SECTOR ALLOCATIONS ===
    section("2. Sector Allocations & Token Universe", story, styles)
    body("The portfolio is divided into 5 sectors with target allocations. Rebalance triggers when sector drift exceeds 10%.", story, styles)

    story.append(make_table(
        ["Sector", "Target %", "Tokens", "Risk", "Min Trade"],
        [
            ["BLUE_CHIP", "45%", "ETH, cbBTC, cbETH, wstETH, LINK, cbLTC, cbXRP", "LOW", "$15"],
            ["AI_TOKENS", "20%", "VIRTUAL, AIXBT, HIGHER, CLANKER", "HIGH", "$15"],
            ["DEFI", "18%", "AERO, WELL, SEAM, EXTRA, BAL, MORPHO, RSR", "MEDIUM", "$15"],
            ["MEME_COINS", "15%", "BRETT, DEGEN, TOSHI, MOCHI, NORMIE, KEYCAT", "HIGH", "$15"],
            ["TOKENIZED_STOCKS", "2%", "bCOIN (Backed Coinbase Stock)", "MEDIUM", "$25"],
        ],
        col_widths=[1.1*inch, 0.7*inch, 2.8*inch, 0.7*inch, 0.7*inch]
    ))
    story.append(Spacer(1, 8))

    sub("Altseason / BTC Dominance Rotation", story, styles)
    story.append(make_table(
        ["Sector", "Altseason Boost", "BTC Dom Boost"],
        [
            ["AI_TOKENS", "+5%", "-3%"],
            ["MEME_COINS", "+5%", "-5%"],
            ["BLUE_CHIP", "-10%", "+10%"],
            ["DEFI", "0%", "-2%"],
            ["TOKENIZED_STOCKS", "0%", "0%"],
        ],
        col_widths=[1.5*inch, 1.5*inch, 1.5*inch]
    ))

    story.append(PageBreak())

    # === 3. POSITION SIZING ===
    section("3. Position Sizing (Kelly Criterion)", story, styles)
    body("Half-Kelly criterion applied to a rolling window of the last 50 trades. Minimum 20 trades required before Kelly activates.", story, styles)

    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Kelly Fraction", "0.5 (half Kelly)"],
            ["Min Trades for Kelly", "20"],
            ["Rolling Window", "50 trades"],
            ["Fallback (pre-Kelly)", "max($75, 8% of portfolio)"],
            ["Position Floor", "$3"],
            ["Position Ceiling", "18% of portfolio"],
            ["Small Portfolio Ceiling (<$10K)", "30% of portfolio"],
            ["Max Single Token Exposure", "25% of portfolio"],
        ],
        col_widths=[2.5*inch, 3.5*inch]
    ))
    story.append(Spacer(1, 8))

    sub("Volatility-Adjusted Sizing", story, styles)
    story.append(make_table(
        ["Parameter", "Value", "Effect"],
        [
            ["Target Daily Vol", "2%", "Baseline"],
            ["High Vol Threshold", ">5% daily", "Size x0.4 (60% cut)"],
            ["Low Vol Threshold", "<1% daily", "Size x1.5 (50% boost)"],
            ["Vol Lookback", "7 days", "Rolling window"],
        ],
        col_widths=[1.5*inch, 1.5*inch, 2.5*inch]
    ))
    story.append(Spacer(1, 8))

    sub("Regime Multipliers", story, styles)
    story.append(make_table(
        ["Market Regime", "Size Multiplier", "Notes"],
        [
            ["TRENDING_UP", "1.3x", "Maximum aggression, buy dips"],
            ["TRENDING_DOWN", "0.85x", "Hunt oversold bounces, sell losers"],
            ["RANGING", "0.9x", "Fewer trades, higher conviction, max 2/cycle"],
            ["VOLATILE", "0.7x", "More trades, smaller sizes"],
            ["UNKNOWN", "0.8x", "Default conservative"],
        ],
        col_widths=[1.5*inch, 1.2*inch, 3*inch]
    ))

    story.append(PageBreak())

    # === 4. ENTRY RULES ===
    section("4. Entry Rules (Buy Signals)", story, styles)
    entries = [
        "<b>Confluence required:</b> 2+ indicators agreeing (RSI + MACD, or BB + trend). In strong momentum, 1 signal suffices.",
        "<b>Sector priority:</b> Buy into the most underweight sector first.",
        "<b>Volume confirmation:</b> Prefer tokens where 24h volume exceeds 7-day average.",
        "<b>Trend alignment:</b> Prefer tokens in UP or STRONG_UP trends.",
        "<b>Momentum deployment:</b> BTC/ETH +3% in 24h = deploy USDC aggressively at 1.5x size.",
        "<b>Catching Fire:</b> DEX buy ratio >60% AND volume >2x 7-day avg = STRONG BUY with 1.5x size.",
        "<b>TVL-Price Divergence:</b> DeFi token with rising TVL but flat price = undervalued, priority buy.",
        "<b>Falling Knife Filter:</b> NEVER buy on oversold RSI alone if MACD is bearish.",
        "<b>Scale Into Winners:</b> Position up 3%+ from cost with buy ratio >55% = increase position by 2-4x.",
        "<b>Ride The Wave:</b> Token up 5%+ in 4 hours with increasing volume = deploy 4% of portfolio immediately.",
        "<b>Risk/Reward Gate:</b> Only enter when potential reward is at least 2x risk. Avoid tokens within 5% of 30-day high.",
    ]
    for e in entries:
        bullet(e, story, styles)

    story.append(PageBreak())

    # === 5. EXIT RULES ===
    section("5. Exit Rules (Sell Signals & Profit Harvesting)", story, styles)

    sub("Profit Harvesting Tiers", story, styles)
    body("Only harvest when momentum decelerates (buy ratio dropping or MACD turning). If buy ratio >55% and MACD bullish, let winners run.", story, styles)

    story.append(make_table(
        ["Gain Threshold", "Sell %", "Label", "ATR Multiple"],
        [
            ["+25%", "15%", "EARLY_HARVEST", "8x ATR"],
            ["+50%", "20%", "MID_HARVEST", "12x ATR"],
            ["+100%", "25%", "STRONG_HARVEST", "18x ATR"],
            ["+200%", "35%", "MAJOR_HARVEST", "25x ATR"],
        ],
        col_widths=[1.3*inch, 0.8*inch, 1.5*inch, 1.3*inch]
    ))
    story.append(Spacer(1, 4))
    note("Cooldown: 8 hours between harvests per tier. Min holding: $5.", story, styles)

    story.append(Spacer(1, 8))
    sub("Momentum Exits", story, styles)
    exits = [
        "<b>Buy ratio drops below 45%</b> = SELL regardless of profit/loss.",
        "<b>Flow-Reversal Exit:</b> Buy ratio below 40% AND decelerating for 2+ readings = exit.",
        "<b>Deceleration Trim:</b> Buy ratio drops 8+ pp from peak over 2+ consecutive readings \u2192 trim 10% (up to 30% max) if position is 3%+ in profit.",
        "<b>Capital Recycling:</b> If USDC < $10, sell 20-30% of highest-gain position.",
        "<b>Time-Based Harvest:</b> Positions held 72+ hours with +15% gain get a 10% trim.",
    ]
    for e in exits:
        bullet(e, story, styles)

    story.append(PageBreak())

    # === 6. STOP-LOSS ===
    section("6. Stop-Loss Framework", story, styles)

    sub("Per-Position Stops", story, styles)
    story.append(make_table(
        ["Stop Type", "Trigger", "Action"],
        [
            ["HARD_STOP", "-15% from cost basis", "Immediate full sell"],
            ["SOFT_STOP", "-12% from cost basis", "Sell (positions >$20)"],
            ["CONCENTRATED_STOP", "-7% from cost", "Sell (positions >10% of portfolio)"],
            ["Trailing Stop", "-12% from peak price", "Sell 75% of position"],
        ],
        col_widths=[1.5*inch, 1.8*inch, 2.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Sector Stop-Loss Overrides", story, styles)
    story.append(make_table(
        ["Sector", "Max Loss", "Max Trailing", "Max Position %"],
        [
            ["MEME_COINS", "-4%", "-3%", "15%"],
            ["AI_TOKENS", "-4%", "-3%", "20%"],
            ["DEFI", "-5%", "-4%", "25%"],
            ["BLUE_CHIP", "-6%", "-5%", "30%"],
            ["TOKENIZED_STOCKS", "-5%", "-4%", "10%"],
        ],
        col_widths=[1.5*inch, 1*inch, 1.2*inch, 1.3*inch]
    ))

    story.append(Spacer(1, 8))
    sub("ATR-Based Dynamic Stops", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Stop Distance", "2.5x ATR (floor: -25%, ceiling: -12%)"],
            ["Trailing Distance", "2.0x ATR"],
            ["Trail Activation", "After position is +1x ATR in profit"],
            ["Sector ATR Multipliers", "Meme 2.0x, AI 2.5x, DeFi 2.5x, Blue Chip 3.0x, Stocks 3.0x"],
        ],
        col_widths=[1.5*inch, 4.5*inch]
    ))
    story.append(Spacer(1, 4))
    note("Trailing stops fire every cycle until sell succeeds. 95% balance cap prevents dust failures.", story, styles)

    story.append(PageBreak())

    # === 7. CIRCUIT BREAKERS ===
    section("7. Circuit Breakers & Safety", story, styles)

    sub("Portfolio-Level Breakers", story, styles)
    story.append(make_table(
        ["Trigger", "Action"],
        [
            ["20%+ drawdown from peak", "HALT all trading that cycle"],
            ["12%+ drawdown from peak", "CAUTION: position sizes halved"],
            ["Portfolio < 40% of peak", "HOLD-ONLY mode (no new buys, stops still fire)"],
            ["Portfolio < $50 absolute", "ALL trading halted"],
        ],
        col_widths=[2.5*inch, 3.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Institutional Circuit Breaker", story, styles)
    body("Any of the following triggers pause new buys for 1 hour:", story, styles)
    story.append(make_table(
        ["Trigger", "Threshold"],
        [
            ["Consecutive losing trades", "5"],
            ["Daily drawdown", "8%"],
            ["Weekly drawdown", "15%"],
            ["Single trade loss", ">3% of portfolio"],
        ],
        col_widths=[2.5*inch, 2.5*inch]
    ))
    story.append(Spacer(1, 4))
    note("Post-breaker: 70% size reduction for 24 hours. Per-token breaker: 3 consecutive failures = token blocked 6 hours.", story, styles)

    story.append(Spacer(1, 8))
    sub("Emergency Mode", story, styles)
    body("Any position drops 5% between cycles \u2192 30-second rapid-fire cycles for 5 minutes.", story, styles)

    story.append(PageBreak())

    # === 8. MARKET REGIME ===
    section("8. Market Regime Detection", story, styles)
    body("Regimes are detected via multi-factor analysis of BTC/ETH price action, volume patterns, ADX, and volatility.", story, styles)

    story.append(make_table(
        ["Regime", "Size Mult.", "Max Trades/Cycle", "Strategy"],
        [
            ["TRENDING_UP", "1.3x", "3", "Maximum aggression, buy dips"],
            ["TRENDING_DOWN", "0.85x", "3", "Hunt oversold bounces, cut losers"],
            ["RANGING", "0.9x", "2", "Fewer trades, higher conviction"],
            ["VOLATILE", "0.7x", "3", "More trades, smaller sizes"],
            ["UNKNOWN", "0.8x", "3", "Default conservative"],
        ],
        col_widths=[1.3*inch, 0.9*inch, 1.2*inch, 2.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Volatility Levels & Cycle Speed", story, styles)
    story.append(make_table(
        ["Level", "Max Price Change", "Cycle Interval"],
        [
            ["EXTREME", ">8%", "60 seconds"],
            ["HIGH", ">5%", "120 seconds"],
            ["ELEVATED", ">3%", "180 seconds"],
            ["NORMAL", ">1%", "300 seconds"],
            ["LOW", ">0.3%", "300 seconds"],
            ["DEAD", "<0.3%", "300 seconds"],
        ],
        col_widths=[1.3*inch, 1.5*inch, 1.5*inch]
    ))

    story.append(PageBreak())

    # === 9. CONFLUENCE SCORING ===
    section("9. Confluence Scoring Engine (-100 to +100)", story, styles)

    story.append(make_table(
        ["Signal", "Weight", "Bullish Trigger", "Bearish Trigger"],
        [
            ["RSI", "25", "RSI < 30 = +25", "RSI > 70 = -25"],
            ["MACD", "25", "Bullish cross = +25", "Bearish cross = -25"],
            ["Bollinger Bands", "20", "Oversold = +20", "Overbought = -20"],
            ["Trend Direction", "15", "STRONG_UP = +15", "STRONG_DOWN = -15"],
            ["Price Momentum", "15", "Strong 24h/7d gain = +8", "Strong decline = -8"],
            ["TWAP Divergence", "15", "Spot below TWAP = +15", "Spot above TWAP = -15"],
            ["Order Flow (CVD)", "15", "STRONG_BUY = +15", "Momentum reversal = -12"],
            ["Tick Liquidity", "12", "Strong support = +12", "Strong resistance = -12"],
            ["ADX", "5", "ADX>30 confirms = +5", "ADX<15 dampens 20%"],
            ["BTC/ETH Momentum", "5", "Majors +3%+ = +5", "N/A"],
        ],
        col_widths=[1.3*inch, 0.6*inch, 2*inch, 2*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Action Thresholds", story, styles)
    story.append(make_table(
        ["Threshold", "Value", "Re-Entry Value"],
        [
            ["Confluence BUY", "8", "27"],
            ["Strong BUY", "30", "N/A"],
            ["Confluence SELL", "-8", "-23"],
            ["Strong SELL", "-30", "N/A"],
        ],
        col_widths=[1.5*inch, 1.2*inch, 1.5*inch]
    ))

    story.append(PageBreak())

    # === 10. CASH DEPLOYMENT ===
    section("10. Cash Deployment Engine", story, styles)
    body("Graduated tiers replace binary deploy/block. Pre-AI forced deployment fires when cash exceeds threshold.", story, styles)

    story.append(make_table(
        ["Tier", "Cash %", "Deploy %", "Confluence Discount", "Max Entries"],
        [
            ["LIGHT", ">20%", "30%", "-5 pts", "2"],
            ["MODERATE", ">35%", "50%", "-10 pts", "3"],
            ["AGGRESSIVE", ">50%", "70%", "-15 pts", "4"],
            ["URGENT", ">65%", "80%", "-20 pts", "5"],
        ],
        col_widths=[1*inch, 0.8*inch, 0.9*inch, 1.3*inch, 1*inch]
    ))
    story.append(Spacer(1, 4))
    note("Min USDC reserve: $150. Momentum gate: BTC+ETH avg < -5% = hard block; dips between -5% and 0% scale proportionally.", story, styles)

    story.append(PageBreak())

    # === 11. FEAR & GREED ===
    section("11. Fear & Greed Handling", story, styles)

    sub("Graduated Fear Gates for Deployment", story, styles)
    story.append(make_table(
        ["F&G Level", "Deploy Size", "Constraint"],
        [
            ["F&G < 15 (Extreme Fear)", "25% size", "Blue chips only"],
            ["F&G 15-25 (Fear)", "50% size", "Full universe"],
            ["F&G 25-40 (Cautious)", "75% size", "Full universe"],
            ["F&G >= 40", "100% size", "Full universe"],
        ],
        col_widths=[1.8*inch, 1.2*inch, 2*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Capital Preservation Mode", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Activation", "F&G < 12 sustained for 6+ hours"],
            ["Deactivation", "F&G > 20"],
            ["Position Size Reduction", "50%"],
            ["Minimum Confluence", "25"],
            ["Scout Seeding", "Allowed ($8 probes)"],
            ["Cycle Speed", "UNCHANGED (stops must execute)"],
        ],
        col_widths=[2*inch, 4*inch]
    ))

    story.append(PageBreak())

    # === 12. SCOUT & SURGE ===
    section("12. Scout Mode & Surge Mode", story, styles)

    sub("Scout Mode", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Scout Position Size", "$8 per token"],
            ["Max Concurrent Scouts", "18"],
            ["Upgrade Trigger", "Buy ratio >55% across 2+ timeframes"],
            ["Stop Exemption", "Positions <$15 exempt from %-based stops"],
        ],
        col_widths=[2*inch, 4*inch]
    ))
    story.append(Spacer(1, 4))
    note("Scouts prove a thesis cheaply. Winners get real capital via SCALE_UP.", story, styles)

    story.append(Spacer(1, 8))
    sub("Surge Mode", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Trigger", "Multi-timeframe flow confirms strong buying"],
            ["Dedup Window", "3 minutes (vs 15 min normal)"],
            ["Max Capital Per Token", "25% of portfolio"],
            ["Max Buys Per Token/Hour", "5"],
        ],
        col_widths=[2*inch, 4*inch]
    ))

    story.append(PageBreak())

    # === 13. MULTI-AGENT SWARM ===
    section("13. Multi-Agent Swarm Architecture", story, styles)
    body("5 micro-agents vote on each decision. The weighted score determines the action.", story, styles)

    story.append(make_table(
        ["Agent", "Weight", "Signal Focus"],
        [
            ["Flow Agent", "35%", "DEX buy/sell ratio, volume (CORE signal)"],
            ["Risk Agent", "25%", "Position sizing, exposure, drawdown"],
            ["Momentum Agent", "20%", "RSI, MACD, Bollinger Bands"],
            ["Trend Agent", "15%", "ADX, price direction"],
            ["Sentiment Agent", "5%", "BTC/ETH trend, regime (near-zero weight)"],
        ],
        col_widths=[1.3*inch, 0.8*inch, 3.8*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Score Thresholds", story, styles)
    story.append(make_table(
        ["Action", "Score Range"],
        [
            ["STRONG_BUY", ">= 1.5"],
            ["BUY", ">= 1.0"],
            ["HOLD", "-1.0 to 1.0"],
            ["SELL", "<= -1.0"],
            ["STRONG_SELL", "<= -1.5"],
        ],
        col_widths=[1.5*inch, 2*inch]
    ))

    story.append(PageBreak())

    # === 14. SELF-IMPROVEMENT ===
    section("14. Self-Improvement Engine", story, styles)

    sub("Strategy Pattern Memory", story, styles)
    body("Auto-classifies trades into pattern buckets (action x RSI bucket x regime x confluence bucket). Tracks win/loss rates per pattern.", story, styles)

    sub("Performance Reviews", story, styles)
    body("Every 10 trades or 24 hours, the engine reviews performance:", story, styles)
    bullet("<b>Low win rate (<35%):</b> tighten confluence buy threshold", story, styles)
    bullet("<b>High win rate (>65%):</b> slightly lower confluence threshold", story, styles)
    bullet("<b>Regime-specific:</b> reduce multiplier if regime win rate <30%", story, styles)
    bullet("<b>Stagnation:</b> if no trades in 48h, lower thresholds", story, styles)

    story.append(Spacer(1, 6))
    sub("Shadow Model Validation", story, styles)
    body("Proposed threshold changes require 3+ confirming reviews AND confirmation from 2+ different market regimes before promotion. Max 30% contradiction ratio.", story, styles)

    sub("Confidence-Weighted Sizing", story, styles)
    body("Proven patterns: full size (confidence 0.6-1.0). Unproven: minimum 0.6 floor (never more than 40% reduction).", story, styles)

    sub("Exploration Trades", story, styles)
    body("After 1 hour stagnation: deploy $50 (or 3% of USDC). Guardrails: confluence >= 0, MACD not bearish, buy ratio >= 45%. RANGING markets: 50% size, max 1 per cycle.", story, styles)

    story.append(PageBreak())

    # === 15. EXECUTION QUALITY ===
    section("15. Execution Quality", story, styles)

    sub("TWAP Execution", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Threshold", "Orders >$100"],
            ["Slices", "5"],
            ["Slice Interval", "12 seconds"],
            ["Timing Jitter", "+/- 20%"],
            ["Adverse Move Pause", ">1% price move"],
            ["Max Duration", "2 minutes"],
        ],
        col_widths=[1.5*inch, 3*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Liquidity Filters", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Max Spread", "0.5%"],
            ["Max Trade as Pool %", "5% (warn at 2%)"],
            ["Min Pool Liquidity", "$10,000 (preferred: $50,000)"],
            ["Thin Pool Reduction", "50% size cut"],
        ],
        col_widths=[1.5*inch, 3.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("MEV Protection & RPC Priority", story, styles)
    body("Adaptive slippage based on trade size + market conditions. RPC order:", story, styles)
    bullet("1. Flashbots Protect (private submission)", story, styles)
    bullet("2. Base sequencer (direct)", story, styles)
    bullet("3. 1RPC TEE privacy relay", story, styles)
    bullet("4. Base public RPC", story, styles)
    bullet("5. Community RPCs (meowrpc, drpc)", story, styles)

    story.append(PageBreak())

    # === 16. ON-CHAIN INTELLIGENCE ===
    section("16. On-Chain Intelligence", story, styles)

    sub("Price Source Priority", story, styles)
    bullet("1. Chainlink oracles (ETH, BTC, LINK, USDC, EURC)", story, styles)
    bullet("2. DEX pool reads (Uniswap V3 / Aerodrome slot0 or getReserves)", story, styles)
    bullet("3. DexScreener fallback", story, styles)

    story.append(Spacer(1, 6))
    sub("Per-Token On-Chain Signals", story, styles)
    story.append(make_table(
        ["Signal", "Description", "Threshold"],
        [
            ["TWAP-Spot Divergence", "15-min TWAP vs current spot", "2% deviation"],
            ["Swap Event Order Flow", "Net buy/sell volume from events", "Large trade: >$5K"],
            ["Tick Liquidity Depth", "Bid/ask imbalance around price", "Scored +/-12"],
            ["Chainlink Deviation", "DEX vs oracle price mismatch", ">2% = arb signal"],
        ],
        col_widths=[1.5*inch, 2.3*inch, 1.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Market Intelligence Signals", story, styles)
    story.append(make_table(
        ["Signal", "Threshold"],
        [
            ["BTC Dominance Change", "2.0 pp over 7 days"],
            ["Smart vs Retail Divergence", "20 pp difference"],
            ["Funding Rate Mean-Reversion", "2.0 std dev"],
            ["TVL-Price Divergence", "5% threshold"],
            ["Stablecoin Supply Change", "2% 7-day threshold"],
            ["Cross-Asset Correlation", "Gold, Oil, VIX, S&P 500"],
        ],
        col_widths=[2.2*inch, 3*inch]
    ))

    story.append(PageBreak())

    # === 17. TOKEN DISCOVERY ===
    section("17. Token Discovery & Curation", story, styles)

    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Scan Interval", "Every 6 hours"],
            ["Min Liquidity", "$50,000"],
            ["Min 24h Volume", "$10,000"],
            ["Min Pair Age", "72 hours (3 days)"],
            ["Max Discovered Tokens", "30"],
            ["Min FDV", "$1,000,000"],
            ["Min 24h Transactions", "100"],
        ],
        col_widths=[2*inch, 3*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Composite Scoring (Top 5 Opportunities)", story, styles)
    story.append(make_table(
        ["Factor", "Weight"],
        [
            ["Volume Momentum", "40%"],
            ["Liquidity Depth", "20%"],
            ["Price Action", "25%"],
            ["Transaction Density", "15%"],
        ],
        col_widths=[2*inch, 1.2*inch]
    ))
    story.append(Spacer(1, 4))
    note("Runner Override: 50%+ gain AND $100K+ volume forces token into top 5 regardless of composite.", story, styles)

    story.append(PageBreak())

    # === 18. DERIVATIVES ===
    section("18. Derivatives Strategy", story, styles)
    body("Perpetual futures on Coinbase Advanced Trade. Disabled by default \u2014 must be explicitly enabled.", story, styles)

    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Max Leverage", "3x"],
            ["Max Position %", "30% of buying power"],
            ["Max Total Exposure", "80%"],
            ["Stop-Loss", "-10%"],
            ["Take-Profit", "+15% (takes 50% off)"],
            ["Liquidation Buffer", "20% (reduce if within 20% of liq)"],
            ["Max Funding Rate", "30 bps (0.3%)"],
            ["Position Cooldown", "30 minutes"],
            ["Max Open Positions", "4"],
            ["Base Position Size", "$50"],
            ["Min/Max Position", "$10 / $200"],
        ],
        col_widths=[2*inch, 3.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Confidence Modifiers", story, styles)
    story.append(make_table(
        ["Condition", "Multiplier"],
        [
            ["Downtrend + LONG", "0.7x"],
            ["Uptrend + SHORT", "0.7x"],
            ["VOLATILE regime", "0.6x"],
            ["RISK_OFF + LONG", "0.8x"],
            ["RISK_OFF + SHORT", "1.15x"],
            ["High funding against position", "0.5x"],
            ["Extreme Fear + LONG", "1.2x"],
            ["Extreme Greed + SHORT", "1.2x"],
            ["AI concurs", "1.1x"],
            ["AI disagrees", "0.7x"],
        ],
        col_widths=[2.5*inch, 1.2*inch]
    ))

    story.append(PageBreak())

    # === 19. MACRO & COMMODITIES ===
    section("19. Macro & Commodity Signals", story, styles)

    sub("Gold Signal Weights", story, styles)
    story.append(make_table(
        ["Component", "Weight"],
        [
            ["Dollar Index (DXY)", "25%"],
            ["Real Yields (10Y - CPI)", "25%"],
            ["VIX", "20%"],
            ["S&P 500", "15%"],
            ["Gold Momentum", "15%"],
        ],
        col_widths=[2*inch, 1*inch]
    ))

    story.append(Spacer(1, 6))
    sub("DXY Signal Mapping", story, styles)
    story.append(make_table(
        ["DXY Level", "Signal", "Direction"],
        [
            [">107", "-0.9", "Very Strong Dollar (bearish gold)"],
            [">105", "-0.6", "Strong Dollar"],
            [">103", "-0.3", "Moderate"],
            [">100", "0", "Neutral"],
            [">97", "+0.3", "Weakening Dollar"],
            [">95", "+0.6", "Weak Dollar (bullish gold)"],
            ["<=95", "+0.9", "Very Weak Dollar"],
        ],
        col_widths=[1*inch, 0.8*inch, 2.5*inch]
    ))

    story.append(Spacer(1, 6))
    sub("VIX Signal Mapping", story, styles)
    story.append(make_table(
        ["VIX Level", "Signal", "Sentiment"],
        [
            [">35", "+0.9", "PANIC"],
            [">30", "+0.6", "FEAR"],
            [">25", "+0.3", "ELEVATED"],
            [">20", "0", "NORMAL"],
            [">15", "-0.3", "COMPLACENT"],
            ["<=15", "-0.5", "VERY COMPLACENT"],
        ],
        col_widths=[1*inch, 0.8*inch, 2*inch]
    ))
    story.append(Spacer(1, 4))
    note("Silver signal = Gold signal x 0.85 + industrial demand overlay (RISK_ON +0.4, RISK_OFF -0.4).", story, styles)

    story.append(PageBreak())

    # === 20. POLYMARKET ===
    section("20. Polymarket Arbitrage", story, styles)

    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Min Spread", "2%"],
            ["Max Trade Size", "$100"],
            ["Min Liquidity", "$1,000"],
            ["Scan Interval", "30 seconds"],
            ["Trading Enabled", "Disabled (dry run by default)"],
            ["Max per trade", "$500 hard cap"],
            ["Pool % limit", "10% of pool liquidity"],
        ],
        col_widths=[1.5*inch, 3*inch]
    ))

    story.append(Spacer(1, 6))
    sub("Urgency Classification", story, styles)
    story.append(make_table(
        ["Profit %", "Urgency", "Size Multiplier"],
        [
            [">10%", "HIGH", "3x base ($150)"],
            [">5%", "HIGH", "2x base ($100)"],
            [">3%", "MEDIUM", "1x base ($50)"],
            ["<=3%", "LOW", "1x base ($50)"],
        ],
        col_widths=[1*inch, 1*inch, 1.5*inch]
    ))

    story.append(PageBreak())

    # === 21. CYCLE TIMING ===
    section("21. Cycle Timing & Adaptive Speed", story, styles)

    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Default Interval", "300 seconds (5 min)"],
            ["Min Interval", "60 seconds"],
            ["Max Interval", "300 seconds"],
            ["Emergency Interval", "30 seconds (5 min burst)"],
            ["Emergency Trigger", "Any position drops 5% between cycles"],
            ["Cycle Timeout", "5 minutes hard limit"],
            ["Stuck Detection", "Force-reset if >10 minutes"],
            ["Heavy Cycle Forced", "Every 60 seconds"],
        ],
        col_widths=[2*inch, 3.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Portfolio Sensitivity Tiers", story, styles)
    story.append(make_table(
        ["Portfolio Size", "Price Change Threshold", "Label"],
        [
            ["$0+", "2%", "STARTER"],
            ["$5,000+", "1.5%", "GROWTH"],
            ["$25,000+", "1%", "SCALED"],
            ["$50,000+", "0.5%", "PREMIUM"],
            ["$100,000+", "0.3%", "INSTITUTIONAL"],
        ],
        col_widths=[1.3*inch, 1.5*inch, 1.2*inch]
    ))

    story.append(PageBreak())

    # === 22. GAS & ROUTING ===
    section("22. Gas Management & Routing", story, styles)

    sub("Gas Auto-Refuel", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Refuel Threshold", "ETH < 0.0003"],
            ["Refuel Amount", "$1 USDC to WETH"],
            ["Refuel Cooldown", "30 minutes"],
            ["Bootstrap (first startup)", "$5 USDC if ETH < $2 worth"],
            ["Gas Cost Cap", "Skip trade if gas >5% of trade value"],
        ],
        col_widths=[2*inch, 3.5*inch]
    ))

    story.append(Spacer(1, 8))
    sub("Swap Routing Chain", story, styles)
    body("Fallback routing order for every trade:", story, styles)
    bullet("<b>1. Aggregator</b> (0x / 1inch) \u2014 always tries first", story, styles)
    bullet("<b>2. Aerodrome Slipstream</b> \u2014 SwapRouter for Aerodrome V3 pools", story, styles)
    bullet("<b>3. Uniswap V3</b> \u2014 standard exactInputSingle", story, styles)
    bullet("<b>4. Multi-hop</b> \u2014 routes through intermediate tokens", story, styles)

    story.append(PageBreak())

    # === 23. PAYOUTS ===
    section("23. Profit Distribution & Payouts", story, styles)

    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Schedule", "Daily at 8:00 AM UTC"],
            ["Min Transfer", "$1 per recipient"],
            ["Min ETH Reserve", "0.0003 ETH"],
            ["USDC Buffer", "$5 post-payout"],
            ["Max Distribution", "70% of realized P&L (30% min compounding)"],
            ["Min Trading Capital", "$500 (payouts skip if below)"],
        ],
        col_widths=[2*inch, 3.5*inch]
    ))
    story.append(Spacer(1, 4))
    note("Recipients configured via HARVEST_RECIPIENTS env (label:wallet:percent).", story, styles)

    story.append(Spacer(1, 12))

    sub("Dust Cleanup", story, styles)
    story.append(make_table(
        ["Parameter", "Value"],
        [
            ["Threshold", "Positions under $5"],
            ["Min Age", "24 hours"],
            ["Frequency", "Every 10 cycles"],
            ["Exemptions", "ETH, WETH, USDC"],
        ],
        col_widths=[1.5*inch, 3*inch]
    ))

    story.append(PageBreak())

    # === 24. TELEGRAM ===
    section("24. Telegram Monitoring", story, styles)

    sub("Alert Types", story, styles)
    story.append(make_table(
        ["Alert", "Severity", "Trigger"],
        [
            ["Trade Failures", "CRITICAL", "3+ consecutive failures"],
            ["Portfolio Drop", "HIGH", ">5% balance drop"],
            ["Circuit Breaker", "CRITICAL", "Any breaker triggers"],
            ["Kill Switch", "CRITICAL", "Manual /api/kill"],
            ["Startup/Shutdown", "INFO", "Bot lifecycle events"],
            ["Hourly Report", "INFO", "Portfolio, positions, regime, flags"],
            ["Daily Digest", "INFO", "7 AM EDT summary"],
        ],
        col_widths=[1.3*inch, 1*inch, 3*inch]
    ))

    story.append(PageBreak())

    # === 25. EVOLVING PRINCIPLES ===
    section("25. Evolving Principles (Version History)", story, styles)

    versions = [
        ("<b>v19.1-19.3</b>: Fear-based kill switches introduced, then softened. ATR trailing stops added. Capital preservation mode created.",),
        ("<b>v19.5</b>: On-chain deposit/withdrawal detection. Blockchain becomes source of truth for P&amp;L.",),
        ("<b>v19.6</b>: Telegram alerting infrastructure. Pre-flight checks. Kill switch endpoints.",),
        ("<b>v19.6.1</b>: Reversed extreme-fear hard block. AI decides, not kill switches. 50% size reduction instead of full block.",),
        ("<b>v20.0</b>: 4-part release. MEV protection, DEX aggregator, adversarial risk reviewer, walk-forward validation, drawdown controls.",),
        ("<b>v20.1</b>: Unblocked stale circuit breakers. Allowed scout seeding during preservation.",),
        ("<b>v20.2</b>: Graduated deployment (4 tiers). Fear-aware deployment (4 levels). Momentum soft gate. Opportunity cost tracker.",),
        ("<b>v20.3</b>: Curated discovery (top 5 with composite scoring). Runner detection. On-chain P&amp;L from deposits.",),
        ("<b>v20.3.1</b>: Idle USDC fix. Kelly fallback raised. Hourly Telegram reports.",),
        ("<b>v20.4</b>: Multi-asset convergence. Chainlink expansion. CMC intelligence. Tokenized stocks sector.",),
        ("<b>v20.4.2</b>: Aerodrome Slipstream router. 50%+ of Base DEX volume now routable. Multi-router fallback chain.",),
    ]
    for v in versions:
        bullet(v[0], story, styles)

    story.append(Spacer(1, 24))

    # Footer
    story.append(HRFlowable(width="100%", thickness=1, color=BORDER_COLOR))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        "NVR Capital \u2014 Autonomous Trading Bot v20.4.2 \u2014 Generated March 26, 2026",
        ParagraphStyle('footer', fontSize=8, textColor=LIGHT_GRAY, alignment=TA_CENTER, fontName='Helvetica')
    ))
    story.append(Paragraph(
        "This document is auto-generated from source code. Parameters may be adjusted by the self-improvement engine.",
        ParagraphStyle('footer2', fontSize=7, textColor=LIGHT_GRAY, alignment=TA_CENTER, fontName='Helvetica-Oblique')
    ))

# ============================================================================
# PAGE NUMBERING
# ============================================================================

def add_page_number(canvas_obj, doc):
    page_num = canvas_obj.getPageNumber()
    if page_num > 1:  # Skip cover page
        text = f"NVR Capital \u2014 Strategy Manual v20.4.2  |  Page {page_num}"
        canvas_obj.saveState()
        canvas_obj.setFont('Helvetica', 7)
        canvas_obj.setFillColor(LIGHT_GRAY)
        canvas_obj.drawString(inch, 0.5*inch, text)
        canvas_obj.drawRightString(letter[0] - inch, 0.5*inch, "CONFIDENTIAL")
        canvas_obj.restoreState()

# ============================================================================
# BUILD PDF
# ============================================================================

def main():
    output_path = "/Users/henryschertzinger/Desktop/NVR_Capital_Strategy_Manual_v20.4.2.pdf"

    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=0.75*inch,
        rightMargin=0.75*inch,
        topMargin=0.75*inch,
        bottomMargin=0.75*inch,
        title="NVR Capital - Autonomous Trading Bot: Strategy & Parameters Manual",
        author="NVR Capital",
        subject="Trading Strategy Documentation v20.4.2"
    )

    styles = get_styles()
    story = []

    build_cover(story, styles)
    build_toc(story, styles)
    build_content(story, styles)

    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"PDF generated: {output_path}")

if __name__ == "__main__":
    main()
