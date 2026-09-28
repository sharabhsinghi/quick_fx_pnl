import React, { useState, useEffect } from 'react';
import { DEFAULT_SCREENER_CONFIG, DEFAULT_TICKERS } from '../../orb/constants';

export default function ORBConfig({ cfg, keys, onCfgChange, onKeysChange }) {
  const [draft, setDraft] = useState(cfg);
  const [newTicker, setNewTicker] = useState('');
  const [twelve, setTwelve] = useState(keys.twelve);
  const [tradier, setTradier] = useState(keys.tradier);
  const [saved, setSaved] = useState(null);

  useEffect(() => { setDraft(cfg); }, [cfg]);
  useEffect(() => { setTwelve(keys.twelve); setTradier(keys.tradier); }, [keys]);

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const flash = (msg) => { setSaved(msg); setTimeout(() => setSaved(null), 2500); };

  const save = () => { onCfgChange(draft); flash('Screener settings saved.'); };
  const saveKeys = () => { onKeysChange({ twelve: twelve.trim(), tradier: tradier.trim() }); flash('API keys saved.'); };

  const addTicker = () => {
    const t = newTicker.trim().toUpperCase();
    if (!t || draft.tickers.includes(t)) { setNewTicker(''); return; }
    setDraft(d => ({ ...d, tickers: [...d.tickers, t] }));
    setNewTicker('');
  };

  return (
    <div className="orb-section">
      {saved && <div className="orb-banner info">{saved}</div>}

      <div className="orb-card">
        <div className="orb-card-head">
          <h3>API KEYS</h3>
          <span className="orb-mono-sm">stored locally, sent only to the providers themselves</span>
        </div>
        <div className="orb-grid">
          <div className="orb-field">
            <label>TWELVE DATA (REQUIRED)</label>
            <input type="password" value={twelve} placeholder="Twelve Data API key"
              onChange={e => setTwelve(e.target.value)} />
            <span className="hint">
              Shared with the FX tracker&apos;s price lookups — set it once. twelvedata.com/pricing
            </span>
          </div>
          <div className="orb-field">
            <label>TRADIER (OPTIONAL)</label>
            <input type="password" value={tradier} placeholder="Leave blank to skip IV"
              onChange={e => setTradier(e.target.value)} />
            <span className="hint">
              Powers the IV column only. A sandbox token is enough for chain reads.
            </span>
          </div>
        </div>
        <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
          <button className="orb-btn primary" onClick={saveKeys}>SAVE KEYS</button>
        </div>
      </div>

      <div className="orb-card">
        <div className="orb-card-head"><h3>TICKER UNIVERSE</h3>
          <span className="orb-mono-sm">{draft.tickers.length} symbols</span>
          <button className="orb-btn small"
            onClick={() => setDraft(d => ({ ...d, tickers: DEFAULT_TICKERS.slice() }))}>
            RESET TO TOP 20
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="orb-field" style={{
            flex: '0 0 160px', background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '7px 9px', color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
          }}
            value={newTicker} placeholder="ADD SYMBOL"
            onChange={e => setNewTicker(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addTicker(); }} />
          <button className="orb-btn" onClick={addTicker}>ADD</button>
        </div>
        <div className="orb-chips">
          {draft.tickers.map(t => (
            <span key={t} className="orb-chip">
              {t}
              <button title={`Remove ${t}`}
                onClick={() => setDraft(d => ({ ...d, tickers: d.tickers.filter(x => x !== t) }))}>×</button>
            </span>
          ))}
        </div>
        <p className="orb-note" style={{ marginTop: 10 }}>
          Each added symbol costs one more API request per screener run and roughly four more on a
          one-year history pull.
        </p>
      </div>

      <div className="orb-card">
        <div className="orb-card-head"><h3>SCREENER THRESHOLDS</h3></div>
        <div className="orb-grid">
          <div className="orb-field">
            <label>OPENING RANGE (MINUTES)</label>
            <input type="number" step="5" value={draft.orbMinutes}
              onChange={e => set('orbMinutes', Number(e.target.value))} />
            <span className="hint">Must be a multiple of the {draft.barMinutes}-minute bar size.</span>
          </div>
          <div className="orb-field">
            <label>RVOL THRESHOLD</label>
            <input type="number" step="0.1" value={draft.rvolThreshold}
              onChange={e => set('rvolThreshold', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>RVOL LOOKBACK (DAYS)</label>
            <select value={draft.rvolLookbackDays}
              onChange={e => set('rvolLookbackDays', Number(e.target.value))}>
              <option value={5}>5</option><option value={10}>10</option><option value={20}>20</option>
            </select>
          </div>
          <div className="orb-field">
            <label>RSI PERIOD</label>
            <input type="number" value={draft.rsiPeriod}
              onChange={e => set('rsiPeriod', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>RSI OVERBOUGHT (BLOCK LONGS)</label>
            <input type="number" value={draft.rsiOverbought}
              onChange={e => set('rsiOverbought', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>RSI OVERSOLD (BLOCK SHORTS)</label>
            <input type="number" value={draft.rsiOversold}
              onChange={e => set('rsiOversold', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>GAP % MIN</label>
            <input type="number" step="0.1" value={draft.gapMinPct}
              onChange={e => set('gapMinPct', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>GAP % MAX</label>
            <input type="number" step="0.1" value={draft.gapMaxPct}
              onChange={e => set('gapMaxPct', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>ATR PERIOD (DAILY)</label>
            <input type="number" value={draft.atrPeriod}
              onChange={e => set('atrPeriod', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>ORB/ATR RATIO MIN</label>
            <input type="number" step="0.05" value={draft.atrRangeMinRatio}
              onChange={e => set('atrRangeMinRatio', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>ORB/ATR RATIO MAX</label>
            <input type="number" step="0.05" value={draft.atrRangeMaxRatio}
              onChange={e => set('atrRangeMaxRatio', Number(e.target.value))} />
          </div>
          <div className="orb-field">
            <label>BREAKOUT SELECTION</label>
            <select value={draft.singleShot ? 'single' : 'first'}
              onChange={e => set('singleShot', e.target.value === 'single')}>
              <option value="first">First candle that passes every filter</option>
              <option value="single">Single-shot: first candle out of range</option>
            </select>
            <span className="hint">
              &ldquo;First qualifying&rdquo; is the original prototype&apos;s behaviour: keep
              scanning forward until a candle clears every filter. Single-shot locks the signal to
              the first close outside the range, pass or fail.
            </span>
          </div>
        </div>

        <div className="orb-controls" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="orb-btn primary" onClick={save}>SAVE SETTINGS</button>
          <button className="orb-btn" onClick={() => setDraft({
            ...DEFAULT_SCREENER_CONFIG, tickers: draft.tickers })}>
            RESET THRESHOLDS
          </button>
        </div>
      </div>

      <p className="orb-note">
        Settings persist in IndexedDB (<code>orb-screener</code>) and apply to the live screener.
        The backtest screen starts from these values but can override any of them for a single run,
        so you can A/B a threshold without disturbing your live setup.
      </p>
    </div>
  );
}
