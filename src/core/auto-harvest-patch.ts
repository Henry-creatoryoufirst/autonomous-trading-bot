/**
 * AUTO-HARVEST PROFIT TRANSFER — v5.3.0 Patch
 *
 * Adds automatic profit withdrawal to Henry's personal wallet.
 * When harvested profits exceed a configurable threshold, the bot
 * automatically sends ETH back to the originating Coinbase wallet.
 *
 * ============================================================
 * INSTALLATION: Add these code blocks to agent-v3.2.ts
 * ============================================================
 */

// ============================================================
// 1. ADD NEW ENV VARIABLE (add to .env on Railway)
// ============================================================
// PROFIT_DESTINATION_WALLET=0xYOUR_COINBASE_WALLET_ADDRESS
// AUTO_HARVEST_ENABLED=true
// AUTO_HARVEST_THRESHOLD_USD=25        # Min USD profit before auto-send
// AUTO_HARVEST_MIN_ETH_RESERVE=0.002   # Keep this much ETH for gas
// AUTO_HARVEST_COOLDOWN_HOURS=24       # Hours between auto-harvests

// ============================================================
// 2. ADD TO CONFIG SECTION (after profitTaking config ~line 310)
// ============================================================
/*
    // v5.3.0: Auto-Harvest — send realized profits back to owner wallet
    autoHarvest: {
      enabled: process.env.AUTO_HARVEST_ENABLED === 'true',
      destinationWallet: process.env.PROFIT_DESTINATION_WALLET || '',
      thresholdUSD: parseFloat(process.env.AUTO_HARVEST_THRESHOLD_USD || '25'),
      minETHReserve: parseFloat(process.env.AUTO_HARVEST_MIN_ETH_RESERVE || '0.002'),
      cooldownHours: parseFloat(process.env.AUTO_HARVEST_COOLDOWN_HOURS || '24'),
    },
*/

// ============================================================
// 3. ADD TO STATE (after harvestedProfits state property)
// ============================================================
/*
    // v5.3.0: Auto-harvest transfer tracking
    autoHarvestTransfers: [] as Array<{
      timestamp: string;
      amountETH: string;
      amountUSD: number;
      txHash: string;
      destination: string;
    }>,
    totalAutoHarvestedUSD: 0,
    totalAutoHarvestedETH: 0,
    lastAutoHarvestTime: null as string | null,
    autoHarvestCount: 0,
*/

// ============================================================
// 4. ADD THIS FUNCTION (before runTradingCycle ~line 3917)
// ============================================================

import { parseEther, formatEther, type Address } from "viem";

/**
 * v5.3.0: Auto-Harvest Transfer
 *
 * Checks if accumulated harvested profits exceed the threshold,
 * then sends ETH back to the owner's wallet (Coinbase).
 *
 * Logic:
 * 1. Check if auto-harvest is enabled and configured
 * 2. Check cooldown (default 24h between transfers)
 * 3. Calculate sendable amount = (ETH balance - gas reserve - active position value in ETH)
 * 4. Only send if sendable amount in USD > threshold
 * 5. Execute native ETH transfer via CDP SDK
 * 6. Log and track the transfer
 */
async function checkAutoHarvestTransfer(
  account: any,  // CDP EVM account
  cdp: any,      // CDP client
  ethPrice: number,
  ethBalance: number
): Promise<{ sent: boolean; amountETH?: number; amountUSD?: number; txHash?: string; error?: string }> {
  const cfg = CONFIG.autoHarvest;

  // Guard: feature must be enabled
  if (!cfg.enabled) {
    return { sent: false, error: 'Auto-harvest disabled' };
  }

  // Guard: destination wallet must be set
  if (!cfg.destinationWallet || cfg.destinationWallet.length < 42) {
    console.log('⚠️  Auto-harvest: No destination wallet configured');
    return { sent: false, error: 'No destination wallet' };
  }

  // Guard: cooldown check
  if (state.lastAutoHarvestTime) {
    const hoursSinceLast = (Date.now() - new Date(state.lastAutoHarvestTime).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < cfg.cooldownHours) {
      return { sent: false, error: `Cooldown: ${(cfg.cooldownHours - hoursSinceLast).toFixed(1)}h remaining` };
    }
  }

  // Calculate how much ETH we can safely send
  // Reserve enough for gas + min operating balance
  const gasReserveETH = cfg.minETHReserve;
  const sendableETH = ethBalance - gasReserveETH;

  if (sendableETH <= 0) {
    return { sent: false, error: `ETH balance (${ethBalance.toFixed(4)}) below reserve (${gasReserveETH})` };
  }

  // Only send the profit portion, not the entire balance
  // Calculate profit: current portfolio value - initial capital, converted to ETH
  const profitUSD = state.harvestedProfits
    .reduce((sum: number, h: any) => sum + (h.profitUSD || 0), 0) - state.totalAutoHarvestedUSD;

  if (profitUSD < cfg.thresholdUSD) {
    return { sent: false, error: `Unharvested profit ($${profitUSD.toFixed(2)}) below threshold ($${cfg.thresholdUSD})` };
  }

  // Convert profit USD to ETH amount
  let profitETH = profitUSD / ethPrice;

  // Cap at sendable amount (don't overdraw)
  profitETH = Math.min(profitETH, sendableETH);

  // Sanity check: don't send dust
  if (profitETH < 0.0001) {
    return { sent: false, error: `Profit ETH amount too small (${profitETH.toFixed(6)})` };
  }

  const amountUSD = profitETH * ethPrice;

  console.log(`\n💰 AUTO-HARVEST TRANSFER`);
  console.log(`   Sending ${profitETH.toFixed(6)} ETH (~$${amountUSD.toFixed(2)}) to ${cfg.destinationWallet}`);
  console.log(`   ETH balance: ${ethBalance.toFixed(6)} | Reserve: ${gasReserveETH} | Sendable: ${sendableETH.toFixed(6)}`);

  try {
    // Execute the transfer using CDP SDK
    const { transactionHash } = await account.transfer({
      to: cfg.destinationWallet as Address,
      amount: parseEther(profitETH.toFixed(18)),
      token: "eth",
      network: "base-mainnet"  // Base mainnet
    });

    console.log(`   ✅ Transfer sent! TX: ${transactionHash}`);

    // Update state
    const transferRecord = {
      timestamp: new Date().toISOString(),
      amountETH: profitETH.toFixed(6),
      amountUSD: amountUSD,
      txHash: transactionHash,
      destination: cfg.destinationWallet
    };

    state.autoHarvestTransfers.push(transferRecord);
    state.totalAutoHarvestedUSD += amountUSD;
    state.totalAutoHarvestedETH += profitETH;
    state.lastAutoHarvestTime = new Date().toISOString();
    state.autoHarvestCount++;

    // Keep only last 50 transfer records
    if (state.autoHarvestTransfers.length > 50) {
      state.autoHarvestTransfers = state.autoHarvestTransfers.slice(-50);
    }

    // Persist state
    saveState();

    return { sent: true, amountETH: profitETH, amountUSD, txHash: transactionHash };

  } catch (err: any) {
    console.error(`   ❌ Auto-harvest transfer failed:`, err.message);
    return { sent: false, error: err.message };
  }
}


// ============================================================
// 5. ADD TO runTradingCycle() — after the main trade execution
//    (around line ~3950, after the AI decision + executeTrade)
// ============================================================
/*
    // v5.3.0: Check if we should auto-harvest profits to owner wallet
    if (CONFIG.autoHarvest.enabled) {
      const ethBal = await getETHBalance();
      const ethPriceUSD = prices['WETH'] || prices['ETH'] || 2700;
      const harvestResult = await checkAutoHarvestTransfer(account, cdp, ethPriceUSD, ethBal);
      if (harvestResult.sent) {
        console.log(`💰 Auto-harvested ${harvestResult.amountETH?.toFixed(6)} ETH ($${harvestResult.amountUSD?.toFixed(2)}) to owner wallet`);
        addTrade({
          action: 'AUTO_HARVEST',
          fromToken: 'ETH',
          toToken: 'EXTERNAL',
          amountUSD: harvestResult.amountUSD || 0,
          txHash: harvestResult.txHash || '',
          success: true,
          reasoning: `Auto-harvest: sent ${harvestResult.amountETH?.toFixed(6)} ETH to ${CONFIG.autoHarvest.destinationWallet}`,
          timestamp: new Date().toISOString()
        });
      }
    }
*/


// ============================================================
// 6. ADD API ENDPOINT (in the HTTP server section ~line 4400+)
// ============================================================
/*
    // v5.3.0: Auto-harvest status & history
    if (url === '/api/auto-harvest') {
      return sendJSON(res, 200, {
        enabled: CONFIG.autoHarvest.enabled,
        destinationWallet: CONFIG.autoHarvest.destinationWallet ?
          CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : 'Not set',
        thresholdUSD: CONFIG.autoHarvest.thresholdUSD,
        cooldownHours: CONFIG.autoHarvest.cooldownHours,
        minETHReserve: CONFIG.autoHarvest.minETHReserve,
        totalTransferred: {
          usd: state.totalAutoHarvestedUSD,
          eth: state.totalAutoHarvestedETH,
          count: state.autoHarvestCount,
        },
        lastTransfer: state.lastAutoHarvestTime,
        recentTransfers: state.autoHarvestTransfers.slice(-10),
        // Time until next eligible transfer
        nextEligible: state.lastAutoHarvestTime ?
          new Date(new Date(state.lastAutoHarvestTime).getTime() + CONFIG.autoHarvest.cooldownHours * 3600000).toISOString() :
          'Now (no previous transfer)',
      });
    }

    // v5.3.0: Manual trigger for auto-harvest (POST)
    if (url === '/api/auto-harvest/trigger' && req.method === 'POST') {
      if (!CONFIG.autoHarvest.enabled) {
        return sendJSON(res, 400, { error: 'Auto-harvest is not enabled' });
      }
      try {
        const ethBal = await getETHBalance();
        const portfolio = await getPortfolioValue();
        const ethPrice = portfolio.prices?.['WETH'] || 2700;
        // Override cooldown for manual trigger
        const savedCooldown = CONFIG.autoHarvest.cooldownHours;
        CONFIG.autoHarvest.cooldownHours = 0;
        const result = await checkAutoHarvestTransfer(account, cdp, ethPrice, ethBal);
        CONFIG.autoHarvest.cooldownHours = savedCooldown;
        return sendJSON(res, 200, result);
      } catch (err: any) {
        return sendJSON(res, 500, { error: err.message });
      }
    }
*/


// ============================================================
// 7. ADD TO /api/portfolio RESPONSE (to expose in dashboard)
// ============================================================
/*
    // Add these fields to the /api/portfolio response object:
    autoHarvest: {
      enabled: CONFIG.autoHarvest.enabled,
      totalTransferredUSD: state.totalAutoHarvestedUSD,
      totalTransferredETH: state.totalAutoHarvestedETH,
      transferCount: state.autoHarvestCount,
      lastTransfer: state.lastAutoHarvestTime,
      destination: CONFIG.autoHarvest.destinationWallet ?
        CONFIG.autoHarvest.destinationWallet.slice(0, 6) + '...' + CONFIG.autoHarvest.destinationWallet.slice(-4) : null,
    },
*/


// ============================================================
// 8. RAILWAY ENVIRONMENT VARIABLES TO SET:
// ============================================================
/*
    PROFIT_DESTINATION_WALLET = <Henry's Coinbase wallet address>
    AUTO_HARVEST_ENABLED = true
    AUTO_HARVEST_THRESHOLD_USD = 25
    AUTO_HARVEST_MIN_ETH_RESERVE = 0.002
    AUTO_HARVEST_COOLDOWN_HOURS = 24
*/


// ============================================================
// 9. DASHBOARD UPDATE — Add Auto-Harvest card to index.html
//    (This goes in the dashboard HTML, not the agent)
// ============================================================
// See the separate dashboard patch file for the UI component
