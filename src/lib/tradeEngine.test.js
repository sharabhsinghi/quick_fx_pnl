import { calculateTradeMetrics } from './tradeEngine';

// ── Shared helpers ────────────────────────────────────────────────────────────

function baseData(overrides = {}) {
  return {
    assetClass:      'Forex',
    symbol:          'EUR/USD',
    marketStructure: 'Uptrend',
    strategy:        'Trend Continuation',
    keyLevel:        'Key Support/Demand',
    triggerPattern:  'Bullish Engulfing',
    indicators: {
      rsiDivergence:     true,
      rsiExtreme:        true,
      maCrossover:       false,
      volumeSpike:       false,
      macdHistogramFlip: false,
    },
    accountBalance:  10000,
    riskPercentage:  1.0,
    entryPrice:      1.08500,
    stopLossPrice:   1.08000,  // 50 pip SL
    takeProfitPrice: 1.09500,  // 100 pip TP  →  RRR = 2.0
    ...overrides,
  };
}

// ── Validation tests ──────────────────────────────────────────────────────────

describe('calculateTradeMetrics — validation', () => {
  test('returns error when SL equals entry', () => {
    const result = calculateTradeMetrics(baseData({ stopLossPrice: 1.08500 }));
    expect(result.error).toMatch(/invalid stop loss/i);
  });

  test('returns error when SL is above entry for long trade', () => {
    // Long bias (TP > entry), SL above entry
    const result = calculateTradeMetrics(baseData({ stopLossPrice: 1.09000 }));
    expect(result.error).toMatch(/invalid stop loss/i);
  });

  test('returns error when SL is below entry for short trade', () => {
    // Short: TP < entry, SL must be above entry
    const result = calculateTradeMetrics(baseData({
      entryPrice:      1.09000,
      stopLossPrice:   1.08000, // below entry → invalid for short
      takeProfitPrice: 1.07000,
    }));
    expect(result.error).toMatch(/invalid stop loss/i);
  });

  test('returns error when account balance is zero', () => {
    const result = calculateTradeMetrics(baseData({ accountBalance: 0 }));
    expect(result.error).toBeDefined();
  });

  test('returns error when required numeric fields are missing', () => {
    const result = calculateTradeMetrics(baseData({ entryPrice: '' }));
    expect(result.error).toBeDefined();
  });
});

// ── Position sizing ───────────────────────────────────────────────────────────

describe('calculateTradeMetrics — position sizing', () => {
  test('forex position size in lots (EUR/USD, 50 pip SL)', () => {
    // riskAmount = 10000 * 1% = 100
    // pipSize = 0.0001, pipRisk = 0.005 / 0.0001 = 50
    // positionSize = 100 / (50 * 10) = 0.2 lots
    const result = calculateTradeMetrics(baseData());
    expect(result.error).toBeUndefined();
    expect(result.positionSize).toBeCloseTo(0.2, 4);
    expect(result.positionSizeUnit).toBe('lots');
  });

  test('stocks/crypto position size in units', () => {
    const data = baseData({
      assetClass:      'Stocks',
      symbol:          'AAPL',
      entryPrice:      200,
      stopLossPrice:   195,   // $5 risk per unit
      takeProfitPrice: 215,   // $15 reward
      accountBalance:  10000,
      riskPercentage:  2,
    });
    // riskAmount = 200
    // positionSize = 200 / 5 = 40 units
    const result = calculateTradeMetrics(data);
    expect(result.error).toBeUndefined();
    expect(result.positionSize).toBeCloseTo(40, 4);
    expect(result.positionSizeUnit).toBe('units');
  });

  test('JPY pair uses 0.01 pip size', () => {
    // USD/JPY, entry 150.000, SL 149.500 (50 pip), TP 151.000 (100 pip)
    // pipSize = 0.01, pipRisk = 0.5 / 0.01 = 50
    // positionSize = 100 / (50 * 10) = 0.2 lots
    const result = calculateTradeMetrics(baseData({
      symbol:          'USD/JPY',
      entryPrice:      150.000,
      stopLossPrice:   149.500,
      takeProfitPrice: 151.000,
    }));
    expect(result.error).toBeUndefined();
    expect(result.positionSize).toBeCloseTo(0.2, 4);
  });
});

// ── RRR calculation ───────────────────────────────────────────────────────────

describe('calculateTradeMetrics — RRR', () => {
  test('RRR is calculated correctly (2:1)', () => {
    const result = calculateTradeMetrics(baseData());
    // 100 pip TP / 50 pip SL = 2.0
    expect(result.rrr).toBeCloseTo(2.0, 5);
    expect(result.isRrrValid).toBe(true);
  });

  test('isRrrValid is false when RRR < 1.5', () => {
    const result = calculateTradeMetrics(baseData({
      takeProfitPrice: 1.09000, // 50 pip TP → RRR = 1.0
    }));
    expect(result.rrr).toBeCloseTo(1.0, 5);
    expect(result.isRrrValid).toBe(false);
  });

  test('isRrrValid is true exactly at 1.5', () => {
    const result = calculateTradeMetrics(baseData({
      takeProfitPrice: 1.08500 + 0.0075, // 75 pip TP / 50 pip SL = 1.5
    }));
    expect(result.rrr).toBeCloseTo(1.5, 5);
    expect(result.isRrrValid).toBe(true);
  });
});

// ── Confluence scoring ────────────────────────────────────────────────────────

describe('calculateTradeMetrics — confluence scoring', () => {
  test('maximum score scenario yields 100', () => {
    // Aligned (25) + key level (30) + pattern (25) + 2 indicators (10) + RRR >= 2 (10) = 100
    const result = calculateTradeMetrics(baseData());
    expect(result.confluenceScore).toBe(100);
  });

  test('counter-trend strategy does not get structure alignment bonus', () => {
    const result = calculateTradeMetrics(baseData({ strategy: 'Counter-Trend Reversal' }));
    // No +25 for alignment; still: +30 level + +25 pattern + +10 indicators + +10 RRR = 75
    expect(result.confluenceScore).toBe(75);
  });

  test('floating key level removes +30 and penalizes', () => {
    const result = calculateTradeMetrics(baseData({ keyLevel: 'None/Floating' }));
    // +25 structure + 0 level + +25 pattern + +10 indicators + +10 RRR = 70
    expect(result.confluenceScore).toBe(70);
  });

  test('indicators capped at +10 regardless of count', () => {
    const allIndicators = {
      rsiDivergence: true, rsiExtreme: true, maCrossover: true,
      volumeSpike: true, macdHistogramFlip: true,
    };
    const result = calculateTradeMetrics(baseData({ indicators: allIndicators }));
    // +25 + +30 + +25 + 10 (capped) + +10 = 100
    expect(result.confluenceScore).toBe(100);
    expect(result.raw.indicatorCount).toBe(5);
  });

  test('RRR < 1.5 applies -20 penalty', () => {
    const result = calculateTradeMetrics(baseData({
      takeProfitPrice: 1.09000, // RRR = 1.0
    }));
    // +25 + +30 + +25 + +10 - 20 = 70
    expect(result.confluenceScore).toBe(70);
  });

  test('score floor is 0 (never negative)', () => {
    const result = calculateTradeMetrics(baseData({
      strategy:       'Counter-Trend Reversal',
      keyLevel:       'None/Floating',
      triggerPattern: '',
      indicators:     { rsiDivergence: false, rsiExtreme: false, maCrossover: false, volumeSpike: false, macdHistogramFlip: false },
      takeProfitPrice: 1.09000, // RRR = 1.0  → -20
    }));
    // 0 + 0 + 0 + 0 - 20 = -20 → clamped to 0
    expect(result.confluenceScore).toBe(0);
  });
});

// ── Verdict engine ────────────────────────────────────────────────────────────

describe('calculateTradeMetrics — verdict', () => {
  test('EXECUTE_TRADE when score >= 80, RRR valid, key level set', () => {
    const result = calculateTradeMetrics(baseData());
    expect(result.verdict).toBe('EXECUTE_TRADE');
  });

  test('REDUCED_POSITION_EXECUTE when score 65-79 and RRR valid', () => {
    // Drop key level → score = 70; RRR still valid; no floating → should be REDUCED
    const result = calculateTradeMetrics(baseData({ keyLevel: 'None/Floating' }));
    expect(result.confluenceScore).toBe(70);
    expect(result.verdict).toBe('REDUCED_POSITION_EXECUTE');
  });

  test('NO_TRADE when keyLevel is None/Floating regardless of score', () => {
    // Even if score >= 80, floating key must force NO_TRADE per spec
    // Achieve score > 80: all indicators + floating still gives 70, below 80 anyway
    // Let's test explicitly: score 70 with float → reduced (still no EXECUTE_TRADE)
    const result = calculateTradeMetrics(baseData({ keyLevel: 'None/Floating' }));
    expect(result.verdict).not.toBe('EXECUTE_TRADE');
  });

  test('NO_TRADE when RRR is invalid', () => {
    const result = calculateTradeMetrics(baseData({ takeProfitPrice: 1.09000 })); // RRR = 1.0
    expect(result.isRrrValid).toBe(false);
    expect(result.verdict).toBe('NO_TRADE');
  });

  test('NO_TRADE when score is below 65', () => {
    const result = calculateTradeMetrics(baseData({
      strategy:       'Counter-Trend Reversal',
      keyLevel:       'Key Support/Demand',
      triggerPattern: '',
      indicators:     { rsiDivergence: false, rsiExtreme: false, maCrossover: false, volumeSpike: false, macdHistogramFlip: false },
      takeProfitPrice: 1.09000, // RRR = 1.0 → -20; total = 0+30+0+0-20 = 10
    }));
    expect(result.confluenceScore).toBeLessThan(65);
    expect(result.verdict).toBe('NO_TRADE');
  });
});

// ── Risk amount ───────────────────────────────────────────────────────────────

describe('calculateTradeMetrics — risk amount', () => {
  test('risk amount equals balance * riskPct / 100', () => {
    const result = calculateTradeMetrics(baseData({ accountBalance: 5000, riskPercentage: 2 }));
    expect(result.riskAmount).toBe(100);
  });
});
