import React, { useState, useEffect, useCallback } from 'react';
import TradeForm from './components/TradeForm';
import Dashboard from './components/Dashboard';
import PipCalculator from './components/PipCalculator';
import TradeHistory from './components/TradeHistory';

const TABS = ['trades', 'calculator', 'history'];
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function App() {
  const [tab, setTab] = useState('trades');
  const [trades, setTrades] = useState([]); // active trades
  const [history, setHistory] = useState([]); // closed trades
  const [showForm, setShowForm] = useState(false);

  // Load persisted trades and history from SQLite on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [tradesRes, historyRes] = await Promise.all([
          fetch(`${BASE_PATH}/api/trades`),
          fetch(`${BASE_PATH}/api/history`),
        ]);
        if (tradesRes.ok) setTrades(await tradesRes.json());
        if (historyRes.ok) setHistory(await historyRes.json());
      } catch (_) {
        // API unavailable (e.g. static export) — start with empty state
      }
    }
    loadData();
  }, []);

  const handleOpen = useCallback(async (tradeData) => {
    const openedAt = new Date().toISOString();
    let id = Date.now(); // fallback id if API is unavailable
    try {
      const res = await fetch(`${BASE_PATH}/api/trades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: tradeData.key,
          meta: tradeData.meta,
          side: tradeData.side,
          entry: tradeData.entry,
          sl: tradeData.sl,
          tp: tradeData.tp,
          lotSize: tradeData.lotSize,
          openedAt,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        id = data.id;
      }
    } catch (_) {}

    setTrades(prev => [...prev, {
      ...tradeData,
      id,
      openedAt,
      livePrice: null,
      pips: null,
      plUsd: null,
      lastUpdated: null,
      error: null,
      loading: false,
    }]);
    setShowForm(false);
    setTab('trades');
  }, []);

  const handleClose = useCallback((tradeId, closePrice, pips, plUsd, notes = '') => {
    setTrades(prev => {
      const trade = prev.find(t => t.id === tradeId);
      if (trade) {
        const closedAt = new Date().toISOString();
        setHistory(h => [{
          ...trade,
          closePrice,
          pips,
          plUsd,
          notes,
          closedAt,
        }, ...h]);

        // Persist: remove open trade, add to history (fire-and-forget)
        fetch(`${BASE_PATH}/api/trades/${tradeId}`, { method: 'DELETE' }).catch(() => {});
        fetch(`${BASE_PATH}/api/history`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: trade.key,
            meta: trade.meta,
            side: trade.side,
            entry: trade.entry,
            sl: trade.sl,
            tp: trade.tp,
            lotSize: trade.lotSize,
            openedAt: trade.openedAt,
            closedAt,
            closePrice,
            pips,
            plUsd,
            notes,
          }),
        }).catch(() => {});
      }
      return prev.filter(t => t.id !== tradeId);
    });
  }, []);

  const updateTrade = useCallback((id, updates) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const clearHistory = useCallback(() => {
    fetch(`${BASE_PATH}/api/history`, { method: 'DELETE' }).catch(() => {});
    setHistory([]);
  }, []);

  const totalPL = trades.reduce((sum, t) => sum + (t.plUsd || 0), 0);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-logo">
            <span className="logo-sym">◈</span>
            <span className="logo-text">FXTRACK</span>
          </div>
          <nav className="header-nav">
            {TABS.map(t => (
              <button
                key={t}
                className={`nav-btn ${tab === t ? 'active' : ''}`}
                onClick={() => { setTab(t); setShowForm(false); }}
              >
                {t === 'trades' ? `POSITIONS${trades.length ? ` (${trades.length})` : ''}` : t.toUpperCase()}
              </button>
            ))}
          </nav>
          <div className="header-right">
            {trades.length > 0 && (
              <span className={`total-pl ${totalPL >= 0 ? 'profit' : 'loss'}`}>
                {totalPL >= 0 ? '+' : ''}${totalPL.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {tab === 'trades' && (
          showForm
            ? <TradeForm onOpen={handleOpen} onCancel={() => setShowForm(false)} />
            : <Dashboard
                trades={trades}
                onAddTrade={() => setShowForm(true)}
                onClose={handleClose}
                onUpdate={updateTrade}
              />
        )}
        {tab === 'calculator' && <PipCalculator />}
        {tab === 'history' && <TradeHistory history={history} onClear={clearHistory} />}
      </main>

      <footer className="app-footer">
        <span>Prices from frankfurter.app (ECB) · For informational use only · Not financial advice</span>
      </footer>
    </div>
  );
}
