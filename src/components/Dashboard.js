import React, { useCallback, useEffect, useRef } from 'react';
import TradeCard from './TradeCard';

export default function Dashboard({ trades, onAddTrade, onClose, onUpdate }) {
  const totalPL = trades.reduce((s, t) => s + (t.plUsd || 0), 0);
  const totalPips = trades.reduce((s, t) => s + (t.pips || 0), 0);

  return (
    <div className="dashboard">
      {trades.length > 0 && (
        <div className="summary-bar">
          <div className="summary-item">
            <span className="si-label">OPEN POSITIONS</span>
            <span className="si-value">{trades.length}</span>
          </div>
          <div className="summary-item">
            <span className="si-label">TOTAL P/L (USD)</span>
            <span className={`si-value ${totalPL >= 0 ? 'profit' : 'loss'}`}>
              {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
            </span>
          </div>
          <div className="summary-item">
            <span className="si-label">TOTAL PIPS</span>
            <span className={`si-value ${totalPips >= 0 ? 'profit' : 'loss'}`}>
              {totalPips >= 0 ? '+' : ''}{totalPips.toFixed(1)}
            </span>
          </div>
        </div>
      )}

      <div className="trades-grid">
        {trades.map(trade => (
          <TradeCard
            key={trade.id}
            trade={trade}
            onClose={onClose}
            onUpdate={onUpdate}
          />
        ))}

        <button className="add-trade-card" onClick={onAddTrade}>
          <span className="add-icon">+</span>
          <span className="add-label">OPEN NEW TRADE</span>
        </button>
      </div>

      {trades.length === 0 && (
        <div className="empty-state">
          <div className="empty-sym">◈</div>
          <div className="empty-title">No open positions</div>
          <div className="empty-sub">Click the card above to open your first trade</div>
        </div>
      )}
    </div>
  );
}
