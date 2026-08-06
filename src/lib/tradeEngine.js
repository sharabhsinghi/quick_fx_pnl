// ── Trade Engine: pure calculation, scoring, and validation logic ──

const PIP_SIZES = {
  forex: 0.0001,
  jpy: 0.01,
};
const PIP_VALUE_PER_LOT = 10; // USD per pip per standard lot (approximate for major pairs)

/**
 * Determine pip size for a forex pair symbol.
 * Symbols containing "JPY" use 0.01; all others use 0.0001.
 */
function getPipSize(symbol = '') {
  return symbol.toUpperCase().includes('JPY') ? PIP_SIZES.jpy : PIP_SIZES.forex;
}

/**
 * Main calculation function.
 *
 * @param {Object} wizardData - collected wizard state
 * @param {string} wizardData.assetClass         - "Forex" | "Stocks" | "Crypto" | "Indices"
 * @param {string} wizardData.symbol             - e.g. "EUR/USD"
 * @param {string} wizardData.marketStructure    - "Uptrend" | "Downtrend" | "Ranging"
 * @param {string} wizardData.strategy           - selected strategy string
 * @param {string} wizardData.keyLevel           - key level option string
 * @param {string} wizardData.triggerPattern     - selected candlestick/chart pattern
 * @param {Object} wizardData.indicators         - { rsiDivergence, rsiExtreme, maCrossover, volumeSpike, macdHistogramFlip }
 * @param {number} wizardData.accountBalance     - account balance in currency
 * @param {number} wizardData.riskPercentage     - risk % (default 1.0)
 * @param {number} wizardData.entryPrice         - entry price
 * @param {number} wizardData.stopLossPrice      - stop loss price
 * @param {number} wizardData.takeProfitPrice    - take profit price
 *
 * @returns {Object} result with fields: error | { riskAmount, riskPerUnit, rewardPerUnit, rrr, positionSize, isRrrValid, confluenceScore, verdict, warnings }
 */
export function calculateTradeMetrics(wizardData) {
  const {
    assetClass = 'Forex',
    symbol = '',
    marketStructure = '',
    strategy = '',
    keyLevel = '',
    triggerPattern = '',
    indicators = {},
    accountBalance,
    riskPercentage = 1.0,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
  } = wizardData;

  const entry = Number(entryPrice);
  const sl    = Number(stopLossPrice);
  const tp    = Number(takeProfitPrice);
  const bal   = Number(accountBalance);
  const riskPct = Number(riskPercentage);

  // ── Validation ──────────────────────────────────────────────────────────────
  if (isNaN(entry) || isNaN(sl) || isNaN(tp) || isNaN(bal) || isNaN(riskPct)) {
    return { error: 'Please fill in all numeric fields.' };
  }
  if (bal <= 0) {
    return { error: 'Account balance must be greater than zero.' };
  }
  if (sl === entry) {
    return { error: 'Invalid Stop Loss level.' };
  }

  const riskPerUnit   = Math.abs(entry - sl);
  const rewardPerUnit = Math.abs(tp - entry);

  if (riskPerUnit === 0) {
    return { error: 'Invalid Stop Loss level.' };
  }

  // Directional stop-loss validation: if TP > entry (long bias) then SL must be < entry
  const longBias = tp > entry;
  if (longBias && sl >= entry) {
    return { error: 'Invalid Stop Loss level.' };
  }
  if (!longBias && sl <= entry) {
    return { error: 'Invalid Stop Loss level.' };
  }

  // ── Core Calculations ───────────────────────────────────────────────────────
  const riskAmount = bal * (riskPct / 100);
  const rrr = rewardPerUnit / riskPerUnit;
  const isRrrValid = rrr >= 1.5;

  let positionSize;
  const isForex = assetClass === 'Forex';
  if (isForex) {
    const pipSize = getPipSize(symbol);
    const pipRisk = Math.abs(entry - sl) / pipSize;
    positionSize  = riskAmount / (pipRisk * PIP_VALUE_PER_LOT); // in standard lots
  } else {
    positionSize = riskAmount / riskPerUnit; // in units
  }

  // ── Confluence Scoring ──────────────────────────────────────────────────────
  let score = 0;

  // 1. Market Structure Alignment (+25 pts for trend/range aligned, +0 for counter-trend)
  const isCounterTrend = typeof strategy === 'string' &&
    strategy.toLowerCase().includes('counter');
  if (!isCounterTrend) {
    score += 25;
  }

  // 2. Key Level Location (+30 pts)
  if (keyLevel && keyLevel !== 'None/Floating') {
    score += 30;
  }

  // 3. Trigger Pattern (+25 pts)
  if (triggerPattern && triggerPattern !== '') {
    score += 25;
  }

  // 4. Indicator Confluence (+5 per indicator, max +10)
  const indicatorCount = [
    indicators.rsiDivergence,
    indicators.rsiExtreme,
    indicators.maCrossover,
    indicators.volumeSpike,
    indicators.macdHistogramFlip,
  ].filter(Boolean).length;

  score += Math.min(indicatorCount * 5, 10);

  // 5. RRR Bonus/Penalty
  if (rrr >= 2.0) {
    score += 10;
  } else if (rrr >= 1.5) {
    score += 5;
  } else {
    score -= 20;
  }

  const confluenceScore = Math.max(0, score);

  // ── Final Verdict ───────────────────────────────────────────────────────────
  let verdict;
  const floatingKey = keyLevel === 'None/Floating';

  if (confluenceScore >= 80 && isRrrValid && !floatingKey) {
    verdict = 'EXECUTE_TRADE';
  } else if (confluenceScore >= 65 && confluenceScore <= 79 && isRrrValid) {
    verdict = 'REDUCED_POSITION_EXECUTE';
  } else {
    verdict = 'NO_TRADE';
  }

  // ── Warnings ────────────────────────────────────────────────────────────────
  const warnings = [];
  if (floatingKey) {
    warnings.push('No key level identified — elevated risk setup.');
  }
  if (!isRrrValid) {
    warnings.push(`RRR of ${rrr.toFixed(2)} is below the minimum threshold of 1.5.`);
  }
  if (isCounterTrend) {
    warnings.push('Counter-trend strategy selected — lower probability setup.');
  }

  return {
    riskAmount,
    riskPerUnit,
    rewardPerUnit,
    rrr,
    isRrrValid,
    positionSize,
    positionSizeUnit: isForex ? 'lots' : 'units',
    confluenceScore,
    verdict,
    warnings,
    raw: { isCounterTrend, indicatorCount, floatingKey },
  };
}
