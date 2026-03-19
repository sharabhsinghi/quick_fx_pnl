import React, { useState, useMemo } from 'react';
import { PAIR_META, normalizePair, calcPipValue } from '../priceService';

const POPULAR = ['EUR/USD','GBP/USD','USD/JPY','AUD/USD','USD/CHF','EUR/GBP','GBP/JPY','EUR/JPY'];

export default function PipCalculator() {
  const [pair, setPair] = useState('EURUSD');
  const [pairInput, setPairInput] = useState('EUR/USD');
  const [lots, setLots] = useState('1');
  const [pips, setPips] = useState('10');
  const [side, setSide] = useState('buy');

  const meta = PAIR_META[pair];

  const pipVal = useMemo(() => {
    if (!meta) return null;
    return calcPipValue({ pairKey: pair, lotSize: parseFloat(lots) * 100000 || 100000 });
  }, [pair, meta, lots]);

  const totalPL = useMemo(() => {
    if (pipVal == null) return null;
    return pipVal * (parseFloat(pips) || 0);
  }, [pipVal, pips]);

  const handlePairInput = (val) => {
    setPairInput(val);
    const key = normalizePair(val);
    if (PAIR_META[key]) setPair(key);
  };

  const selectPair = (display) => {
    setPairInput(display);
    setPair(normalizePair(display));
  };

  // Build scenario table: 5/10/20/50/100 pips
  const scenarios = [5, 10, 20, 50, 100].map(p => ({
    pips: p,
    pl: pipVal != null ? (pipVal * p).toFixed(2) : null,
  }));

  return (
    <div className="calc-wrap">
      <div className="calc-card">
        <div className="calc-header">
          <span className="calc-title">PIP CALCULATOR</span>
        </div>

        {/* Pair select */}
        <div className="calc-section">
          <label className="calc-label">CURRENCY PAIR</label>
          <input
            className="calc-input"
            value={pairInput}
            onChange={e => handlePairInput(e.target.value)}
            placeholder="EUR/USD"
          />
          {!meta && pairInput && <div className="calc-error">Unsupported pair</div>}
          <div className="chip-row">
            {POPULAR.map(p => (
              <button
                key={p}
                className={`chip ${pair === normalizePair(p) ? 'active' : ''}`}
                onClick={() => selectPair(p)}
              >{p}</button>
            ))}
          </div>
        </div>

        <div className="calc-row">
          <div className="calc-section half">
            <label className="calc-label">LOT SIZE</label>
            <div className="lot-presets">
              {[['0.01','0.01'],['0.1','0.1'],['1','1'],['2','2'],['5','5']].map(([l,v]) => (
                <button key={l} className={`chip ${lots===v?'active':''}`} onClick={()=>setLots(v)}>{l}L</button>
              ))}
            </div>
            <input className="calc-input" type="number" step="0.01" min="0.01"
              value={lots} onChange={e => setLots(e.target.value)} placeholder="1" />
          </div>
          <div className="calc-section half">
            <label className="calc-label">PIPS TO CALCULATE</label>
            <input className="calc-input large" type="number" step="1"
              value={pips} onChange={e => setPips(e.target.value)} placeholder="10" />
          </div>
        </div>

        {/* Result */}
        {meta && pipVal != null && (
          <div className="calc-result">
            <div className="result-grid">
              <div className="result-item">
                <div className="ri-label">PIP VALUE (per pip)</div>
                <div className="ri-value">${pipVal.toFixed(4)}</div>
              </div>
              <div className="result-item">
                <div className="ri-label">FOR {pips || 0} PIPS</div>
                <div className={`ri-value big ${totalPL >= 0 ? 'profit' : 'loss'}`}>
                  ${Math.abs(totalPL ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="result-item">
                <div className="ri-label">PIP SIZE</div>
                <div className="ri-value">{meta.pipSize}</div>
              </div>
            </div>

            {/* Scenario table */}
            <div className="scenario-table">
              <div className="st-header">
                <span>PIPS</span>
                <span>P/L (USD)</span>
              </div>
              {scenarios.map(s => (
                <div key={s.pips} className={`st-row ${s.pips === parseInt(pips) ? 'highlighted' : ''}`}>
                  <span className="st-pips">{s.pips}</span>
                  <span className="st-pl">${s.pl}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
