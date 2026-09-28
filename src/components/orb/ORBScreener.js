import React, { useState, useCallback, useRef } from 'react';
import { analyzeTicker, STATUS_LABELS, STATUS_RANK } from '../../orb/analysis';
import { buildVolumeBaseline } from '../../orb/indicators';
import { createLimiter, fetchTimeSeries, getBudget } from '../../orb/twelveData';
import { fetchAtmIV } from '../../orb/tradier';
import {
  getIntradayByDay, getDailyBars, putIntradayBars, putIvReading,
} from '../../orb/store';
import { getSessionDate, formatEtTime } from '../../orb/time';
import { fmtNum } from '../../orb/format';

const STATUS_COLOR = {
  triggered: 'var(--green)', breakout_weak: 'var(--amber)', no_breakout: 'var(--text-muted)',
  orb_only: 'var(--blue)', no_data: 'var(--text-dim)', error: 'var(--red)',
};

function Badge({ label, ok }) {
  const color = ok === true ? 'var(--green)' : ok === false ? 'var(--red)' : 'var(--text-dim)';
  const mark = ok === true ? '✓' : ok === false ? '✗' : '–';
  return <span style={{ color, marginLeft: 4 }} title={label}>{label}{mark}</span>;
}

export default function ORBScreener({ cfg, keys, onCfgChange }) {
  const [results, setResults] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusLine, setStatusLine] = useState('');
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState('status');
  const cancelRef = useRef(false);

  const sessionDate = getSessionDate();
  const tickers = cfg.tickers || [];

  const run = useCallback(async () => {
    if (!keys.twelve) {
      setError('Add a Twelve Data API key on the CONFIG tab first.');
      return;
    }
    setError(null);
    setResults({});
    setProgress(0);
    setRunning(true);
    cancelRef.current = false;

    const limiter = createLimiter();
    const next = {};

    for (let i = 0; i < tickers.length; i++) {
      if (cancelRef.current) break;
      const ticker = tickers[i];

      try {
        // Prefer the local cache for the RVOL baseline and the daily bars: it
        // makes the scan one request per ticker instead of two, and gives a
        // proper multi-day baseline even on a fresh session.
        const [cachedByDay, cachedDaily] = await Promise.all([
          getIntradayByDay(ticker).catch(() => ({})),
          getDailyBars(ticker).catch(() => []),
        ]);

        const priorDates = Object.keys(cachedByDay).filter(d => d < sessionDate).sort();
        const baselineDates = priorDates.slice(-cfg.rvolLookbackDays);
        const baselineBars = baselineDates.reduce((acc, d) => acc.concat(cachedByDay[d]), []);

        const dailyBefore = (cachedDaily || []).filter(b => b.d < sessionDate);
        const haveDaily = dailyBefore.length >= cfg.atrPeriod + 1;
        const haveBaseline = baselineDates.length > 0;

        setStatusLine(`${ticker} · ${haveBaseline ? `${baselineDates.length}d cached baseline` : 'no cached baseline'}`
          + `${haveDaily ? ' · cached daily' : ' · fetching daily'}`);

        // Today's 5-min bars always come from the API — they are live.
        const intradaySize = haveBaseline ? 120 : 78 * (cfg.rvolLookbackDays + 3);
        const todayBars = await limiter.schedule(
          () => fetchTimeSeries(ticker, '5min', Math.min(5000, intradaySize), keys.twelve),
          (ms) => setStatusLine(`${ticker} · rate limit — next request in ${Math.ceil(ms / 1000)}s`),
        );

        let daily = dailyBefore;
        if (!haveDaily) {
          const fetched = await limiter.schedule(
            () => fetchTimeSeries(ticker, '1day',
              Math.max(cfg.atrPeriod + 5, cfg.rvolLookbackDays) + 5, keys.twelve),
            (ms) => setStatusLine(`${ticker} · rate limit — next request in ${Math.ceil(ms / 1000)}s`),
          );
          daily = fetched.filter(b => b.d < sessionDate);
        }

        // Baseline: cached prior days when available, otherwise fall back to the
        // prior days inside the freshly fetched intraday window (the prototype's
        // original behaviour).
        const baseline = haveBaseline
          ? buildVolumeBaseline(baselineBars, sessionDate, cfg.rvolLookbackDays)
          : buildVolumeBaseline(todayBars, sessionDate, cfg.rvolLookbackDays);

        const analysis = analyzeTicker(todayBars, sessionDate, baseline, daily, cfg);
        next[ticker] = analysis;
        setResults({ ...next });

        // Keep the cache warm with today's session as it forms.
        putIntradayBars(ticker, todayBars.filter(b => b.d === sessionDate)).catch(() => {});

        if (analysis.breakout && keys.tradier) {
          try {
            const iv = await fetchAtmIV(ticker, analysis.breakout.close, analysis.breakout.direction, keys.tradier);
            analysis.breakout.iv = iv.iv;
            analysis.breakout.ivInfo = iv;
            if (iv.iv !== null && iv.iv !== undefined) {
              // Recorded so a real IV history accumulates for future backtests.
              putIvReading({
                ticker, date: sessionDate, iv: iv.iv, strike: iv.strike,
                expiration: iv.expiration, side: iv.side,
                direction: analysis.breakout.direction, capturedAt: new Date().toISOString(),
              }).catch(() => {});
            }
            setResults({ ...next });
          } catch (ivErr) {
            analysis.breakout.ivInfo = { iv: null, reason: (ivErr && ivErr.message) || 'IV lookup failed' };
            setResults({ ...next });
          }
        }
      } catch (e) {
        if (e && e.message === 'cancelled') break;
        next[ticker] = { status: 'error', reason: (e && e.message) || 'Unknown error' };
        setResults({ ...next });
      }

      setProgress(i + 1);
    }

    limiter.cancel();
    setRunning(false);
    setStatusLine('');
  }, [cfg, keys, sessionDate, tickers]);

  const stop = useCallback(() => { cancelRef.current = true; setRunning(false); }, []);

  const rows = tickers.map(t => ({ ticker: t, data: results[t] })).filter(r => r.data);
  rows.sort((a, b) => {
    if (sortMode === 'status') return STATUS_RANK[a.data.status] - STATUS_RANK[b.data.status];
    if (sortMode === 'rvol') {
      return ((b.data.breakout && b.data.breakout.rvol) || -1)
        - ((a.data.breakout && a.data.breakout.rvol) || -1);
    }
    return a.ticker.localeCompare(b.ticker);
  });

  const triggeredCount = rows.filter(r => r.data.status === 'triggered').length;
  const budget = typeof window !== 'undefined' ? getBudget() : { used: 0 };
  const cols = '62px 78px 1fr 62px 92px 58px 60px';

  return (
    <div className="orb-section">
      <div className="orb-params">
        <span>Range <b>9:30–9:45 ET</b></span>
        <span>RVOL <b>≥{cfg.rvolThreshold}x / {cfg.rvolLookbackDays}d</b></span>
        <span>RSI({cfg.rsiPeriod}) <b>{cfg.rsiOverbought}/{cfg.rsiOversold}</b></span>
        <span>VWAP <b>must confirm</b></span>
        <span>Gap <b>{cfg.gapMinPct}–{cfg.gapMaxPct}%</b></span>
        <span>ORB/ATR <b>{cfg.atrRangeMinRatio}–{cfg.atrRangeMaxRatio}x</b></span>
        <span>Mode <b>{cfg.singleShot ? 'single-shot' : 'first qualifying'}</b></span>
        <span>Session <b>{sessionDate}</b></span>
      </div>

      {error && <div className="orb-banner error">{error}</div>}

      <div className="orb-controls">
        <button className={`orb-btn ${running ? 'danger' : 'primary'}`}
          onClick={running ? stop : run}>
          {running ? 'STOP' : 'RUN SCREEN'}
        </button>

        <span className={`orb-status ${triggeredCount > 0 && !running ? 'good' : ''}`}>
          {running
            ? `${statusLine || 'scanning'} · ${progress}/${tickers.length}`
            : rows.length > 0
              ? `${triggeredCount} triggered · ${budget.used} API requests used today`
              : ''}
        </span>

        <div className="orb-toggle orb-spacer">
          <span className="lbl">LOOKBACK</span>
          {[5, 10, 20].map(d => (
            <button key={d} disabled={running}
              className={cfg.rvolLookbackDays === d ? 'active' : ''}
              onClick={() => onCfgChange({ ...cfg, rvolLookbackDays: d })}>{d}d</button>
          ))}
        </div>

        <div className="orb-toggle">
          <span className="lbl">SORT</span>
          {[['status', 'STATUS'], ['rvol', 'RVOL'], ['ticker', 'A–Z']].map(([k, l]) => (
            <button key={k} className={sortMode === k ? 'active' : ''}
              onClick={() => setSortMode(k)}>{l}</button>
          ))}
        </div>
      </div>

      {running && (
        <div className="orb-progress">
          <div style={{ width: `${(progress / Math.max(1, tickers.length)) * 100}%` }} />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="orb-empty">
          {running ? 'Scanning…' : 'Press RUN SCREEN to scan today’s session (any time after 9:50 ET).'}
        </div>
      ) : (
        <div className="orb-scroll">
          <div className="orb-table">
            <div className="r head" style={{ gridTemplateColumns: cols }}>
              <span>TICKER</span><span>STATUS</span><span>DETAIL</span>
              <span className="rt">RVOL</span><span className="rt">FILTERS</span>
              <span className="rt">IV</span><span className="rt">TIME</span>
            </div>

            {rows.map(({ ticker, data }) => {
              const b = data.breakout;
              const isTriggered = data.status === 'triggered';

              let detail;
              if (isTriggered) {
                const gapNote = data.gapPct !== null && data.gapPct !== undefined
                  ? ` · gap ${data.gapPct >= 0 ? '+' : ''}${fmtNum(data.gapPct, 1)}%` : '';
                const baseNote = data.hasBaseline
                  ? ` · vs ${data.baselineDays}d avg` : ' · same-day proxy RVOL';
                detail = `${b.direction === 'long' ? 'Broke above' : 'Broke below'} ORB `
                  + `(${fmtNum(data.orbLow)}–${fmtNum(data.orbHigh)})${gapNote}${baseNote}`;
              } else {
                detail = data.reason || '—';
              }

              let ivCell = '—', ivTitle = '';
              if (b && b.iv !== null && b.iv !== undefined) {
                ivCell = fmtNum(b.iv, 1) + '%';
                if (b.ivInfo) ivTitle = `${b.ivInfo.side} ${b.ivInfo.strike} exp ${b.ivInfo.expiration}`;
              } else if (b && !keys.tradier) {
                ivCell = 'n/a';
              } else if (b && b.ivInfo && b.ivInfo.reason) {
                ivTitle = b.ivInfo.reason;
              }

              return (
                <div key={ticker} className={`r ${isTriggered ? 'hit' : ''}`}
                  style={{ gridTemplateColumns: cols }}>
                  <span className="tk">{ticker}</span>
                  <span style={{ color: STATUS_COLOR[data.status], fontWeight: 600, fontSize: 10 }}>
                    {STATUS_LABELS[data.status] || data.status}
                  </span>
                  <span className="dim clip" title={detail}>{detail}</span>
                  <span className="rt" style={{ color: b && b.passesRvol ? 'var(--green)' : 'var(--text-muted)' }}>
                    {b ? fmtNum(b.rvol, 2) + 'x' : '—'}
                  </span>
                  <span className="rt" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                    {b ? (
                      <>
                        <Badge label="R" ok={b.rsiOk} />
                        <Badge label="V" ok={b.vwapOk} />
                        <Badge label="G" ok={data.gapOk} />
                        <Badge label="A" ok={data.rangeOk} />
                      </>
                    ) : <span className="dim">—</span>}
                  </span>
                  <span className="rt dim" title={ivTitle}>{ivCell}</span>
                  <span className="rt dim">{b ? formatEtTime(b.time) : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="orb-note" style={{ marginTop: 18 }}>
        A row shows TRIGGERED only when the clean-breakout, RVOL, RSI, VWAP, gap and ATR-range
        filters all pass together. Badges: R = RSI, V = VWAP, G = gap, A = ATR range. IV is
        informational and never gates the status — each reading taken here is also written to the
        local store, building a real forward IV history for future backtests. When historical bars
        are cached (DATA tab) the scan uses them for the RVOL baseline and ATR, cutting the run to
        one API request per ticker.
      </p>
    </div>
  );
}
