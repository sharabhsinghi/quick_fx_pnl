import React, { useState, useCallback } from 'react';
import TradeForm from './components/TradeForm';
import Dashboard from './components/Dashboard';
import PipCalculator from './components/PipCalculator';
import TradeHistory from './components/TradeHistory';
import './App.css';

const TABS = ['trades', 'calculator', 'history'];

export default function App() {
  const [tab, setTab] = useState('trades');
  const [trades, setTrades] = useState([]); // active trades
  const [history, setHistory] = useState([]); // closed trades
  const [showForm, setShowForm] = useState(false);

  const handleOpen = useCallback((tradeData) => {
    const newTrade = {
      ...tradeData,
      id: Date.now(),
      openedAt: new Date().toISOString(),
      livePrice: null,
      pips: null,
      plUsd: null,
      lastUpdated: null,
      error: null,
      loading: false,
    };
    setTrades(prev => [...prev, newTrade]);
    setShowForm(false);
    setTab('trades');
  }, []);

  const handleClose = useCallback((tradeId, closePrice, pips, plUsd) => {
    setTrades(prev => {
      const trade = prev.find(t => t.id === tradeId);
      if (trade) {
        setHistory(h => [{
          ...trade,
          closePrice,
          pips,
          plUsd,
          closedAt: new Date().toISOString(),
        }, ...h]);
      }
      return prev.filter(t => t.id !== tradeId);
    });
  }, []);

  const updateTrade = useCallback((id, updates) => {
    setTrades(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

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
