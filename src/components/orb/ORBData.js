import React, { useState, useEffect, useCallback, useRef } from 'react';
import { runBackfill, defaultRange, estimateRequests } from '../../orb/history';
import { getAllMeta, deleteTickerData, estimateUsage, countIvReadings, getStoredTickers } from '../../orb/store';
import { exportCache, inspectFile, importCache } from '../../orb/transfer';
import { getBudget, resetBudget } from '../../orb/twelveData';
import { DEFAULT_RATE_LIMITS } from '../../orb/constants';
import { fmtBytes, fmtAgo } from '../../orb/format';

export default function ORBData({ cfg, keys }) {
  const [meta, setMeta] = useState({});
  const [range, setRange] = useState(() => defaultRange(1));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [usage, setUsage] = useState(null);
  const [ivCount, setIvCount] = useState(0);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [transfer, setTransfer] = useState(null);   // { phase, ticker, done, total }
  const [pending, setPending] = useState(null);     // an inspected file awaiting confirmation
  const [transferMsg, setTransferMsg] = useState(null);
  const [importMode, setImportMode] = useState('merge');
  const cancelRef = useRef(false);
  const fileRef = useRef(null);

  const tickers = cfg.tickers || [];

  const refresh = useCallback(async () => {
    try {
      const [m, u, iv] = await Promise.all([getAllMeta(), estimateUsage(), countIvReadings()]);
      setMeta(m); setUsage(u); setIvCount(iv);
    } catch (e) { setError((e && e.message) || 'Could not read the local store'); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let alive = true;
    estimateRequests(tickers, range.from, range.to, DEFAULT_RATE_LIMITS.maxPointsPerRequest)
      .then(n => { if (alive) setEstimate(n); })
      .catch(() => {});
    return () => { alive = false; };
  }, [tickers, range.from, range.to, meta]);

  const start = useCallback(async () => {
    if (!keys.twelve) { setError('Add a Twelve Data API key on the CONFIG tab first.'); return; }
    setError(null); setSummary(null); setRunning(true); cancelRef.current = false;

    try {
      const out = await runBackfill({
        tickers, apiKey: keys.twelve, fromDate: range.from, toDate: range.to,
        onProgress: p => setProgress(p),
        shouldCancel: () => cancelRef.current,
      });
      setSummary(out.results);
    } catch (e) {
      setError((e && e.message) || 'Backfill failed');
    }

    setRunning(false);
    setProgress(null);
    refresh();
  }, [keys.twelve, tickers, range, refresh]);

  const remove = useCallback(async (ticker) => {
    await deleteTickerData(ticker);
    refresh();
  }, [refresh]);

  const doExport = useCallback(async () => {
    setTransferMsg(null);
    setError(null);
    try {
      const stored = await getStoredTickers();
      if (stored.length === 0) {
        setError('Nothing cached yet — fetch some history before exporting.');
        return;
      }
      setTransfer({ phase: 'export', done: 0, total: stored.length });
      const out = await exportCache({
        onProgress: p => setTransfer({ phase: 'export', ...p }),
      });

      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setTransferMsg(`Exported ${out.tickers} ticker(s), ${out.sessions.toLocaleString()} sessions, `
        + `${out.bars.toLocaleString()} 5-min bars → ${out.filename} (${fmtBytes(out.bytes)}`
        + `${out.compressed ? ', gzip' : ', uncompressed'}).`);
    } catch (e) {
      setError((e && e.message) || 'Export failed');
    }
    setTransfer(null);
  }, []);

  const onPickFile = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError(null);
    setTransferMsg(null);
    setPending(null);
    try {
      const parsed = await inspectFile(file);
      setPending({ ...parsed, filename: file.name, size: file.size });
    } catch (err) {
      setError((err && err.message) || 'Could not read that file');
    }
    // allow re-picking the same file
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const doImport = useCallback(async () => {
    if (!pending) return;
    setError(null);
    setTransfer({ phase: 'import', done: 0, total: pending.summary.length });
    try {
      const results = await importCache(pending, {
        mode: importMode,
        onProgress: p => setTransfer({ ...p, phase: 'import' }),
      });
      const failed = results.filter(r => r.error);
      const bars = results.reduce((n, r) => n + (r.bars || 0), 0);
      setTransferMsg(failed.length
        ? `Imported with ${failed.length} failure(s): `
          + failed.map(r => `${r.ticker} — ${r.error}`).join(' | ')
        : `Imported ${results.length} ticker(s), ${bars.toLocaleString()} 5-min bars. `
          + 'No API requests used.');
      setPending(null);
      refresh();
    } catch (e) {
      setError((e && e.message) || 'Import failed');
    }
    setTransfer(null);
  }, [pending, importMode, refresh]);

  const budget = typeof window !== 'undefined' ? getBudget() : { used: 0 };
  const remaining = DEFAULT_RATE_LIMITS.requestsPerDay - budget.used;
  const etaMin = estimate ? Math.ceil(estimate / DEFAULT_RATE_LIMITS.requestsPerMinute) : null;
  const cols = '70px 1fr 92px 74px 96px 60px';

  return (
    <div className="orb-section">
      <div className="orb-card">
        <div className="orb-card-head">
          <h3>HISTORICAL CACHE</h3>
          <span className="orb-mono-sm">
            Twelve Data · {DEFAULT_RATE_LIMITS.requestsPerMinute}/min ·
            {' '}{DEFAULT_RATE_LIMITS.requestsPerDay}/day · {DEFAULT_RATE_LIMITS.maxPointsPerRequest} points/request
          </span>
        </div>

        <div className="orb-grid">
          <div className="orb-field">
            <label>FROM</label>
            <input type="date" value={range.from}
              onChange={e => setRange({ ...range, from: e.target.value })} disabled={running} />
          </div>
          <div className="orb-field">
            <label>TO</label>
            <input type="date" value={range.to}
              onChange={e => setRange({ ...range, to: e.target.value })} disabled={running} />
          </div>
          <div className="orb-field">
            <label>ESTIMATED REQUESTS</label>
            <div className="orb-status" style={{ paddingTop: 7 }}>
              {estimate === null ? '…' : `${estimate} · ~${etaMin} min`}
            </div>
            <span className="hint">
              Only what is missing gets fetched — rerunning is cheap.
            </span>
          </div>
          <div className="orb-field">
            <label>BUDGET USED TODAY</label>
            <div className="orb-status" style={{ paddingTop: 7 }}>
              {budget.used} / {DEFAULT_RATE_LIMITS.requestsPerDay}
              {remaining < (estimate || 0) && (
                <span style={{ color: 'var(--red)' }}> · not enough left</span>
              )}
            </div>
            <span className="hint">
              Counted locally, resets at midnight.{' '}
              <button className="orb-btn small" style={{ marginTop: 4 }}
                onClick={() => { resetBudget(); refresh(); }}>RESET COUNTER</button>
            </span>
          </div>
        </div>

        <div className="orb-controls" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className={`orb-btn ${running ? 'danger' : 'primary'}`}
            onClick={running ? () => { cancelRef.current = true; } : start}>
            {running ? 'STOP' : 'FETCH / UPDATE HISTORY'}
          </button>
          <button className="orb-btn" onClick={refresh} disabled={running}>REFRESH</button>
          {progress && (
            <span className="orb-status">
              {progress.ticker} ({progress.index + 1}/{progress.total}) · {progress.phase}
              {progress.detail ? ` · ${progress.detail}` : ''} · {progress.requestsUsed} requests used
            </span>
          )}
        </div>

        {running && progress && (
          <div className="orb-progress">
            <div style={{ width: `${(progress.index / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        )}
      </div>

      {error && <div className="orb-banner error">{error}</div>}

      {summary && (
        <div className="orb-banner info">
          {summary.filter(r => r.error).length > 0
            ? `Finished with ${summary.filter(r => r.error).length} error(s): `
              + summary.filter(r => r.error).map(r => `${r.ticker} — ${r.error}`).join(' | ')
            : `Finished. ${summary.reduce((s, r) => s + r.intradayBars, 0).toLocaleString()} `
              + `5-min bars written across ${summary.filter(r => !r.skipped).length} ticker(s).`}
        </div>
      )}

      <div className="orb-card">
        <div className="orb-card-head">
          <h3>BACKUP &amp; TRANSFER</h3>
          <span className="orb-mono-sm">move the cache between browsers without re-fetching</span>
        </div>

        <div className="orb-controls" style={{ marginBottom: 10 }}>
          <button className="orb-btn" onClick={doExport} disabled={running || !!transfer}>
            EXPORT CACHE
          </button>
          <button className="orb-btn" disabled={running || !!transfer}
            onClick={() => fileRef.current && fileRef.current.click()}>
            IMPORT FROM FILE…
          </button>
          <input ref={fileRef} type="file" accept=".json,.gz,application/json,application/gzip"
            style={{ display: 'none' }} onChange={onPickFile} />
          {transfer && (
            <span className="orb-status">
              {transfer.phase === 'export' ? 'Exporting' : 'Importing'}
              {transfer.ticker ? ` ${transfer.ticker}` : ''} · {transfer.done}/{transfer.total}
            </span>
          )}
        </div>

        {transfer && (
          <div className="orb-progress">
            <div style={{ width: `${(transfer.done / Math.max(1, transfer.total)) * 100}%` }} />
          </div>
        )}

        {transferMsg && <div className="orb-banner info">{transferMsg}</div>}

        {pending && (
          <>
            <div className="orb-banner warn">
              <b>{pending.filename}</b> ({fmtBytes(pending.size)}) — exported{' '}
              {pending.exportedAt ? new Date(pending.exportedAt).toLocaleString() : 'unknown date'}.
              Nothing has been written yet. Review below, choose a mode, then confirm.
            </div>
            <div className="orb-scroll">
              <div className="orb-table">
                <div className="r head" style={{ gridTemplateColumns: '70px 1fr 92px 70px 64px' }}>
                  <span>TICKER</span><span>COVERAGE IN FILE</span>
                  <span className="rt">5-MIN BARS</span><span className="rt">DAILY</span>
                  <span className="rt">IV</span>
                </div>
                {pending.summary.map(row => (
                  <div key={row.ticker} className="r" style={{ gridTemplateColumns: '70px 1fr 92px 70px 64px' }}>
                    <span className="tk">{row.ticker}</span>
                    <span className="dim">
                      {row.firstDate ? `${row.firstDate} → ${row.lastDate} (${row.sessions} sessions)` : 'no sessions'}
                      {meta[row.ticker] ? ' · already cached locally' : ''}
                    </span>
                    <span className="rt">{row.bars.toLocaleString()}</span>
                    <span className="rt dim">{row.dailyBars}</span>
                    <span className="rt dim">{row.ivReadings}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="orb-controls" style={{ marginTop: 12, marginBottom: 0 }}>
              <div className="orb-toggle">
                <span className="lbl">MODE</span>
                <button className={importMode === 'merge' ? 'active' : ''}
                  onClick={() => setImportMode('merge')}>MERGE</button>
                <button className={importMode === 'replace' ? 'active' : ''}
                  onClick={() => setImportMode('replace')}>REPLACE</button>
              </div>
              <span className="orb-mono-sm">
                {importMode === 'merge'
                  ? 'Keeps everything already cached; dates in the file win where they overlap.'
                  : 'Clears each ticker in the file first, so it ends up exactly matching. Tickers not in the file are untouched.'}
              </span>
              <button className="orb-btn primary orb-spacer" onClick={doImport}>
                {importMode === 'merge' ? 'MERGE INTO CACHE' : 'REPLACE AND IMPORT'}
              </button>
              <button className="orb-btn" onClick={() => setPending(null)}>CANCEL</button>
            </div>
          </>
        )}

        <p className="orb-note" style={{ marginTop: 12, marginBottom: 0 }}>
          The export carries 5-min bars, daily bars, coverage metadata and any captured IV
          readings — everything the screener and backtester read — so a machine that imports it
          needs no API key and makes no requests. Bars are written columnar and gzipped where the
          browser supports it, which keeps a 20-ticker year in the low single-digit megabytes.
          Timestamps are rebuilt on import from the ET date and minute-of-day by the same
          converter that produced them, so the round trip is lossless. API keys are never
          included.
        </p>
      </div>

      <div className="orb-scroll">
        <div className="orb-table">
          <div className="r head" style={{ gridTemplateColumns: cols }}>
            <span>TICKER</span><span>COVERAGE</span><span className="rt">5-MIN BARS</span>
            <span className="rt">DAILY</span><span className="rt">UPDATED</span><span className="rt" />
          </div>
          {tickers.map((t) => {
            const m = meta[t];
            return (
              <div key={t} className="r" style={{ gridTemplateColumns: cols }}>
                <span className="tk">{t}</span>
                <span className="dim">
                  {m && m.firstDate
                    ? `${m.firstDate} → ${m.lastDate} (${m.dayCount} sessions)`
                    : 'not cached'}
                </span>
                <span className="rt">{m ? m.barCount.toLocaleString() : '—'}</span>
                <span className="rt dim">{m ? (m.dailyBarCount || 0) : '—'}</span>
                <span className="rt dim">{m ? fmtAgo(m.updatedAt) : '—'}</span>
                <span className="rt">
                  {m && (
                    <button className="orb-btn small" disabled={running}
                      onClick={() => remove(t)}>CLEAR</button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <p className="orb-note" style={{ marginTop: 16 }}>
        Bars are stored in IndexedDB (database <code>orb-screener</code>), one row per ticker per
        session, and both the screener and the backtester read from it — nothing here is fetched
        twice.{usage ? ` Currently using ${fmtBytes(usage.usage)} of roughly ${fmtBytes(usage.quota)} available.` : ''}
        {' '}Captured ATM IV readings: <b>{ivCount}</b>. There is no free source of historical
        options IV — Tradier serves current chains only — so IV history only accumulates from live
        screener runs going forward, and the backtester reports “not evaluated” for days without a
        real reading rather than substituting a proxy.
      </p>
    </div>
  );
}
