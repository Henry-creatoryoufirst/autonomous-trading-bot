/**
 * Never Rest Capital — Chainlink Oracle Feed Addresses
 * Extracted from agent-v3.2.ts (Phase 2 refactor)
 *
 * On-chain price feeds on Base Mainnet — unbreakable, no API key needed.
 */

// AggregatorV3Interface: latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound)
// answer is price with 8 decimals for USD feeds

export const CHAINLINK_FEEDS_BASE: Record<string, { feed: string; decimals: number }> = {
  ETH:   { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // ETH/USD
  WETH:  { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // Same as ETH
  cbBTC: { feed: "0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D", decimals: 8 },  // BTC/USD
  cbETH: { feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 8 },  // Uses ETH feed as proxy
  LINK:  { feed: "0x17CAb8FE31E32f08326e5E27412894e49B0f9D65", decimals: 8 },  // LINK/USD
  USDC:  { feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", decimals: 8 },  // USDC/USD
  EURC:  { feed: "0xDAe398520e2B67cd3f27aeF9Cf14D93D927f8250", decimals: 8 },  // EURC/USD
};

/** Function selector for Chainlink's latestAnswer() → int256 */
export const CHAINLINK_ABI_FRAGMENT = "0x50d25bcd";
