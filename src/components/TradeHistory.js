import React, { useMemo } from 'react';
import { formatPrice } from '../priceService';
import './TradeHistory.css';

export default function TradeHistory({ history, onClear }) {
  const stats = useMemo(() => {
    if (!history.length) return null;
    const wins = history.filter(t => t.plUsd >= 0).length;
    const totalPL = history.reduce((s, t) => s + t.plUsd, 0);
    const totalPips = history.reduce((s, t) => s + t.pips, 0);
    const avgPL = totalPL / history.length;
    return { wins, losses: history.length - wins, totalPL, totalPips, avgPL, count: history.length };
  }, [history]);

  const fmt = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="history-wrap">
      <div className="history-card">
        <div className="history-header">
          <span className="history-title">TRADE JOURNAL</span>
          {history.length > 0 && (
            <button className="clear-btn" onClick={onClear}>CLEAR ALL</button>
          )}
        </div>

        {stats && (
          <div className="stats-bar">
            <div className="stat-item">
              <div className="stat-label">TOTAL TRADES</div>
              <div className="stat-value">{stats.count}</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">WIN RATE</div>
              <div className="stat-value">{((stats.wins / stats.count) * 100).toFixed(0)}%</div>
            </div>
            <div className="stat-item">
              <div className="stat-label">TOTAL P/L</div>
              <div className={`stat-value ${stats.totalPL >= 0 ? 'profit' : 'loss'}`}>
                {stats.totalPL >= 0 ? '+' : ''}${stats.totalPL.toFixed(2)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">TOTAL PIPS</div>
              <div className={`stat-value ${stats.totalPips >= 0 ? 'profit' : 'loss'}`}>
                {stats.totalPips >= 0 ? '+' : ''}{stats.totalPips.toFixed(1)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">AVG P/L</div>
              <div className={`stat-value ${stats.avgPL >= 0 ? 'profit' : 'loss'}`}>
                {stats.avgPL >= 0 ? '+' : ''}${stats.avgPL.toFixed(2)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">W / L</div>
              <div className="stat-value">
                <span className="green">{stats.wins}</span>
                <span className="divider"> / </span>
                <span className="red">{stats.losses}</span>
              </div>
            </div>
          </div>
        )}

        {history.length === 0 ? (
          <div className="history-empty">
            <div className="he-sym">▣</div>
            <div className="he-title">No closed trades yet</div>
            <div className="he-sub">Trades will appear here after you close them</div>
          </div>
        ) : (
          <div className="history-table">
            <div className="ht-head">
              <span>PAIR</span>
              <span>SIDE</span>
              <span>ENTRY</span>
              <span>EXIT</span>
              <span>PIPS</span>
              <span>P/L USD</span>
              <span>CLOSED</span>
            </div>
            {history.map((t, i) => {
              const won = t.plUsd >= 0;
              return (
                <div key={t.id ?? i} className={`ht-row ${won ? 'won' : 'lost'}`}>
                  <span className="ht-pair">{t.meta.display}</span>
                  <span className={`ht-side ${t.side}`}>
                    {t.side === 'buy' ? '▲' : '▼'} {t.side.toUpperCase()}
                  </span>
                  <span className="ht-price">{formatPrice(t.entry, t.meta.pipSize)}</span>
                  <span className="ht-price">{formatPrice(t.closePrice, t.meta.pipSize)}</span>
                  <span className={`ht-pips ${won ? 'profit' : 'loss'}`}>
                    {t.pips >= 0 ? '+' : ''}{t.pips.toFixed(1)}
                  </span>
                  <span className={`ht-pl ${won ? 'profit' : 'loss'}`}>
                    {t.plUsd >= 0 ? '+' : ''}${Math.abs(t.plUsd).toFixed(2)}
                  </span>
                  <span className="ht-time">{fmt(t.closedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
