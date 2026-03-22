import React, { useMemo } from 'react';
import {
  ResponsiveContainer,
  PieChart, Pie, Cell,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar,
} from 'recharts';
import { formatPL, getCurrencySymbol } from '../priceService';

const GREEN  = '#22c55e';
const RED    = '#ef4444';
const AMBER  = '#f59e0b';

function StatCard({ label, value, sub, color }) {
  return (
    <div className="an-stat-card">
      <div className="an-stat-label">{label}</div>
      <div className="an-stat-value" style={color ? { color } : {}}>{value}</div>
      {sub && <div className="an-stat-sub">{sub}</div>}
    </div>
  );
}

function AnTooltip({ active, payload, label, valFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="an-tooltip">
      {label != null && <div className="an-tt-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="an-tt-row">
          <span style={{ color: p.color || p.fill }}>{p.name}:</span>
          <span>{valFmt ? valFmt(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics({ history, accountCurrency = 'USD', accountSize = 0, usdRate = 1 }) {
  const data = useMemo(() => {
    if (!history.length) return null;

    const wins   = history.filter(t => t.plUsd >= 0);
    const losses = history.filter(t => t.plUsd <  0);
    const totalWinAmt  = wins.reduce((s, t)   => s + t.plUsd * usdRate, 0);
    const totalLossAmt = losses.reduce((s, t) => s + t.plUsd * usdRate, 0);

    // Cumulative P/L over time
    const sorted = [...history].sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));
    let cum = 0;
    const cumPL = sorted.map(t => {
      cum += t.plUsd * usdRate;
      return {
        date:   new Date(t.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        cumPL:  parseFloat(cum.toFixed(2)),
        tradePL: parseFloat((t.plUsd * usdRate).toFixed(2)),
        pair:   t.meta?.display || t.key,
      };
    });

    // Per-trade bars (full history copy, sorted by date)
    const tradeBars = sorted.map((t, i) => ({
      i: i + 1,
      pl:   parseFloat((t.plUsd * usdRate).toFixed(2)),
      pair: t.meta?.display || t.key,
    }));

    // P/L + stats by pair
    const byPair = {};
    history.forEach(t => {
      const pair = t.meta?.display || t.key;
      if (!byPair[pair]) byPair[pair] = { pair, pl: 0, count: 0, wins: 0, pips: 0 };
      byPair[pair].pl   += t.plUsd * usdRate;
      byPair[pair].pips += t.pips;
      byPair[pair].count++;
      if (t.plUsd >= 0) byPair[pair].wins++;
    });
    const pairData = Object.values(byPair)
      .map(p => ({ ...p, pl: parseFloat(p.pl.toFixed(2)), winRate: Math.round((p.wins / p.count) * 100) }))
      .sort((a, b) => b.pl - a.pl);

    // Top and worst trades
    const byPL = [...history].sort((a, b) => b.plUsd - a.plUsd);
    const best  = byPL[0];
    const worst = byPL[byPL.length - 1];

    // Longest win and loss streaks
    let maxWin = 0, maxLoss = 0, curWin = 0, curLoss = 0;
    sorted.forEach(t => {
      if (t.plUsd >= 0) { curWin++; curLoss = 0; maxWin  = Math.max(maxWin,  curWin);  }
      else              { curLoss++; curWin = 0;  maxLoss = Math.max(maxLoss, curLoss); }
    });

    const totalPL = totalWinAmt + totalLossAmt;

    return {
      wins: wins.length,
      losses: losses.length,
      totalWinAmt, totalLossAmt,
      totalPL,
      avgPL:   totalPL / history.length,
      winRate: Math.round((wins.length / history.length) * 100),
      cumPL, tradeBars, pairData,
      best, worst,
      maxWin, maxLoss,
    };
  }, [history, usdRate]);

  if (!history.length || !data) {
    return (
      <div className="analytics-wrap">
        <div className="analytics-empty">
          <div className="ae-sym">◈</div>
          <div className="ae-title">NO DATA YET</div>
          <div className="ae-sub">Analytics will appear after you close some trades</div>
        </div>
      </div>
    );
  }

  const sym    = getCurrencySymbol(accountCurrency);
  const fmtPL  = v => `${v >= 0 ? '+' : '-'}${formatPL(v, accountCurrency)}`;
  const fmtTick = v => `${sym}${v}`;
  const fmtPct  = v => `${v}%`;
  const tickStyle = { fill: '#6b7280', fontSize: 10, fontFamily: 'IBM Plex Mono' };
  const pairTickStyle = { fill: '#9ca3af', fontSize: 11, fontFamily: 'IBM Plex Mono' };

  return (
    <div className="analytics-wrap">

      {/* ── Overview stats ── */}
      <div className="an-stats-row">
        <StatCard label="TOTAL TRADES" value={history.length} sub={`${data.wins}W · ${data.losses}L`} />
        <StatCard label="WIN RATE"     value={`${data.winRate}%`} color={data.winRate >= 50 ? GREEN : RED} />
        <StatCard label={`TOTAL P/L (${accountCurrency})`} value={fmtPL(data.totalPL)} color={data.totalPL >= 0 ? GREEN : RED} />
        <StatCard label={`AVG TRADE (${accountCurrency})`} value={fmtPL(data.avgPL)}   color={data.avgPL  >= 0 ? GREEN : RED} />
      </div>

      {/* ── Win/Loss split + Top trades ── */}
      <div className="an-row-2">

        {/* Donut: count (inner) + amount (outer ring) */}
        <div className="an-card">
          <div className="an-card-title">WIN / LOSS SPLIT</div>
          <div className="an-pie-wrap">
            <ResponsiveContainer width={220} height={200}>
              <PieChart>
                {/* Inner ring: trade count */}
                <Pie
                  data={[
                    { name: `Wins (${data.wins})`,   value: data.wins },
                    { name: `Losses (${data.losses})`, value: data.losses || 0.001 },
                  ]}
                  cx="50%" cy="50%"
                  innerRadius={46} outerRadius={72}
                  startAngle={90} endAngle={-270}
                  dataKey="value" isAnimationActive={false}
                >
                  <Cell fill={GREEN} />
                  <Cell fill={data.losses ? RED : '#1e1e1e'} />
                </Pie>
                {/* Outer ring: amount */}
                <Pie
                  data={[
                    { name: `Won`,  value: Math.max(Math.abs(data.totalWinAmt),  0.001) },
                    { name: `Lost`, value: Math.max(Math.abs(data.totalLossAmt), 0.001) },
                  ]}
                  cx="50%" cy="50%"
                  innerRadius={78} outerRadius={90}
                  startAngle={90} endAngle={-270}
                  dataKey="value" isAnimationActive={false}
                >
                  <Cell fill={GREEN} opacity={0.45} />
                  <Cell fill={data.losses ? RED : '#1e1e1e'} opacity={0.45} />
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="an-tooltip">
                        {payload.map((p, i) => (
                          <div key={i} className="an-tt-row">
                            <span style={{ color: i === 0 ? GREEN : RED }}>{p.name}:</span>
                            <span>{p.value < 0.01 ? 0 : p.value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="an-pie-legend">
              <div className="an-pie-leg-item">
                <span className="an-leg-dot" style={{ background: GREEN }} />
                <div>
                  <div className="an-leg-label">WINS</div>
                  <div className="an-leg-val" style={{ color: GREEN }}>{data.wins} trades</div>
                  <div className="an-leg-val" style={{ color: GREEN }}>{fmtPL(data.totalWinAmt)}</div>
                </div>
              </div>
              <div className="an-pie-leg-item">
                <span className="an-leg-dot" style={{ background: RED }} />
                <div>
                  <div className="an-leg-label">LOSSES</div>
                  <div className="an-leg-val" style={{ color: RED }}>{data.losses} trades</div>
                  <div className="an-leg-val" style={{ color: RED }}>{fmtPL(data.totalLossAmt)}</div>
                </div>
              </div>
              <div className="an-pie-leg-item" style={{ marginTop: 4 }}>
                <span className="an-leg-dot" style={{ background: AMBER }} />
                <div>
                  <div className="an-leg-label">STREAK</div>
                  <div className="an-leg-val" style={{ color: GREEN }}>Win: {data.maxWin}</div>
                  <div className="an-leg-val" style={{ color: RED }}>Loss: {data.maxLoss}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Best / Worst / Best pair */}
        <div className="an-card">
          <div className="an-card-title">TOP TRADES</div>
          <div className="an-tops">
            <div className="an-top-item">
              <div className="an-top-label">BEST TRADE</div>
              <div className="an-top-pair">{data.best.meta?.display || data.best.key}</div>
              <div className="an-top-pl" style={{ color: data.best.plUsd >= 0 ? GREEN : RED }}>
                {fmtPL(data.best.plUsd * usdRate)}
              </div>
              <div className="an-top-sub">
                {data.best.pips.toFixed(1)} pips · {data.best.side.toUpperCase()}
              </div>
            </div>
            <div className="an-tops-sep" />
            <div className="an-top-item">
              <div className="an-top-label">WORST TRADE</div>
              <div className="an-top-pair">{data.worst.meta?.display || data.worst.key}</div>
              <div className="an-top-pl" style={{ color: data.worst.plUsd >= 0 ? GREEN : RED }}>
                {fmtPL(data.worst.plUsd * usdRate)}
              </div>
              <div className="an-top-sub">
                {data.worst.pips.toFixed(1)} pips · {data.worst.side.toUpperCase()}
              </div>
            </div>
          </div>

          {data.pairData.length > 0 && (
            <div className="an-best-pair">
              <div className="an-tops-sep an-tops-sep--h" />
              <div className="an-tops" style={{ marginTop: 14 }}>
                <div className="an-top-item">
                  <div className="an-top-label">BEST PAIR</div>
                  <div className="an-top-pair">{data.pairData[0].pair}</div>
                  <div className="an-top-pl" style={{ color: data.pairData[0].pl >= 0 ? GREEN : RED }}>
                    {fmtPL(data.pairData[0].pl)}
                  </div>
                  <div className="an-top-sub">{data.pairData[0].winRate}% win rate · {data.pairData[0].count} trades</div>
                </div>
                <div className="an-tops-sep" />
                <div className="an-top-item">
                  <div className="an-top-label">WORST PAIR</div>
                  <div className="an-top-pair">{data.pairData[data.pairData.length - 1].pair}</div>
                  <div className="an-top-pl" style={{ color: data.pairData[data.pairData.length - 1].pl >= 0 ? GREEN : RED }}>
                    {fmtPL(data.pairData[data.pairData.length - 1].pl)}
                  </div>
                  <div className="an-top-sub">{data.pairData[data.pairData.length - 1].winRate}% win rate · {data.pairData[data.pairData.length - 1].count} trades</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Cumulative P/L trend ── */}
      <div className="an-card">
        <div className="an-card-title">CUMULATIVE P/L TREND ({accountCurrency})</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data.cumPL} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="plGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={data.totalPL >= 0 ? GREEN : RED} stopOpacity={0.25} />
                <stop offset="95%" stopColor={data.totalPL >= 0 ? GREEN : RED} stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" />
            <XAxis dataKey="date" tick={tickStyle} />
            <YAxis tick={tickStyle} tickFormatter={fmtTick} />
            <Tooltip content={<AnTooltip valFmt={fmtPL} />} />
            <Area
              type="monotone" dataKey="cumPL" name="Cum. P/L"
              stroke={data.totalPL >= 0 ? GREEN : RED}
              fill="url(#plGrad)" strokeWidth={2}
              dot={false} activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── P/L per trade bar ── */}
      <div className="an-card">
        <div className="an-card-title">P/L PER TRADE ({accountCurrency})</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data.tradeBars} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
            <XAxis dataKey="i" tick={tickStyle} label={{ value: 'Trade #', fill: '#6b7280', fontSize: 9, position: 'insideBottomRight', offset: 0 }} />
            <YAxis tick={tickStyle} tickFormatter={fmtTick} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="an-tooltip">
                    <div className="an-tt-label">Trade #{d.i} · {d.pair}</div>
                    <div className="an-tt-row">
                      <span style={{ color: d.pl >= 0 ? GREEN : RED }}>P/L: </span>
                      <span>{fmtPL(d.pl)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="pl" name="P/L" radius={[2, 2, 0, 0]}>
              {data.tradeBars.map((e, i) => <Cell key={i} fill={e.pl >= 0 ? GREEN : RED} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── P/L by pair (horizontal) ── */}
      <div className="an-card">
        <div className="an-card-title">P/L BY CURRENCY PAIR ({accountCurrency})</div>
        <ResponsiveContainer width="100%" height={Math.max(200, data.pairData.length * 44)}>
          <BarChart
            data={data.pairData} layout="vertical"
            margin={{ top: 10, right: 60, left: 20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" horizontal={false} />
            <XAxis type="number" tick={tickStyle} tickFormatter={fmtTick} />
            <YAxis type="category" dataKey="pair" tick={pairTickStyle} width={74} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div className="an-tooltip">
                    <div className="an-tt-label">{d.pair}</div>
                    <div className="an-tt-row"><span>P/L: </span><span style={{ color: d.pl >= 0 ? GREEN : RED }}>{fmtPL(d.pl)}</span></div>
                    <div className="an-tt-row"><span>Trades: </span><span>{d.count}</span></div>
                    <div className="an-tt-row"><span>Win rate: </span><span style={{ color: d.winRate >= 50 ? GREEN : RED }}>{d.winRate}%</span></div>
                  </div>
                );
              }}
            />
            <Bar dataKey="pl" name="P/L" radius={[0, 2, 2, 0]}>
              {data.pairData.map((e, i) => <Cell key={i} fill={e.pl >= 0 ? GREEN : RED} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Win rate by pair (only pairs with > 1 trade) ── */}
      {data.pairData.filter(p => p.count > 1).length > 0 && (
        <div className="an-card">
          <div className="an-card-title">WIN RATE BY PAIR (%)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.pairData.filter(p => p.count > 1)} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e1e1e" vertical={false} />
              <XAxis dataKey="pair" tick={{ ...tickStyle, fontSize: 9 }} />
              <YAxis domain={[0, 100]} tick={tickStyle} tickFormatter={fmtPct} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0]?.payload;
                  return (
                    <div className="an-tooltip">
                      <div className="an-tt-label">{d.pair}</div>
                      <div className="an-tt-row"><span>Win rate: </span><span style={{ color: d.winRate >= 50 ? GREEN : RED }}>{d.winRate}%</span></div>
                      <div className="an-tt-row"><span>Trades: </span><span>{d.count}</span></div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="winRate" name="Win Rate %" radius={[2, 2, 0, 0]}>
                {data.pairData.filter(p => p.count > 1).map((e, i) => (
                  <Cell key={i} fill={e.winRate >= 50 ? GREEN : RED} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}
