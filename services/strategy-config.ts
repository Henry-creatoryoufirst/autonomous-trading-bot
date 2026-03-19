/**
 * Strategy Config Parser — Natural Language to Config Changes
 *
 * Parses user instructions via keyword matching (no AI needed).
 * Maps phrases like "be more aggressive" or "set stop loss to 10%"
 * to concrete parameter changes.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface ConfigChange {
  parameter: string;      // e.g. 'profitTakePercent', 'sectorTargets.AI_AGENTS'
  oldValue: any;
  newValue: any;
  source: string;         // the user's natural language instruction
}

export interface ParseResult {
  changes: ConfigChange[];
  understood: boolean;
  summary: string;         // human-readable summary of what will change
  requiresConfirmation: boolean;
}

export interface ConfigDirective {
  id: string;
  instruction: string;      // original user text
  changes: ConfigChange[];
  appliedAt: string;        // ISO timestamp
  expiresAt?: string;       // optional expiry
  active: boolean;
}

// ============================================================================
// KEYWORD PATTERNS
// ============================================================================

const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/;
const TOKEN_RE = /\b([A-Z]{2,10})\b/g;

const AGGRESSIVE_KEYWORDS = ['aggressive', 'offense', 'offensive', 'go hard', 'full send', 'maximize', 'yolo', 'bigger trades', 'more trades', 'deploy capital', 'put money to work', 'attack'];
const CONSERVATIVE_KEYWORDS = ['conservative', 'defensive', 'careful', 'reduce risk', 'slow down', 'protect capital', 'less risk', 'safe', 'cautious'];
const STOP_LOSS_KEYWORDS = ['stop loss', 'stoploss', 'stop-loss'];
const PROFIT_TAKE_KEYWORDS = ['profit take', 'profit-take', 'take profit', 'profit target', 'tp'];
const BLUE_CHIP_KEYWORDS = ['blue chip', 'blue-chip', 'bluechip', 'safe coins', 'large cap', 'large-cap'];
const AI_KEYWORDS = ['ai token', 'ai coin', 'ai allocation', 'artificial intelligence', 'ai agents'];
const MEME_KEYWORDS = ['meme coin', 'memecoin', 'meme token', 'meme'];
const DEFI_KEYWORDS = ['defi', 'decentralized finance'];
const PAUSE_KEYWORDS = ['pause trading', 'stop trading', 'halt trading', 'disable trading'];
const RESUME_KEYWORDS = ['resume trading', 'start trading', 'enable trading', 'unpause'];
const AVOID_KEYWORDS = ['stay away from', 'avoid', 'blacklist', 'no more', 'stop buying', 'don\'t buy', 'do not buy'];
const WATCH_KEYWORDS = ['watch', 'look into', 'research', 'keep an eye on', 'monitor'];
const QUESTION_KEYWORDS = ['?', 'how am i', 'what is', 'what are', 'how is', 'how are', 'show me', 'tell me', 'what\'s'];
const STRATEGY_QUERY_KEYWORDS = ['what is your strategy', 'what\'s your strategy', 'current strategy', 'show strategy', 'trading strategy'];
const BALANCED_KEYWORDS = ['balanced', 'equal allocation', 'reset allocation', 'default allocation', 'even split'];

// ============================================================================
// SECTOR DEFAULTS (mirror agent-v3.2.ts SECTORS)
// ============================================================================

const DEFAULT_SECTOR_TARGETS: Record<string, number> = {
  BLUE_CHIP: 45,
  AI_TOKENS: 20,
  MEME_COINS: 15,
  DEFI: 20,
};

// ============================================================================
// PARSER
// ============================================================================

export function parseStrategyInstruction(
  message: string,
  currentConfig?: {
    stopLossPercent?: number;
    profitTakePercent?: number;
    sectorTargets?: Record<string, number>;
    tradingEnabled?: boolean;
  }
): ParseResult {
  const text = message.toLowerCase().trim();
  const changes: ConfigChange[] = [];
  const source = message;

  // --- Question detection: not a config change ---
  const isQuestion = QUESTION_KEYWORDS.some(k => text.includes(k)) || text.endsWith('?');
  const isStrategyQuery = STRATEGY_QUERY_KEYWORDS.some(k => text.includes(k));
  if (isQuestion && !isStrategyQuery) {
    return { changes: [], understood: true, summary: 'QUERY', requiresConfirmation: false };
  }
  if (isStrategyQuery) {
    return { changes: [], understood: true, summary: 'STRATEGY_QUERY', requiresConfirmation: false };
  }

  // --- Pause / Resume ---
  if (PAUSE_KEYWORDS.some(k => text.includes(k))) {
    changes.push({ parameter: 'tradingEnabled', oldValue: currentConfig?.tradingEnabled ?? true, newValue: false, source });
    return { changes, understood: true, summary: 'Pause all trading activity.', requiresConfirmation: true };
  }
  if (RESUME_KEYWORDS.some(k => text.includes(k))) {
    changes.push({ parameter: 'tradingEnabled', oldValue: currentConfig?.tradingEnabled ?? false, newValue: true, source });
    return { changes, understood: true, summary: 'Resume trading activity.', requiresConfirmation: true };
  }

  // --- Risk adjustments: aggressive / conservative ---
  if (AGGRESSIVE_KEYWORDS.some(k => text.includes(k))) {
    changes.push(
      { parameter: 'kellyFraction', oldValue: 0.25, newValue: 0.35, source },
      { parameter: 'positionCeilingPct', oldValue: 15, newValue: 20, source },
      { parameter: 'confluenceThreshold', oldValue: 55, newValue: 45, source },
    );
    return { changes, understood: true, summary: 'Switch to aggressive mode: larger positions, lower confluence threshold, higher Kelly fraction.', requiresConfirmation: true };
  }
  if (CONSERVATIVE_KEYWORDS.some(k => text.includes(k))) {
    changes.push(
      { parameter: 'kellyFraction', oldValue: 0.25, newValue: 0.15, source },
      { parameter: 'positionCeilingPct', oldValue: 15, newValue: 10, source },
      { parameter: 'confluenceThreshold', oldValue: 55, newValue: 65, source },
    );
    return { changes, understood: true, summary: 'Switch to conservative mode: smaller positions, higher confluence threshold, lower Kelly fraction.', requiresConfirmation: true };
  }

  // --- Stop loss ---
  if (STOP_LOSS_KEYWORDS.some(k => text.includes(k))) {
    const pctMatch = text.match(PERCENT_RE);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      const clamped = Math.max(3, Math.min(50, pct));
      changes.push({ parameter: 'stopLossPercent', oldValue: currentConfig?.stopLossPercent ?? 15, newValue: clamped, source });
      return { changes, understood: true, summary: `Set stop loss to -${clamped}%.`, requiresConfirmation: true };
    }
  }

  // --- Profit take ---
  if (PROFIT_TAKE_KEYWORDS.some(k => text.includes(k))) {
    const pctMatch = text.match(PERCENT_RE);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      const clamped = Math.max(5, Math.min(200, pct));
      changes.push({ parameter: 'profitTakePercent', oldValue: currentConfig?.profitTakePercent ?? 30, newValue: clamped, source });
      return { changes, understood: true, summary: `Set profit take target to +${clamped}%.`, requiresConfirmation: true };
    }
  }

  // --- Sector preferences ---
  if (BALANCED_KEYWORDS.some(k => text.includes(k))) {
    for (const [sector, target] of Object.entries(DEFAULT_SECTOR_TARGETS)) {
      changes.push({ parameter: `sectorTargets.${sector}`, oldValue: currentConfig?.sectorTargets?.[sector] ?? target, newValue: target, source });
    }
    return { changes, understood: true, summary: 'Reset to default balanced allocation (Blue Chip 45%, AI 20%, Meme 15%, DeFi 20%).', requiresConfirmation: true };
  }

  if (BLUE_CHIP_KEYWORDS.some(k => text.includes(k)) && (text.includes('focus') || text.includes('more') || text.includes('increase'))) {
    changes.push(
      { parameter: 'sectorTargets.BLUE_CHIP', oldValue: currentConfig?.sectorTargets?.BLUE_CHIP ?? 45, newValue: 60, source },
      { parameter: 'sectorTargets.AI_TOKENS', oldValue: currentConfig?.sectorTargets?.AI_TOKENS ?? 20, newValue: 15, source },
      { parameter: 'sectorTargets.MEME_COINS', oldValue: currentConfig?.sectorTargets?.MEME_COINS ?? 15, newValue: 10, source },
      { parameter: 'sectorTargets.DEFI', oldValue: currentConfig?.sectorTargets?.DEFI ?? 20, newValue: 15, source },
    );
    return { changes, understood: true, summary: 'Focus on blue chips: BLUE_CHIP 60%, AI 15%, Meme 10%, DeFi 15%.', requiresConfirmation: true };
  }

  if (AI_KEYWORDS.some(k => text.includes(k)) && (text.includes('focus') || text.includes('more') || text.includes('increase'))) {
    changes.push(
      { parameter: 'sectorTargets.AI_TOKENS', oldValue: currentConfig?.sectorTargets?.AI_TOKENS ?? 20, newValue: 35, source },
      { parameter: 'sectorTargets.BLUE_CHIP', oldValue: currentConfig?.sectorTargets?.BLUE_CHIP ?? 45, newValue: 35, source },
      { parameter: 'sectorTargets.MEME_COINS', oldValue: currentConfig?.sectorTargets?.MEME_COINS ?? 15, newValue: 10, source },
      { parameter: 'sectorTargets.DEFI', oldValue: currentConfig?.sectorTargets?.DEFI ?? 20, newValue: 20, source },
    );
    return { changes, understood: true, summary: 'Increase AI allocation: AI 35%, Blue Chip 35%, Meme 10%, DeFi 20%.', requiresConfirmation: true };
  }

  if (MEME_KEYWORDS.some(k => text.includes(k)) && (text.includes('avoid') || text.includes('no ') || text.includes('stop') || text.includes('zero'))) {
    changes.push(
      { parameter: 'sectorTargets.MEME_COINS', oldValue: currentConfig?.sectorTargets?.MEME_COINS ?? 15, newValue: 0, source },
      { parameter: 'sectorTargets.BLUE_CHIP', oldValue: currentConfig?.sectorTargets?.BLUE_CHIP ?? 45, newValue: 50, source },
      { parameter: 'sectorTargets.DEFI', oldValue: currentConfig?.sectorTargets?.DEFI ?? 20, newValue: 25, source },
      { parameter: 'sectorTargets.AI_TOKENS', oldValue: currentConfig?.sectorTargets?.AI_TOKENS ?? 20, newValue: 25, source },
    );
    return { changes, understood: true, summary: 'Remove meme coins: Meme 0%, Blue Chip 50%, DeFi 25%, AI 25%.', requiresConfirmation: true };
  }

  if (DEFI_KEYWORDS.some(k => text.includes(k)) && (text.includes('focus') || text.includes('more') || text.includes('increase'))) {
    changes.push(
      { parameter: 'sectorTargets.DEFI', oldValue: currentConfig?.sectorTargets?.DEFI ?? 20, newValue: 35, source },
      { parameter: 'sectorTargets.BLUE_CHIP', oldValue: currentConfig?.sectorTargets?.BLUE_CHIP ?? 45, newValue: 35, source },
      { parameter: 'sectorTargets.AI_TOKENS', oldValue: currentConfig?.sectorTargets?.AI_TOKENS ?? 20, newValue: 15, source },
      { parameter: 'sectorTargets.MEME_COINS', oldValue: currentConfig?.sectorTargets?.MEME_COINS ?? 15, newValue: 15, source },
    );
    return { changes, understood: true, summary: 'Increase DeFi allocation: DeFi 35%, Blue Chip 35%, AI 15%, Meme 15%.', requiresConfirmation: true };
  }

  // --- Token-specific: avoid ---
  if (AVOID_KEYWORDS.some(k => text.includes(k))) {
    const tokens = extractTokenSymbols(text);
    if (tokens.length > 0) {
      for (const token of tokens) {
        changes.push({ parameter: `blacklist.${token}`, oldValue: null, newValue: true, source });
      }
      return { changes, understood: true, summary: `Avoid trading: ${tokens.join(', ')}.`, requiresConfirmation: true };
    }
  }

  // --- Token-specific: watch ---
  if (WATCH_KEYWORDS.some(k => text.includes(k))) {
    const tokens = extractTokenSymbols(text);
    if (tokens.length > 0) {
      for (const token of tokens) {
        changes.push({ parameter: `watchlist.${token}`, oldValue: null, newValue: true, source });
      }
      return { changes, understood: true, summary: `Add to watchlist: ${tokens.join(', ')}.`, requiresConfirmation: false };
    }
  }

  // --- Not understood ---
  return { changes: [], understood: false, summary: '', requiresConfirmation: false };
}

// ============================================================================
// HELPERS
// ============================================================================

/** Extract token symbols from text — filters out common English words */
const NOISE_WORDS = new Set([
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS',
  'ONE', 'OUR', 'OUT', 'GET', 'SET', 'HAS', 'HIS', 'HOW', 'ITS', 'LET', 'MAY',
  'NEW', 'NOW', 'OLD', 'SEE', 'WAY', 'WHO', 'BOY', 'DID', 'SAY', 'SHE', 'TOO',
  'USE', 'DAD', 'MOM', 'BIG', 'ASK', 'TRY', 'RUN', 'OWN', 'PUT', 'STOP', 'LOSS',
  'TAKE', 'PROFIT', 'MORE', 'LESS', 'STAY', 'AWAY', 'FROM', 'FOCUS', 'AVOID',
  'WATCH', 'LOOK', 'INTO', 'KEEP', 'EYE', 'BUY', 'SELL', 'HOLD', 'WHAT', 'COIN',
  'TOKEN', 'TOKENS', 'COINS', 'BLUE', 'CHIP', 'MEME', 'DEFI', 'HARD', 'FULL',
  'SEND', 'RISK', 'SAFE', 'NO', 'YES', 'MY', 'BE', 'GO', 'DO', 'AT', 'TO', 'ON',
]);

function extractTokenSymbols(text: string): string[] {
  const upper = text.toUpperCase();
  const matches = upper.match(TOKEN_RE) || [];
  return [...new Set(matches.filter(t => !NOISE_WORDS.has(t) && t.length >= 2 && t.length <= 10))];
}

/** Check if a message looks like a strategy instruction (for pre-filtering) */
export function isStrategyInstruction(message: string): boolean {
  const text = message.toLowerCase().trim();
  const allKeywords = [
    ...AGGRESSIVE_KEYWORDS, ...CONSERVATIVE_KEYWORDS,
    ...STOP_LOSS_KEYWORDS, ...PROFIT_TAKE_KEYWORDS,
    ...PAUSE_KEYWORDS, ...RESUME_KEYWORDS,
    ...AVOID_KEYWORDS, ...WATCH_KEYWORDS,
    ...BALANCED_KEYWORDS,
    'allocation', 'sector', 'focus on', 'increase', 'decrease',
    'blue chip', 'meme', 'defi', 'ai token',
  ];
  return allKeywords.some(k => text.includes(k));
}
