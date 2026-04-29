import React, { useMemo, useState } from 'react';
import { formatPrice, formatPL } from '../priceService';

const CHECKLIST_ITEMS = [
  'I am in my session window (London or NY open, ideally overlap)',
  'D1 market structure is clear — I know if I\'m biased long or short today',
  'I have 2–3 key S&R zones marked on D1/H4 and they extend to H1',
  'Price has reached one of my pre-marked zones — I didn\'t chase it mid-air',
  'There is a clear PA signal (pin bar / engulfing / morning star) AT the zone',
  'No major news event in the next 30 minutes (checked economic calendar)',
  'The PA signal aligns with D1 bias — I\'m not fighting the higher timeframe',
];

function TradeDetailModal({ trade, onClose, accountCurrency, usdRate }) {
  const won = trade.plUsd >= 0;
  const plAccount = trade.plUsd * usdRate;
  const dec = trade.meta.pipSize <= 0.001 ? 3 : 5;
  const fmt = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  const checklist = trade.checklist || [];
  const checkedCount = checklist.filter(Boolean).length;

  return (
    <div className="tdm-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tdm-panel">
        <div className="tdm-header">
          <div className="tdm-pair-row">
            <span className="tdm-pair">{trade.meta.display}</span>
            <span className={`tdm-side ${trade.side}`}>
              {trade.side === 'buy' ? '▲' : '▼'} {trade.side.toUpperCase()}
            </span>
            <span className={`tdm-result ${won ? 'profit' : 'loss'}`}>{won ? 'WIN' : 'LOSS'}</span>
          </div>
          <button className="tdm-x" onClick={onClose}>✕</button>
        </div>

        <div className="tdm-body">
          <div className="tdm-section">
            <div className="tdm-section-label">POSITION DETAILS</div>
            <div className="tdm-grid">
              <span className="tdm-label">Entry</span>
              <span className="tdm-val">{formatPrice(trade.entry, trade.meta.pipSize)}</span>
              <span className="tdm-label">Exit</span>
              <span className="tdm-val">{formatPrice(trade.closePrice, trade.meta.pipSize)}</span>
              <span className="tdm-label">Stop Loss</span>
              <span className="tdm-val red">{formatPrice(trade.sl, trade.meta.pipSize)}</span>
              <span className="tdm-label">Take Profit</span>
              <span className="tdm-val green">{formatPrice(trade.tp, trade.meta.pipSize)}</span>
              <span className="tdm-label">Lot Size</span>
              <span className="tdm-val">{(trade.lotSize / 100000).toFixed(2)}L</span>
              <span className="tdm-label">Pips</span>
              <span className={`tdm-val ${won ? 'profit' : 'loss'}`}>
                {trade.pips >= 0 ? '+' : ''}{trade.pips.toFixed(1)}
              </span>
              <span className="tdm-label">P/L ({accountCurrency})</span>
              <span className={`tdm-val ${won ? 'profit' : 'loss'}`}>
                {plAccount >= 0 ? '+' : '-'}{formatPL(plAccount, accountCurrency)}
              </span>
              <span className="tdm-label">Opened</span>
              <span className="tdm-val">{fmt(trade.openedAt)}</span>
              <span className="tdm-label">Closed</span>
              <span className="tdm-val">{fmt(trade.closedAt)}</span>
            </div>
          </div>

          {checklist.length > 0 && (
            <div className="tdm-section">
              <div className="tdm-section-label">
                PRE-TRADE CHECKLIST
                <span className="tdm-checklist-score">{checkedCount}/{CHECKLIST_ITEMS.length}</span>
              </div>
              <div className="tdm-checklist">
                {CHECKLIST_ITEMS.map((item, i) => (
                  <div key={i} className={`tdm-check-item ${checklist[i] ? 'checked' : 'unchecked'}`}>
                    <span className="tdm-check-icon">{checklist[i] ? '✓' : '○'}</span>
                    <span className="tdm-check-text">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(trade.openNotes || trade.notes) && (
            <div className="tdm-section">
              <div className="tdm-section-label">OPENING NOTES</div>
              <div className="tdm-notes">{trade.openNotes || trade.notes}</div>
            </div>
          )}

          {trade.closeNotes && (
            <div className="tdm-section">
              <div className="tdm-section-label">CLOSING NOTES</div>
              <div className="tdm-notes">{trade.closeNotes}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TradeHistory({ history, onClear, onDelete, accountCurrency = 'USD', accountSize = 0, usdRate = 1 }) {
  const stats = useMemo(() => {
    if (!history.length) return null;
    const wins = history.filter(t => t.plUsd >= 0).length;
    const totalPL = history.reduce((s, t) => s + t.plUsd, 0) * usdRate;
    const totalPips = history.reduce((s, t) => s + t.pips, 0);
    const avgPL = totalPL / history.length;
    return { wins, losses: history.length - wins, totalPL, totalPips, avgPL, count: history.length };
  }, [history, usdRate]);

  const [selectedTrade, setSelectedTrade] = useState(null);

  const fmt = (d) => {
    const date = new Date(d);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
    {selectedTrade && (
      <TradeDetailModal
        trade={selectedTrade}
        onClose={() => setSelectedTrade(null)}
        accountCurrency={accountCurrency}
        usdRate={usdRate}
      />
    )}
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
              <div className="stat-label">TOTAL P/L ({accountCurrency})</div>
              <div className={`stat-value ${stats.totalPL >= 0 ? 'profit' : 'loss'}`}>
                {stats.totalPL >= 0 ? '+' : '-'}{formatPL(stats.totalPL, accountCurrency)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">TOTAL PIPS</div>
              <div className={`stat-value ${stats.totalPips >= 0 ? 'profit' : 'loss'}`}>
                {stats.totalPips >= 0 ? '+' : ''}{stats.totalPips.toFixed(1)}
              </div>
            </div>
            <div className="stat-item">
              <div className="stat-label">AVG P/L ({accountCurrency})</div>
              <div className={`stat-value ${stats.avgPL >= 0 ? 'profit' : 'loss'}`}>
                {stats.avgPL >= 0 ? '+' : '-'}{formatPL(stats.avgPL, accountCurrency)}
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
              <span>P/L {accountCurrency}</span>
              <span>CLOSED</span>
              <span></span>
            </div>
            {history.map((t, i) => {
              const won = t.plUsd >= 0;
              return (
                <React.Fragment key={t.id ?? i}>
                  <div className={`ht-row ${won ? 'won' : 'lost'}`} onClick={() => setSelectedTrade(t)} style={{ cursor: 'pointer' }}>
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
                      {t.plUsd * usdRate >= 0 ? '+' : '-'}{formatPL(t.plUsd * usdRate, accountCurrency)}
                    </span>
                    <span className="ht-time">{fmt(t.closedAt)}</span>
                    <button
                      className="ht-delete-btn"
                      onClick={(e) => { e.stopPropagation(); onDelete && onDelete(t.id); }}
                      title="Delete trade"
                    >✕</button>
                  </div>

                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
