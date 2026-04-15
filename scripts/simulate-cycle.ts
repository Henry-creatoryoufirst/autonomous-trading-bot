#!/usr/bin/env npx tsx
/**
 * Never Rest Capital — Cycle Integration Simulation CLI
 *
 * Phase 7 of the monolith refactor. Entry point for CI validation.
 *
 * Usage:
 *   npx tsx scripts/simulate-cycle.ts          # Run cycle sim + fleet sim
 *   npx tsx scripts/simulate-cycle.ts --fleet  # Fleet-only
 *
 * Exit code:
 *   0 = all simulations passed
 *   1 = at least one simulation failed
 */

import { simulateCycle, simulateFleet, makeMockMarketData } from '../src/core/simulation/simulate-cycle.js';
import { createBot } from '../src/core/bot/bot-factory.js';
import { botConfigFromEnv } from '../src/core/bot/bot-config.js';
import type { BotConfig } from '../src/core/bot/bot-config.js';

// ============================================================================
// HELPER
// ============================================================================

function makeTestConfig(botId: string, overrides: Partial<BotConfig> = {}): BotConfig {
  return botConfigFromEnv(['ETH', 'BTC', 'USDC'], {
    botId,
    walletAddress: `0x${'0'.repeat(40)}`,
    instanceName:  `Test Bot (${botId})`,
    trading: {
      enabled:            false, // paper-trade mode
      maxBuySize:         100,
      maxSellPercent:     50,
      intervalMinutes:    15,
      maxPositionPercent: 25,
      minPositionUSD:     15,
      rebalanceThreshold: 10,
      slippageBps:        100,
      profitTaking: {
        enabled: true, targetPercent: 30, sellPercent: 30,
        minHoldingUSD: 5, cooldownHours: 8, tiers: [],
      },
      stopLoss: {
        enabled: true, percentThreshold: -15, sellPercent: 75,
        minHoldingUSD: 5, trailingEnabled: true, trailingPercent: -12,
      },
    },
    ...overrides,
  });
}

// ============================================================================
// SINGLE CYCLE SIM
// ============================================================================

async function runSingleCycleSim(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 CYCLE SIMULATION — single bot, one heavy cycle');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const bot    = createBot(makeTestConfig('sim-bot-1'));
  const market = makeMockMarketData();
  const result = await simulateCycle(bot, market);

  console.log(`Bot:       ${result.botId}`);
  console.log(`Cycle #:   ${result.cycleNumber}`);
  console.log(`Stages:    ${result.stagesCompleted.join(' → ')}`);
  console.log(`Prices:    ${Object.keys(result.currentPrices).join(', ')}`);
  console.log(`Duration:  ${result.durationMs}ms`);
  console.log(`Halted:    ${result.halted}${result.haltReason ? ` (${result.haltReason})` : ''}`);

  const passed = !result.halted
    && result.stagesCompleted.includes('SETUP')
    && result.stagesCompleted.includes('INTELLIGENCE');

  console.log(`\nResult: ${passed ? '✅ PASSED' : '❌ FAILED'}\n`);
  return passed;
}

// ============================================================================
// FLEET SIM
// ============================================================================

async function runFleetSim(): Promise<boolean> {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🚀 FLEET SIMULATION — 3 bots, parallel cycles, isolation check');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const configs: BotConfig[] = [
    makeTestConfig('henry',        { walletAddress: '0x' + '1'.repeat(40) }),
    makeTestConfig('ryan-denome',  { walletAddress: '0x' + '2'.repeat(40) }),
    makeTestConfig('kathy-howard', { walletAddress: '0x' + '3'.repeat(40) }),
  ];

  const fleet = await simulateFleet(configs, makeMockMarketData());

  console.log(`Fleet size:   ${fleet.bots.length} bots`);
  console.log(`Total time:   ${fleet.totalDurationMs}ms`);

  for (const result of fleet.bots) {
    const status = result.halted ? '❌ HALTED' : '✅ OK';
    console.log(
      `  ${status}  ${result.botId.padEnd(14)} ` +
      `cycle=${result.cycleNumber} ` +
      `stages=[${result.stagesCompleted.join(',')}] ` +
      `${result.durationMs}ms`,
    );
  }

  if (fleet.failures.length > 0) {
    console.log('\nFailures:');
    for (const f of fleet.failures) {
      console.log(`  ❌ ${f}`);
    }
  }

  console.log(`\nResult: ${fleet.allPassed ? '✅ PASSED' : '❌ FAILED'}\n`);
  return fleet.allPassed;
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fleetOnly = args.includes('--fleet');

  let allPassed = true;

  if (!fleetOnly) {
    const singleOk = await runSingleCycleSim();
    if (!singleOk) allPassed = false;
  }

  const fleetOk = await runFleetSim();
  if (!fleetOk) allPassed = false;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`CYCLE SIM FINAL: ${allPassed ? '✅ ALL PASSED' : '❌ FAILED'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Simulation error:', err);
  process.exit(1);
});
