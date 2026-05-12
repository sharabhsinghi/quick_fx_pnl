import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLivePrice, calcPnL, calcRR, formatPrice, formatPL } from '../priceService';
import CloseTradeModal from './CloseTradeModal';

const AUTO_INTERVALS = [0, 30, 60, 300]; // seconds; 0 = off
const INTERVAL_LABELS = ['Off', '30s', '1m', '5m'];

export default function TradeCard({ trade, onClose, onUpdate, onEdit, accountCurrency = 'USD', accountSize = 0, usdRate = 1 }) {
  const [autoIdx, setAutoIdx] = useState(0);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState('');
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

  const handleModalConfirm = (tradeId, closePrice, pips, plUsd, notes) => {
    setShowCloseModal(false);
    onClose(tradeId, closePrice, pips, plUsd, notes);
  };

  const openEditMode = () => {
    setEditSl(String(trade.sl ?? ''));
    setEditTp(String(trade.tp ?? ''));
    setEditNotes(trade.notes || '');
    setEditError('');
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setEditError('');
  };

  const saveEdit = () => {
    setEditError('');
    const slN = parseFloat(editSl);
    const tpN = parseFloat(editTp);
    if (isNaN(slN) || isNaN(tpN)) {
      setEditError('SL and TP must be valid numbers.');
      return;
    }
    if (trade.side === 'buy' && slN >= trade.entry) {
      setEditError('BUY: Stop Loss must be below Entry.');
      return;
    }
    if (trade.side === 'buy' && tpN <= trade.entry) {
      setEditError('BUY: Take Profit must be above Entry.');
      return;
    }
    if (trade.side === 'sell' && slN <= trade.entry) {
      setEditError('SELL: Stop Loss must be above Entry.');
      return;
    }
    if (trade.side === 'sell' && tpN >= trade.entry) {
      setEditError('SELL: Take Profit must be below Entry.');
      return;
    }
    onEdit(trade.id, { sl: slN, tp: tpN, notes: editNotes });
    setEditMode(false);
  };

  const rr = calcRR({ entry: trade.entry, sl: trade.sl, tp: trade.tp, side: trade.side });
  const profitable = trade.plUsd != null && trade.plUsd >= 0;
  const hasData = trade.livePrice != null;
  const plAccount = (trade.plUsd ?? 0) * usdRate;
  const plPct = accountSize > 0 && hasData ? (plAccount / accountSize) * 100 : null;

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
      {showCloseModal && (
        <CloseTradeModal
          trade={trade}
          onConfirm={handleModalConfirm}
          onCancel={() => setShowCloseModal(false)}
          accountCurrency={accountCurrency}
          accountSize={accountSize}
          usdRate={usdRate}
        />
      )}
      {/* Card header */}
      <div className="tc-header">
        <div className="tc-pair">{trade.meta.display}</div>
        <div className={`tc-side ${trade.side}`}>
          {trade.side === 'buy' ? '▲' : '▼'} {trade.side.toUpperCase()}
        </div>
        {editMode && <div className="tc-edit-badge">EDITING</div>}
        <div className={`tc-dot ${trade.loading ? 'loading' : 'live'}`} />
      </div>

      {/* Big P/L */}
      <div className={`tc-pl ${hasData ? (profitable ? 'profit' : 'loss') : 'neutral'}`}>
        <div className="tc-pl-usd">
          {hasData
            ? `${plAccount >= 0 ? '+' : '-'}${formatPL(plAccount, accountCurrency)}`
            : '——'}
        </div>
        <div className="tc-pl-pips">
          {hasData ? `${trade.pips >= 0 ? '+' : ''}${trade.pips.toFixed(1)} pips` : ''}
          {plPct != null && (
            <span className="tc-pl-pct"> · {plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}% acct</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="tc-progress-track">
        <div className={`tc-progress-fill ${progressDir}`} style={{ width: `${progress}%` }} />
      </div>

      {/* Price levels — editable SL/TP in edit mode */}
      {editMode ? (
        <div className="tc-edit-levels">
          <div className="tc-edit-field">
            <label className="tc-edit-label">SL</label>
            <input
              className="tc-edit-input sl"
              type="number"
              step="any"
              value={editSl}
              onChange={e => setEditSl(e.target.value)}
            />
          </div>
          <div className="tc-edit-field center">
            <span className="tl-label">NOW</span>
            <span className="tl-val">
              {hasData ? formatPrice(trade.livePrice, trade.meta.pipSize) : '—'}
            </span>
          </div>
          <div className="tc-edit-field right">
            <label className="tc-edit-label">TP</label>
            <input
              className="tc-edit-input tp"
              type="number"
              step="any"
              value={editTp}
              onChange={e => setEditTp(e.target.value)}
            />
          </div>
        </div>
      ) : (
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
      )}

      {/* Meta row */}
      <div className="tc-meta">
        <span>Entry: {formatPrice(trade.entry, trade.meta.pipSize)}</span>
        <span>·</span>
        <span>RR: 1:{rr ?? '—'}</span>
        <span>·</span>
        <span>{(trade.lotSize / 100000).toFixed(2)}L</span>
      </div>

      {trade.error && <div className="tc-error">⚠ {trade.error}</div>}

      {/* Notes — editable textarea in edit mode */}
      {editMode ? (
        <div className="tc-edit-notes-wrap">
          <label className="tc-edit-label">NOTES</label>
          <textarea
            className="tc-edit-notes"
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            rows={3}
            placeholder="Trade rationale, setup notes…"
          />
        </div>
      ) : (
        trade.notes && <div className="tc-notes">{trade.notes}</div>
      )}

      {editError && <div className="tc-error">⚠ {editError}</div>}

      {trade.lastUpdated && !editMode && (
        <div className="tc-updated">Updated {trade.lastUpdated.toLocaleTimeString()}</div>
      )}

      {/* Actions */}
      {editMode ? (
        <div className="tc-actions">
          <button className="tc-btn-confirm" onClick={saveEdit}>✓ SAVE</button>
          <button className="tc-btn-cancel" onClick={cancelEdit}>✕ CANCEL</button>
        </div>
      ) : (
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

          <button className="tc-btn-edit" onClick={openEditMode}>✎ EDIT</button>
          <button className="tc-btn-close" onClick={() => setShowCloseModal(true)}>✕ CLOSE</button>
        </div>
      )}
    </div>
  );
}
