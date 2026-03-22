import React, { useState, useMemo } from 'react';
import { calcPnL, formatPrice } from '../priceService';
import './CloseTradeModal.css';

function defaultClosePrice(trade) {
  const dec = trade.meta.pipSize <= 0.001 ? 3 : 5;
  const lp = trade.livePrice;
  if (lp == null) return trade.entry.toFixed(dec);
  if (trade.side === 'buy') {
    return (lp >= trade.entry ? trade.tp : trade.sl).toFixed(dec);
  }
  return (lp <= trade.entry ? trade.tp : trade.sl).toFixed(dec);
}

export default function CloseTradeModal({ trade, onConfirm, onCancel }) {
  const dec = trade.meta.pipSize <= 0.001 ? 3 : 5;
  const [closePrice, setClosePrice] = useState(() => defaultClosePrice(trade));
  const [notes, setNotes] = useState('');

  const closePriceN = parseFloat(closePrice);
  const pnl = useMemo(() => {
    if (isNaN(closePriceN)) return null;
    return calcPnL({
      entry: trade.entry,
      currentPrice: closePriceN,
      side: trade.side,
      lotSize: trade.lotSize,
      pipSize: trade.meta.pipSize,
    });
  }, [closePriceN, trade.entry, trade.side, trade.lotSize, trade.meta.pipSize]);

  const profitable = pnl && pnl.plUsd >= 0;

  const handleConfirm = () => {
    const cp = isNaN(closePriceN) ? (trade.livePrice ?? trade.entry) : closePriceN;
    const { pips, plUsd } = pnl ?? { pips: 0, plUsd: 0 };
    onConfirm(trade.id, cp, pips, plUsd, notes);
  };

  const fmt = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="ctm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ctm-panel">
        <div className="ctm-header">
          <span className="ctm-title">CLOSE POSITION</span>
          <button className="ctm-x" onClick={onCancel}>✕</button>
        </div>

        {/* Trade summary */}
        <div className="ctm-summary">
          <div className="ctm-pair-row">
            <span className="ctm-pair">{trade.meta.display}</span>
            <span className={`ctm-side ${trade.side}`}>
              {trade.side === 'buy' ? '▲' : '▼'} {trade.side.toUpperCase()}
            </span>
          </div>
          <div className="ctm-detail-grid">
            <span className="ctm-label">Entry</span>
            <span className="ctm-val">{formatPrice(trade.entry, trade.meta.pipSize)}</span>
            <span className="ctm-label">SL</span>
            <span className="ctm-val red">{formatPrice(trade.sl, trade.meta.pipSize)}</span>
            <span className="ctm-label">TP</span>
            <span className="ctm-val green">{formatPrice(trade.tp, trade.meta.pipSize)}</span>
            <span className="ctm-label">Lot</span>
            <span className="ctm-val">{(trade.lotSize / 100000).toFixed(2)}L</span>
            <span className="ctm-label">Opened</span>
            <span className="ctm-val">{fmt(trade.openedAt)}</span>
            {trade.livePrice != null && (
              <>
                <span className="ctm-label">Live</span>
                <span className="ctm-val">{formatPrice(trade.livePrice, trade.meta.pipSize)}</span>
              </>
            )}
          </div>
        </div>

        {/* Closing price */}
        <div className="ctm-field">
          <label className="ctm-field-label">CLOSING PRICE</label>
          <div className="ctm-price-row">
            <input
              className="ctm-input"
              type="number"
              step="any"
              value={closePrice}
              onChange={e => setClosePrice(e.target.value)}
              autoFocus
            />
            <button className="ctm-preset red" onClick={() => setClosePrice(trade.sl.toFixed(dec))}>SL</button>
            <button className="ctm-preset green" onClick={() => setClosePrice(trade.tp.toFixed(dec))}>TP</button>
            {trade.livePrice != null && (
              <button className="ctm-preset" onClick={() => setClosePrice(trade.livePrice.toFixed(dec))}>LIVE</button>
            )}
          </div>
        </div>

        {/* Computed P/L */}
        {pnl && (
          <div className={`ctm-pl ${profitable ? 'profit' : 'loss'}`}>
            <span className="ctm-pl-usd">
              {pnl.plUsd >= 0 ? '+' : ''}${Math.abs(pnl.plUsd).toFixed(2)}
            </span>
            <span className="ctm-pl-sep">·</span>
            <span className="ctm-pl-pips">
              {pnl.pips >= 0 ? '+' : ''}{pnl.pips.toFixed(1)} pips
            </span>
          </div>
        )}

        {/* Notes */}
        <div className="ctm-field">
          <label className="ctm-field-label">
            CLOSING NOTES <span className="ctm-optional">optional</span>
          </label>
          <textarea
            className="ctm-textarea"
            placeholder="What happened? Lessons learned…"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
          />
        </div>

        {/* Actions */}
        <div className="ctm-actions">
          <button className="ctm-btn-cancel" onClick={onCancel}>CANCEL</button>
          <button
            className={`ctm-btn-confirm ${profitable ? 'profit' : 'loss'}`}
            onClick={handleConfirm}
            disabled={isNaN(closePriceN)}
          >
            CLOSE TRADE →
          </button>
        </div>
      </div>
    </div>
  );
}
