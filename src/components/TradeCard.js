import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLivePrice, calcPnL, calcRR, formatPrice } from '../priceService';

const AUTO_INTERVALS = [0, 30, 60, 300]; // seconds; 0 = off
const INTERVAL_LABELS = ['Off', '30s', '1m', '5m'];

export default function TradeCard({ trade, onClose, onUpdate }) {
  const [autoIdx, setAutoIdx] = useState(0);
  const [confirmClose, setConfirmClose] = useState(false);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    onUpdate(trade.id, { loading: true, error: null });
    try {
      const result = await fetchLivePrice(trade.key);
      const { pips, plUsd } = calcPnL({
        entry: trade.entry,
        currentPrice: result.price,
        side: trade.side,
        lotSize: trade.lotSize,
        pipSize: trade.meta.pipSize,
      });
      onUpdate(trade.id, {
        livePrice: result.price,
        pips,
        plUsd,
        lastUpdated: new Date(),
        loading: false,
        error: null,
        source: result.source,
      });
    } catch (err) {
      onUpdate(trade.id, { loading: false, error: err.message });
    }
  }, [trade.id, trade.key, trade.entry, trade.side, trade.lotSize, trade.meta.pipSize, onUpdate]);

  // Auto-refresh
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const secs = AUTO_INTERVALS[autoIdx];
    if (secs > 0) {
      timerRef.current = setInterval(refresh, secs * 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [autoIdx, refresh]);

  // Fetch on mount
  useEffect(() => { refresh(); }, []); // eslint-disable-line

  const handleClose = () => {
    onClose(trade.id, trade.livePrice ?? trade.entry, trade.pips ?? 0, trade.plUsd ?? 0);
  };

  const rr = calcRR({ entry: trade.entry, sl: trade.sl, tp: trade.tp, side: trade.side });
  const profitable = trade.plUsd != null && trade.plUsd >= 0;
  const hasData = trade.livePrice != null;

  // Progress toward TP or toward SL
  let progress = 0;
  let progressDir = 'neutral';
  if (hasData) {
    const dir = trade.side === 'buy' ? 1 : -1;
    const moved = dir * (trade.livePrice - trade.entry);
    const toTP = dir * (trade.tp - trade.entry);
    const toSL = dir * (trade.entry - trade.sl);
    if (moved >= 0) {
      progress = Math.min(100, (moved / toTP) * 100);
      progressDir = 'profit';
    } else {
      progress = Math.min(100, (Math.abs(moved) / toSL) * 100);
      progressDir = 'loss';
    }
  }

  return (
    <div className={`trade-card ${hasData ? (profitable ? 'card-profit' : 'card-loss') : ''}`}>
      {/* Card header */}
      <div className="tc-header">
        <div className="tc-pair">{trade.meta.display}</div>
        <div className={`tc-side ${trade.side}`}>
          {trade.side === 'buy' ? '▲' : '▼'} {trade.side.toUpperCase()}
        </div>
        <div className={`tc-dot ${trade.loading ? 'loading' : 'live'}`} />
      </div>

      {/* Big P/L */}
      <div className={`tc-pl ${hasData ? (profitable ? 'profit' : 'loss') : 'neutral'}`}>
        <div className="tc-pl-usd">
          {hasData
            ? `${trade.plUsd >= 0 ? '+' : ''}$${Math.abs(trade.plUsd).toFixed(2)}`
            : '——'}
        </div>
        <div className="tc-pl-pips">
          {hasData ? `${trade.pips >= 0 ? '+' : ''}${trade.pips.toFixed(1)} pips` : ''}
        </div>
      </div>

      {/* Progress bar */}
      <div className="tc-progress-track">
        <div className={`tc-progress-fill ${progressDir}`} style={{ width: `${progress}%` }} />
      </div>

      {/* Price levels */}
      <div className="tc-levels">
        <div className="tc-level">
          <span className="tl-label">SL</span>
          <span className="tl-val red">{formatPrice(trade.sl, trade.meta.pipSize)}</span>
        </div>
        <div className="tc-level center">
          <span className="tl-label">NOW</span>
          <span className="tl-val">
            {hasData ? formatPrice(trade.livePrice, trade.meta.pipSize) : '—'}
          </span>
        </div>
        <div className="tc-level right">
          <span className="tl-label">TP</span>
          <span className="tl-val green">{formatPrice(trade.tp, trade.meta.pipSize)}</span>
        </div>
      </div>

      {/* Meta row */}
      <div className="tc-meta">
        <span>Entry: {formatPrice(trade.entry, trade.meta.pipSize)}</span>
        <span>·</span>
        <span>RR: 1:{rr ?? '—'}</span>
        <span>·</span>
        <span>{(trade.lotSize / 100000).toFixed(2)}L</span>
      </div>

      {trade.error && <div className="tc-error">⚠ {trade.error}</div>}
      {trade.lastUpdated && (
        <div className="tc-updated">Updated {trade.lastUpdated.toLocaleTimeString()}</div>
      )}

      {/* Actions */}
      <div className="tc-actions">
        <button className={`tc-btn-refresh ${trade.loading ? 'spinning' : ''}`} onClick={refresh} disabled={trade.loading}>
          ↻
        </button>

        {/* Auto-refresh cycle */}
        <button
          className={`tc-btn-auto ${autoIdx > 0 ? 'active' : ''}`}
          onClick={() => setAutoIdx(i => (i + 1) % AUTO_INTERVALS.length)}
          title="Auto-refresh interval"
        >
          AUTO: {INTERVAL_LABELS[autoIdx]}
        </button>

        {confirmClose ? (
          <>
            <button className="tc-btn-confirm" onClick={handleClose}>CONFIRM</button>
            <button className="tc-btn-cancel" onClick={() => setConfirmClose(false)}>CANCEL</button>
          </>
        ) : (
          <button className="tc-btn-close" onClick={() => setConfirmClose(true)}>✕ CLOSE</button>
        )}
      </div>
    </div>
  );
}
