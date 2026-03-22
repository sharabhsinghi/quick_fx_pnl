import React, { useState } from 'react';
import { formatPL, getCurrencySymbol } from '../priceService';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'SGD', 'HKD'];

export default function SettingsModal({ settings, onSave, onCancel }) {
  const [size, setSize] = useState(String(settings.size));
  const [currency, setCurrency] = useState(settings.currency);
  const [error, setError] = useState('');

  const handleSave = () => {
    const sizeN = parseFloat(size);
    if (isNaN(sizeN) || sizeN < 0) { setError('Account size must be a positive number.'); return; }
    onSave({ size: sizeN, currency });
  };

  return (
    <div className="sm-overlay" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sm-panel">
        <div className="sm-header">
          <span className="sm-title">ACCOUNT SETTINGS</span>
          <button className="sm-x" onClick={onCancel}>✕</button>
        </div>

        <div className="sm-body">
          <div className="sm-field">
            <label className="sm-label">ACCOUNT CURRENCY</label>
            <select className="sm-select" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => (
                <option key={c} value={c}>{c} — {getCurrencySymbol(c)}</option>
              ))}
            </select>
          </div>

          <div className="sm-field">
            <label className="sm-label">
              ACCOUNT SIZE
              <span className="sm-hint"> · in {currency}</span>
            </label>
            <input
              className="sm-input"
              type="number"
              step="100"
              min="0"
              value={size}
              onChange={e => setSize(e.target.value)}
              placeholder="10000"
            />
            {!isNaN(parseFloat(size)) && parseFloat(size) > 0 && (
              <div className="sm-preview">
                {formatPL(parseFloat(size), currency)} {currency}
              </div>
            )}
          </div>

          {error && <div className="sm-error">⚠ {error}</div>}
        </div>

        <div className="sm-actions">
          <button className="sm-btn-cancel" onClick={onCancel}>CANCEL</button>
          <button className="sm-btn-save" onClick={handleSave}>SAVE →</button>
        </div>
      </div>
    </div>
  );
}
