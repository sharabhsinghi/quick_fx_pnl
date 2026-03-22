import React, { useState, useEffect, useCallback } from 'react';
import TradeForm from './components/TradeForm';
import Dashboard from './components/Dashboard';
import Calculators from './components/Calculators';
import TradeHistory from './components/TradeHistory';
import SettingsModal from './components/SettingsModal';
import Analytics from './components/Analytics';
import { fetchUsdRate, formatPL } from './priceService';

const TABS = ['trades', 'calculators', 'history', 'analytics'];
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function App() {
  const [tab, setTab] = useState('trades');
  const [trades, setTrades] = useState([]);
  const [history, setHistory] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [accountSettings, setAccountSettings] = useState({ size: 10000, currency: 'USD' });
  const [usdRate, setUsdRate] = useState(1);
  const [theme, setTheme] = useState('system'); // 'dark' | 'light' | 'system'

  // Load saved theme on mount
  useEffect(() => {
    const saved = localStorage.getItem('fxt-theme') || 'system';
    setTheme(saved);
  }, []);

  // Apply theme to <html> element whenever it changes
  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('fxt-theme', theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark');
  }, []);

  const THEME_ICON  = { dark: '◐', light: '◑', system: '◎' };
  const THEME_LABEL = { dark: 'Dark mode', light: 'Light mode', system: 'System theme' };

  // Load persisted trades, history, and settings from SQLite on mount
  useEffect(() => {
    async function loadData() {
      try {
        const [tradesRes, historyRes, settingsRes] = await Promise.all([
          fetch(`${BASE_PATH}/api/trades`),
          fetch(`${BASE_PATH}/api/history`),
          fetch(`${BASE_PATH}/api/settings`),
        ]);
        if (tradesRes.ok) setTrades(await tradesRes.json());
        if (historyRes.ok) setHistory(await historyRes.json());
        if (settingsRes.ok) setAccountSettings(await settingsRes.json());
      } catch (_) {}
    }
    loadData();
  }, []);

  // Fetch USD → account currency conversion rate whenever currency changes
  useEffect(() => {
    fetchUsdRate(accountSettings.currency).then(setUsdRate).catch(() => {});
  }, [accountSettings.currency]);

  const handleSaveSettings = useCallback(async (newSettings) => {
    setAccountSettings(newSettings);
    setShowSettings(false);
    try {
      await fetch(`${BASE_PATH}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
    } catch (_) {}
  }, []);

  const handleOpen = useCallback(async (tradeData) => {
    const openedAt = tradeData.openDate
      ? new Date(tradeData.openDate + 'T00:00:00').toISOString()
      : new Date().toISOString();
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
          notes: tradeData.notes || '',
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

  const deleteHistoryEntry = useCallback((id) => {
    fetch(`${BASE_PATH}/api/history?id=${id}`, { method: 'DELETE' }).catch(() => {});
    setHistory(prev => prev.filter(t => t.id !== id));
  }, []);

  const totalPL = trades.reduce((sum, t) => sum + (t.plUsd || 0), 0);
  const totalPLAccount = totalPL * usdRate;
  const { currency: accountCurrency, size: accountSize } = accountSettings;

  return (
    <div className="app">
      {showSettings && (
        <SettingsModal
          settings={accountSettings}
          onSave={handleSaveSettings}
          onCancel={() => setShowSettings(false)}
        />
      )}
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
              <span className={`total-pl ${totalPLAccount >= 0 ? 'profit' : 'loss'}`}>
                {totalPLAccount >= 0 ? '+' : '-'}{formatPL(totalPLAccount, accountCurrency)}
              </span>
            )}
            <button className="theme-btn" onClick={cycleTheme} title={THEME_LABEL[theme]}>
              {THEME_ICON[theme]}
            </button>
            <button className="settings-btn" onClick={() => setShowSettings(true)} title="Account settings">
              ⚙
            </button>
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
                accountCurrency={accountCurrency}
                accountSize={accountSize}
                usdRate={usdRate}
              />
        )}
        {tab === 'calculators' && <Calculators trades={trades} onOpen={handleOpen} accountCurrency={accountCurrency} accountSize={accountSize} usdRate={usdRate} />}
        {tab === 'history' && <TradeHistory history={history} onClear={clearHistory} onDelete={deleteHistoryEntry} accountCurrency={accountCurrency} accountSize={accountSize} usdRate={usdRate} />}
        {tab === 'analytics' && <Analytics history={history} accountCurrency={accountCurrency} accountSize={accountSize} usdRate={usdRate} />}
      </main>

      <footer className="app-footer">
        <span>Prices from Twelve Data Api · For informational use only · Not financial advice</span>
      </footer>
    </div>
  );
}
