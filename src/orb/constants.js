// ORB screener — shared defaults.
//
// Every threshold here is a DEFAULT only: the running config is persisted in
// IndexedDB and edited on the ORB → CONFIG screen. Nothing in the screener or
// backtest engine reads these constants directly at analysis time; they are
// merged into a config object that is passed down explicitly, so a backtest can
// override thresholds for a single run without touching the live screener.

// Top liquid S&P 500 / Nasdaq-100 tickers (by avg dollar volume).
export const DEFAULT_TICKERS = [
  'SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'AMD', 'MSFT', 'AMZN', 'META', 'GOOGL',
  'AVGO', 'NFLX', 'PLTR', 'SMCI', 'JPM', 'BAC', 'XOM', 'INTC', 'F', 'CCL', 'SOFI',
];

export const DEFAULT_SCREENER_CONFIG = {
  tickers: DEFAULT_TICKERS.slice(),

  // Opening range: first 15 minutes of the regular session = 3 x 5-min candles.
  orbMinutes: 15,
  barMinutes: 5,

  rvolThreshold: 1.5,
  rvolLookbackDays: 10,        // 5 / 10 / 20

  rsiPeriod: 9,
  rsiOverbought: 70,           // reject longs at or above
  rsiOversold: 30,             // reject shorts at or below

  gapMinPct: 1.0,
  gapMaxPct: 5.0,

  atrPeriod: 14,
  atrRangeMinRatio: 0.15,      // ORB range too tight vs ATR -> likely noise
  atrRangeMaxRatio: 0.75,      // ORB range too wide vs ATR -> likely already extended

  // false  = reference behaviour (ported from the HTML prototype): scan forward
  //          and take the FIRST candle where every filter passes; if none ever
  //          qualifies, report the first attempt as WEAK with its fail reasons.
  // true   = strict single-shot: the first candle closing outside the range IS
  //          the signal, and the filters only decide TRIGGERED vs WEAK on it.
  singleShot: false,
};

// Which filters gate TRIGGERED. Used by the backtest so a run can be repeated
// with a filter switched off (an honest re-run, not a post-hoc guess).
export const FILTER_KEYS = ['bodyClean', 'rvol', 'rsi', 'vwap', 'gap', 'atrRange'];

export const FILTER_LABELS = {
  bodyClean: 'Clean breakout',
  rvol: 'RVOL',
  rsi: 'RSI',
  vwap: 'VWAP',
  gap: 'Gap %',
  atrRange: 'ATR range',
};

// Trade-management defaults for the backtest engine.
//
// The stop percentage is read against whatever is actually being traded. On the
// underlying, a 5-min ORB stop lives in the 0.3-1% band on liquid large caps, so
// 0.75% is the equity default. On an option, the same move is amplified several
// times over by the contract's leverage, which is why a 20% premium stop is
// ordinary there — see OPTIONS_TRADE_DEFAULTS below.
export const DEFAULT_TRADE_CONFIG = {
  instrument: 'equity',         // 'equity' | 'options'
  startingCapital: 10000,

  // Entry
  entryMode: 'breakout_close',  // 'breakout_close' | 'next_open'

  // Stop loss — percentages are of the traded instrument's own price
  slMode: 'percent',            // 'percent' | 'dollar' | 'r' | 'orb'  — the INITIAL stop
  slValue: 0.75,                // percent of entry price, or $/share, or R multiple
  slType: 'trailing',           // 'strict' | 'trailing' | 'giveback'

  // 'giveback' trails the OPEN PROFIT rather than the price: the stop follows
  // the best level the trade has reached and keeps (100 - givebackPct)% of the
  // profit earned so far. Trailing a percentage of PRICE is a different thing
  // entirely — a 20% price trail on an intraday equity move never fires, while
  // a 20% giveback exits once the trade hands back a fifth of its best gain.
  givebackPct: 20,
  // The trail stays disarmed until the trade is this far in front (percent of
  // entry price). Without it the first tick of profit would drag the stop to
  // breakeven and noise would shake the position out immediately.
  givebackActivatePct: 0.5,

  // Take profit
  tpEnabled: false,
  tpMode: 'r',                  // 'percent' | 'dollar' | 'r'
  tpValue: 2,

  // When a single 5-min candle's range contains BOTH the stop and the target we
  // cannot know which printed first without tick data.
  ambiguity: 'stop_first',      // 'stop_first' (conservative) | 'target_first'

  // Position sizing
  sizing: 'risk_pct',           // 'risk_pct' | 'fixed_dollar' | 'fixed_shares'
  riskPct: 1,                   // % of current equity risked per trade
  fixedDollar: 10000,           // notional per trade
  fixedShares: 100,

  allowFractionalShares: false,
  maxPositionPctOfEquity: 100,  // cap notional so a tiny stop can't imply 50x leverage

  // Costs
  slippageBps: 2,               // per side, basis points of price
  commissionPerTrade: 1,        // flat $, charged once per round trip

  // Intraday only — no overnight holds.
  forceCloseAtSessionEnd: true,
};

// ── Options mode ─────────────────────────────────────────────────────────────
//
// The same ORB signal, expressed as a long call (on a long breakout) or a long
// put (on a short breakout), priced with Black-Scholes because no historical
// option quotes exist to replay.
//
// Read every options result with the model's limits in mind: European exercise,
// a single volatility held constant for the life of the trade (so no intraday
// IV crush or expansion), and no skew. At 0 DTE those limits bite hardest —
// real same-day contracts carry pin risk and a steep skew that a flat-sigma
// model does not reproduce. Treat the output as indicative, not as a fill.
export const OPTIONS_TRADE_DEFAULTS = {
  // Contract selection
  dteDays: 0,                   // 0 = same-day expiry (0DTE)
  expiryMode: 'exact_days',     // 'exact_days' | 'next_friday'
  strikeBasis: 'session_open',  // 'session_open' | 'signal_price'
  strikeOffsetSteps: 0,         // +1 = one strike further OTM, -1 = one ITM

  // Volatility input
  sigmaSource: 'captured_else_rv', // 'captured_else_rv' | 'realized_vol' | 'flat'
  rvPeriod: 20,                 // trailing daily bars for realised vol
  ivMultiplier: 1.15,           // IV usually trades above realised vol
  flatIv: 30,                   // percent, used when sigmaSource is 'flat'
  riskFreeRate: 4.0,            // percent, annualised
  dividendYield: 0.0,           // percent, annualised

  // Exits are measured on the option's own premium
  slMode: 'percent',
  slValue: 20,                  // 20% of premium — ordinary for a contract
  slType: 'trailing',           // 'strict' | 'trailing' | 'giveback'
  givebackPct: 20,              // keep 80% of the best premium gain
  givebackActivatePct: 15,      // arm once the premium is 15% in front
  tpEnabled: false,
  tpMode: 'percent',
  tpValue: 50,

  // Costs. Spread defaults to zero (fills at the model mid) — that is a clean
  // read on whether the signal has edge, NOT a tradeable result: crossing a
  // short-dated spread twice routinely flips a strategy's sign.
  optionSpreadPct: 0,           // half-spread as a percent of premium, per side
  commissionPerContract: 0.65,
  contractMultiplier: 100,
};

// Twelve Data free tier. Bump these if the plan is upgraded.
export const DEFAULT_RATE_LIMITS = {
  requestsPerMinute: 8,
  requestsPerDay: 800,
  maxPointsPerRequest: 5000,
};

export const SESSION_OPEN_MINS = 9 * 60 + 30;   // 09:30 ET
export const SESSION_CLOSE_MINS = 16 * 60;      // 16:00 ET
