import React, { useState, useEffect, useCallback } from 'react';
import ORBScreener from './orb/ORBScreener';
import ORBData from './orb/ORBData';
import ORBBacktest from './orb/ORBBacktest';
import ORBChart from './orb/ORBChart';
import ORBConfig from './orb/ORBConfig';
import { DEFAULT_SCREENER_CONFIG, DEFAULT_TRADE_CONFIG } from '../orb/constants';
import { getConfig, saveConfig } from '../orb/store';
import { getApiKey, saveApiKey } from '../lib/idb';

const SUBTABS = [
  ['screener', 'SCREENER'],
  ['data', 'DATA'],
  ['backtest', 'BACKTEST'],
  ['chart', 'CHART'],
  ['config', 'CONFIG'],
];

export default function ORB() {
  const [sub, setSub] = useState('screener');
  const [cfg, setCfg] = useState(DEFAULT_SCREENER_CONFIG);
  const [tradeCfg, setTradeCfg] = useState(DEFAULT_TRADE_CONFIG);
  const [keys, setKeys] = useState({ twelve: '', tradier: '' });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, t, k, twelve] = await Promise.all([
          getConfig('screener', DEFAULT_SCREENER_CONFIG),
          getConfig('trade', DEFAULT_TRADE_CONFIG),
          getConfig('keys', { tradier: '' }),
          getApiKey(),
        ]);
        setCfg(s);
        setTradeCfg(t);
        // The Twelve Data key lives in the app's existing settings store so it
        // is shared with the FX tracker rather than entered twice.
        setKeys({ twelve: twelve || '', tradier: (k && k.tradier) || '' });
      } catch (_) { /* first run — defaults are fine */ }
      setLoaded(true);
    })();
  }, []);

  const updateCfg = useCallback((next) => {
    setCfg(next);
    saveConfig('screener', next).catch(() => {});
  }, []);

  const updateTradeCfg = useCallback((next) => {
    setTradeCfg(next);
    saveConfig('trade', next).catch(() => {});
  }, []);

  const updateKeys = useCallback((next) => {
    setKeys(next);
    saveApiKey(next.twelve || '').catch(() => {});
    saveConfig('keys', { tradier: next.tradier || '' }).catch(() => {});
  }, []);

  if (!loaded) {
    return <div className="orb-wrap"><div className="orb-empty">Loading local config…</div></div>;
  }

  return (
    <div className="orb-wrap">
      <div className="orb-subnav">
        {SUBTABS.map(([k, label]) => (
          <button key={k} className={sub === k ? 'active' : ''} onClick={() => setSub(k)}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'screener' && <ORBScreener cfg={cfg} keys={keys} onCfgChange={updateCfg} />}
      {sub === 'data' && <ORBData cfg={cfg} keys={keys} />}
      {sub === 'backtest' && (
        <ORBBacktest cfg={cfg} tradeCfg={tradeCfg} onTradeCfgChange={updateTradeCfg} />
      )}
      {sub === 'chart' && <ORBChart cfg={cfg} />}
      {sub === 'config' && (
        <ORBConfig
          cfg={cfg}
          tradeCfg={tradeCfg}
          keys={keys}
          onCfgChange={updateCfg}
          onTradeCfgChange={updateTradeCfg}
          onKeysChange={updateKeys}
        />
      )}
    </div>
  );
}
