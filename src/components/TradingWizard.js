import React, { useState, useReducer, useCallback } from 'react';
import { calculateTradeMetrics } from '../lib/tradeEngine';

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'ASSET' },
  { id: 2, label: 'STRATEGY' },
  { id: 3, label: 'LEVEL' },
  { id: 4, label: 'PATTERN' },
  { id: 5, label: 'INDICATORS' },
  { id: 6, label: 'RISK' },
];

const ASSET_CLASSES  = ['Forex', 'Stocks', 'Crypto', 'Indices'];
const MARKET_STRUCTS = ['Uptrend', 'Downtrend', 'Ranging'];
const TIMEFRAMES     = ['1M', '5M', '15M', '1H', '4H', '1D'];

const STRATEGIES = {
  Uptrend:   ['Trend Continuation', 'Breakout', 'Counter-Trend Reversal'],
  Downtrend: ['Trend Continuation', 'Breakout', 'Counter-Trend Reversal'],
  Ranging:   ['Range Boundary Fade', 'Range Breakout & Retest'],
};

const KEY_LEVELS = [
  { value: 'Key Support/Demand',     icon: '⊕', sub: 'Demand zone / support floor' },
  { value: 'Key Resistance/Supply',  icon: '⊖', sub: 'Supply zone / resistance ceiling' },
  { value: 'Dynamic EMA/MA',         icon: '〰', sub: 'Moving average acting as S/R' },
  { value: 'Fibonacci Level',        icon: '⚡', sub: '0.382 / 0.5 / 0.618 retracement' },
  { value: 'None/Floating',          icon: '?', sub: 'No clear level — elevated risk' },
];

const PATTERNS = {
  bullish: [
    { value: 'Bullish Engulfing', icon: '🕯', sub: 'Strong buy candle wraps prior' },
    { value: 'Hammer/Pin Bar',    icon: '📌', sub: 'Long wick rejection at lows' },
    { value: 'Morning Star',      icon: '⭐', sub: '3-candle bullish reversal' },
    { value: 'Double Bottom',     icon: '⟌', sub: 'W-shape price structure' },
    { value: 'Falling Wedge',     icon: '◣', sub: 'Converging lower highs/lows' },
  ],
  bearish: [
    { value: 'Bearish Engulfing', icon: '🕯', sub: 'Strong sell candle wraps prior' },
    { value: 'Shooting Star',     icon: '💫', sub: 'Long wick rejection at highs' },
    { value: 'Evening Star',      icon: '🌑', sub: '3-candle bearish reversal' },
    { value: 'Double Top',        icon: '⟋', sub: 'M-shape price structure' },
    { value: 'Rising Wedge',      icon: '◤', sub: 'Converging higher highs/lows' },
  ],
};

const INDICATORS = [
  { key: 'rsiDivergence',      label: 'RSI DIVERGENCE',         desc: 'Price vs RSI divergence' },
  { key: 'rsiExtreme',         label: 'RSI EXTREME',            desc: 'Oversold / Overbought' },
  { key: 'maCrossover',        label: 'MA CROSSOVER',           desc: 'MA cross signal' },
  { key: 'volumeSpike',        label: 'VOLUME SPIKE',           desc: 'Above-average volume' },
  { key: 'macdHistogramFlip',  label: 'MACD HISTOGRAM FLIP',    desc: 'Histogram color change' },
];

// ── Initial wizard state ──────────────────────────────────────────────────────

const INITIAL_STATE = {
  // Step 1
  assetClass: 'Forex',
  symbol: '',
  marketStructure: '',
  // Step 2
  timeframe: '',
  strategy: '',
  // Step 3
  keyLevel: '',
  // Step 4
  triggerPattern: '',
  // Step 5
  indicators: {
    rsiDivergence: false,
    rsiExtreme: false,
    maCrossover: false,
    volumeSpike: false,
    macdHistogramFlip: false,
  },
  // Step 6
  accountBalance: '',
  riskPercentage: '1.0',
  entryPrice: '',
  stopLossPrice: '',
  takeProfitPrice: '',
};

function wizardReducer(state, action) {
  switch (action.type) {
    case 'SET': return { ...state, [action.key]: action.value };
    case 'SET_INDICATOR':
      return { ...state, indicators: { ...state.indicators, [action.key]: !state.indicators[action.key] } };
    case 'RESET': return { ...INITIAL_STATE };
    default: return state;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressBar({ currentStep }) {
  return (
    <div className="wiz-progress">
      {STEPS.map((s, i) => {
        const isDone   = currentStep > s.id;
        const isActive = currentStep === s.id;
        return (
          <div key={s.id} className={`wiz-step-dot ${isDone ? 'done' : ''} ${isActive ? 'active' : ''}`}>
            <div className="wiz-dot-circle">{isDone ? '✓' : s.id}</div>
            <div className="wiz-dot-label">{s.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Step 1: Asset & Market Structure
function Step1({ state, dispatch }) {
  return (
    <div>
      <div className="wiz-step-title">STEP 1 · ASSET &amp; MARKET STRUCTURE</div>

      <div className="wiz-row2">
        <div className="wiz-field">
          <label className="wiz-label">ASSET CLASS</label>
          <select className="wiz-select" value={state.assetClass}
            onChange={e => dispatch({ type: 'SET', key: 'assetClass', value: e.target.value })}>
            {ASSET_CLASSES.map(a => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div className="wiz-field">
          <label className="wiz-label">SYMBOL <span className="wiz-label-hint">e.g. EUR/USD, AAPL</span></label>
          <input className="wiz-input" placeholder="EUR/USD"
            value={state.symbol}
            onChange={e => dispatch({ type: 'SET', key: 'symbol', value: e.target.value })} />
        </div>
      </div>

      <div className="wiz-field">
        <label className="wiz-label">MARKET STRUCTURE</label>
        <div className="wiz-card-grid">
          {MARKET_STRUCTS.map(m => (
            <button key={m} className={`wiz-option-card ${state.marketStructure === m ? 'selected' : ''}`}
              onClick={() => {
                dispatch({ type: 'SET', key: 'marketStructure', value: m });
                dispatch({ type: 'SET', key: 'strategy', value: '' }); // reset strategy on struct change
              }}>
              <div className="wiz-card-icon">{m === 'Uptrend' ? '↗' : m === 'Downtrend' ? '↘' : '↔'}</div>
              <div className="wiz-card-label">{m.toUpperCase()}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 2: Timeframe & Strategy
function Step2({ state, dispatch }) {
  const strategies = state.marketStructure ? (STRATEGIES[state.marketStructure] || []) : [];

  return (
    <div>
      <div className="wiz-step-title">STEP 2 · TIMEFRAME &amp; STRATEGY</div>

      <div className="wiz-field">
        <label className="wiz-label">TIMEFRAME</label>
        <div className="wiz-card-grid">
          {TIMEFRAMES.map(tf => (
            <button key={tf} className={`wiz-option-card ${state.timeframe === tf ? 'selected' : ''}`}
              onClick={() => dispatch({ type: 'SET', key: 'timeframe', value: tf })}>
              <div className="wiz-card-label">{tf}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="wiz-field">
        <label className="wiz-label">STRATEGY</label>
        <div className="wiz-card-grid">
          {strategies.map(s => (
            <button key={s} className={`wiz-option-card ${state.strategy === s ? 'selected' : ''}`}
              onClick={() => dispatch({ type: 'SET', key: 'strategy', value: s })}>
              <div className="wiz-card-label">{s.toUpperCase()}</div>
              {s.toLowerCase().includes('counter') && (
                <div className="wiz-card-sub">⚠ Lower probability</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 3: Key Level
function Step3({ state, dispatch }) {
  const isFloating = state.keyLevel === 'None/Floating';
  return (
    <div>
      <div className="wiz-step-title">STEP 3 · KEY LOCATION &amp; LEVEL</div>
      <div className="wiz-field">
        <label className="wiz-label">KEY LEVEL</label>
        <div className="wiz-card-grid">
          {KEY_LEVELS.map(kl => (
            <button key={kl.value}
              className={`wiz-option-card ${state.keyLevel === kl.value ? 'selected' : ''}`}
              onClick={() => dispatch({ type: 'SET', key: 'keyLevel', value: kl.value })}>
              <div className="wiz-card-icon">{kl.icon}</div>
              <div className="wiz-card-label">{kl.value.toUpperCase()}</div>
              <div className="wiz-card-sub">{kl.sub}</div>
            </button>
          ))}
        </div>
      </div>
      {isFloating && (
        <div className="wiz-warning">
          ⚠ No confirmed key level — confluence score will not include level bonus and trade may be flagged as NO TRADE.
        </div>
      )}
    </div>
  );
}

// Step 4: Price Action Pattern
function Step4({ state, dispatch }) {
  const isBullish = state.marketStructure !== 'Downtrend';
  const patternList = isBullish ? PATTERNS.bullish : PATTERNS.bearish;

  return (
    <div>
      <div className="wiz-step-title">STEP 4 · PRICE ACTION &amp; TRIGGER PATTERN</div>
      <div className="wiz-field">
        <label className="wiz-label">
          PATTERN
          <span className="wiz-label-hint">· filtered for {state.marketStructure || 'selected'} bias</span>
        </label>
        <div className="wiz-card-grid">
          {patternList.map(p => (
            <button key={p.value}
              className={`wiz-option-card ${state.triggerPattern === p.value ? 'selected' : ''}`}
              onClick={() => dispatch({ type: 'SET', key: 'triggerPattern', value: p.value })}>
              <div className="wiz-card-icon">{p.icon}</div>
              <div className="wiz-card-label">{p.value.toUpperCase()}</div>
              <div className="wiz-card-sub">{p.sub}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 5: Indicator Confluence
function Step5({ state, dispatch }) {
  const selectedCount = Object.values(state.indicators).filter(Boolean).length;
  return (
    <div>
      <div className="wiz-step-title">STEP 5 · INDICATOR CONFLUENCE</div>
      <div className="wiz-field">
        <label className="wiz-label">
          SELECT CONFIRMING INDICATORS
          <span className="wiz-label-hint">· {selectedCount} selected · max +10 pts from first 2</span>
        </label>
        <div className="wiz-checklist">
          {INDICATORS.map(ind => (
            <div key={ind.key}
              role="checkbox"
              aria-checked={state.indicators[ind.key]}
              tabIndex={0}
              className={`wiz-check-item ${state.indicators[ind.key] ? 'checked' : ''}`}
              onClick={() => dispatch({ type: 'SET_INDICATOR', key: ind.key })}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); dispatch({ type: 'SET_INDICATOR', key: ind.key }); } }}>
              <div className="wiz-check-box">{state.indicators[ind.key] ? '✓' : ''}</div>
              <span className="wiz-check-label">{ind.label}</span>
              <span className="wiz-check-desc">{ind.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 6: Risk Management
function Step6({ state, dispatch }) {
  return (
    <div>
      <div className="wiz-step-title">STEP 6 · RISK MANAGEMENT</div>

      <div className="wiz-row2">
        <div className="wiz-field">
          <label className="wiz-label">ACCOUNT BALANCE ($)</label>
          <input className="wiz-input" type="number" step="any" placeholder="10000"
            value={state.accountBalance}
            onChange={e => dispatch({ type: 'SET', key: 'accountBalance', value: e.target.value })} />
        </div>
        <div className="wiz-field">
          <label className="wiz-label">RISK % <span className="wiz-label-hint">default 1.0</span></label>
          <input className="wiz-input" type="number" step="0.1" min="0.1" max="100" placeholder="1.0"
            value={state.riskPercentage}
            onChange={e => dispatch({ type: 'SET', key: 'riskPercentage', value: e.target.value })} />
        </div>
      </div>

      <div className="wiz-row3">
        <div className="wiz-field">
          <label className="wiz-label">ENTRY PRICE</label>
          <input className="wiz-input" type="number" step="any" placeholder="1.08500"
            value={state.entryPrice}
            onChange={e => dispatch({ type: 'SET', key: 'entryPrice', value: e.target.value })} />
        </div>
        <div className="wiz-field">
          <label className="wiz-label">STOP LOSS</label>
          <input className="wiz-input" type="number" step="any" placeholder="1.08000"
            value={state.stopLossPrice}
            onChange={e => dispatch({ type: 'SET', key: 'stopLossPrice', value: e.target.value })} />
        </div>
        <div className="wiz-field">
          <label className="wiz-label">TAKE PROFIT</label>
          <input className="wiz-input" type="number" step="any" placeholder="1.09500"
            value={state.takeProfitPrice}
            onChange={e => dispatch({ type: 'SET', key: 'takeProfitPrice', value: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

// ── Confluence Summary ─────────────────────────────────────────────────────────

const VERDICT_META = {
  EXECUTE_TRADE:            { cls: 'execute',  icon: '✅', title: 'EXECUTE TRADE',          sub: 'All conditions met — proceed with full position size.' },
  REDUCED_POSITION_EXECUTE: { cls: 'reduced',  icon: '⚡', title: 'REDUCED POSITION',       sub: 'Moderate confluence — consider 50% position size.' },
  NO_TRADE:                 { cls: 'no-trade', icon: '🚫', title: 'NO TRADE — STAND ASIDE', sub: 'Insufficient confluence or invalid risk parameters.' },
};

function ScoreCircle({ score }) {
  const radius = 36;
  const circ   = 2 * Math.PI * radius;
  const offset = circ - (Math.min(score, 100) / 100) * circ;
  const cls    = score >= 80 ? 'high' : score >= 65 ? 'medium' : 'low';

  return (
    <div className="wiz-score-circle">
      <svg className="wiz-score-svg" viewBox="0 0 100 100">
        <circle className="wiz-score-track" cx="50" cy="50" r={radius} />
        <circle className={`wiz-score-fill ${cls}`} cx="50" cy="50" r={radius}
          strokeDasharray={circ}
          strokeDashoffset={offset} />
      </svg>
      <div className="wiz-score-number">
        <span className="wiz-score-val">{score}</span>
        <span className="wiz-score-max">/100</span>
      </div>
    </div>
  );
}

function ConfluenceSummary({ result, state, onRestart }) {
  const vm = VERDICT_META[result.verdict] || VERDICT_META.NO_TRADE;

  const scoreRows = [
    { label: 'Market Structure Alignment', pts: result.raw.isCounterTrend ? 0 : 25, max: 25 },
    { label: 'Key Level Location',         pts: result.raw.floatingKey   ? 0 : 30, max: 30 },
    { label: 'Trigger Pattern',            pts: state.triggerPattern ? 25 : 0,   max: 25 },
    { label: `Indicator Confluence (${result.raw.indicatorCount})`, pts: Math.min(result.raw.indicatorCount * 5, 10), max: 10 },
    { label: `RRR Bonus/Penalty (${result.rrr.toFixed(2)})`,
      pts: result.rrr >= 2 ? 10 : result.rrr >= 1.5 ? 5 : -20, max: 10 },
  ];

  return (
    <div className="wiz-card wiz-summary-wrap">
      {/* Verdict */}
      <div className={`wiz-verdict-banner ${vm.cls}`}>
        <span className="wiz-verdict-icon">{vm.icon}</span>
        <div className="wiz-verdict-text">
          <div className="wiz-verdict-title">{vm.title}</div>
          <div className="wiz-verdict-sub">{vm.sub}</div>
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="wiz-warnings">
          {result.warnings.map((w, i) => (
            <div key={i} className="wiz-warning-item">⚠ {w}</div>
          ))}
        </div>
      )}

      {/* Score */}
      <div className="wiz-score-section">
        <ScoreCircle score={result.confluenceScore} />
        <div className="wiz-score-breakdown">
          <div className="wiz-score-breakdown-title">SCORE BREAKDOWN</div>
          {scoreRows.map(r => (
            <div key={r.label} className="wiz-score-row">
              <span>{r.label}</span>
              <span className={`wiz-score-pts ${r.pts > 0 ? 'positive' : r.pts < 0 ? 'negative' : 'neutral'}`}>
                {r.pts > 0 ? `+${r.pts}` : r.pts === 0 ? '—' : r.pts} pts
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risk Metrics */}
      <div className="wiz-metrics-grid">
        <div className="wiz-metric-card">
          <div className="wiz-metric-label">RISK AMOUNT</div>
          <div className="wiz-metric-val">${result.riskAmount.toFixed(2)}</div>
          <div className="wiz-metric-sub">{state.riskPercentage}% of account</div>
        </div>
        <div className="wiz-metric-card">
          <div className="wiz-metric-label">RISK : REWARD</div>
          <div className={`wiz-metric-val ${result.isRrrValid ? 'good' : 'bad'}`}>
            1 : {result.rrr.toFixed(2)}
          </div>
          <div className="wiz-metric-sub">{result.isRrrValid ? 'Valid RRR ≥ 1.5' : 'RRR below minimum'}</div>
        </div>
        <div className="wiz-metric-card">
          <div className="wiz-metric-label">POSITION SIZE</div>
          <div className="wiz-metric-val">
            {result.positionSizeUnit === 'lots'
              ? result.positionSize.toFixed(4) + ' L'
              : result.positionSize.toFixed(2) + ' units'}
          </div>
          <div className="wiz-metric-sub">
            {result.verdict === 'REDUCED_POSITION_EXECUTE'
              ? `Reduced: ${(result.positionSize / 2).toFixed(result.positionSizeUnit === 'lots' ? 4 : 2)} ${result.positionSizeUnit}`
              : `${state.assetClass} · ${state.symbol || '—'}`}
          </div>
        </div>
        <div className="wiz-metric-card">
          <div className="wiz-metric-label">RISK PER UNIT</div>
          <div className="wiz-metric-val">{result.riskPerUnit.toFixed(5)}</div>
          <div className="wiz-metric-sub">Entry − SL distance</div>
        </div>
        <div className="wiz-metric-card">
          <div className="wiz-metric-label">REWARD PER UNIT</div>
          <div className="wiz-metric-val">{result.rewardPerUnit.toFixed(5)}</div>
          <div className="wiz-metric-sub">TP − Entry distance</div>
        </div>
        <div className="wiz-metric-card">
          <div className="wiz-metric-label">CONFLUENCE SCORE</div>
          <div className={`wiz-metric-val ${result.confluenceScore >= 80 ? 'good' : result.confluenceScore >= 65 ? 'warn' : 'bad'}`}>
            {result.confluenceScore} / 100
          </div>
          <div className="wiz-metric-sub">{state.strategy || '—'}</div>
        </div>
      </div>

      <button className="wiz-restart-btn" onClick={onRestart}>← START NEW ANALYSIS</button>
    </div>
  );
}

// ── TradingWizardContainer ─────────────────────────────────────────────────────

export default function TradingWizardContainer() {
  const [step, setStep]         = useState(1);
  const [state, dispatch]       = useReducer(wizardReducer, INITIAL_STATE);
  const [calcError, setCalcError] = useState('');
  const [result, setResult]     = useState(null);

  const handleNext = useCallback(() => {
    if (step < 6) {
      setStep(s => s + 1);
    } else {
      // Calculate on final step
      const metrics = calculateTradeMetrics({
        ...state,
        accountBalance:  parseFloat(state.accountBalance),
        riskPercentage:  parseFloat(state.riskPercentage) || 1,
        entryPrice:      parseFloat(state.entryPrice),
        stopLossPrice:   parseFloat(state.stopLossPrice),
        takeProfitPrice: parseFloat(state.takeProfitPrice),
      });
      if (metrics.error) {
        setCalcError(metrics.error);
      } else {
        setCalcError('');
        setResult(metrics);
      }
    }
  }, [step, state]);

  const handleBack = useCallback(() => {
    if (step > 1) setStep(s => s - 1);
  }, [step]);

  const handleRestart = useCallback(() => {
    dispatch({ type: 'RESET' });
    setStep(1);
    setResult(null);
    setCalcError('');
  }, []);

  // Per-step validation to enable/disable Next
  const canAdvance = (() => {
    if (step === 1) return state.symbol.trim() !== '' && state.marketStructure !== '';
    if (step === 2) return state.timeframe !== '' && state.strategy !== '';
    if (step === 3) return state.keyLevel !== '';
    if (step === 4) return state.triggerPattern !== '';
    if (step === 5) return true; // indicators are optional
    if (step === 6) {
      return (
        state.accountBalance !== '' &&
        state.entryPrice     !== '' &&
        state.stopLossPrice  !== '' &&
        state.takeProfitPrice !== ''
      );
    }
    return true;
  })();

  if (result) {
    return (
      <div className="wiz-wrap">
        <ProgressBar currentStep={7} />
        <ConfluenceSummary result={result} state={state} onRestart={handleRestart} />
      </div>
    );
  }

  const stepComponents = { 1: Step1, 2: Step2, 3: Step3, 4: Step4, 5: Step5, 6: Step6 };
  const StepComponent = stepComponents[step];

  return (
    <div className="wiz-wrap">
      <ProgressBar currentStep={step} />
      <div className="wiz-card">
        <StepComponent state={state} dispatch={dispatch} />

        {calcError && <div className="wiz-error">⚠ {calcError}</div>}

        <div className="wiz-nav">
          <div className="wiz-nav-left">
            {step > 1 && (
              <button className="wiz-btn-back" onClick={handleBack}>← BACK</button>
            )}
            <span className="wiz-step-counter">STEP {step} / {STEPS.length}</span>
          </div>
          <button className="wiz-btn-next" onClick={handleNext} disabled={!canAdvance}>
            {step < 6 ? 'NEXT →' : 'CALCULATE →'}
          </button>
        </div>
      </div>
    </div>
  );
}
