# ORB screener + backtester

Ported from the single-file `orb-screener.html` prototype. Everything runs
client-side: Twelve Data / Tradier are called directly from the browser, bars are
cached in IndexedDB, and the backtest is pure computation over that cache.

## Layout

| File | Role |
|---|---|
| `constants.js` | Default universe, thresholds, rate limits, trade-management defaults |
| `time.js` | ET wall-clock ↔ epoch, session boundaries |
| `indicators.js` | RSI / VWAP / ATR / RVOL baseline — **ported verbatim** |
| `analysis.js` | Opening range → breakout scan → filter stack |
| `twelveData.js` | Rate-limited, paginated OHLCV client |
| `tradier.js` | ATM implied volatility (live screener only) |
| `store.js` | IndexedDB cache (`orb-screener` database) |
| `history.js` | One-time / incremental historical backfill |
| `transfer.js` | Export / import of the whole cache as a file |
| `blackScholes.js` | Option pricing, greeks, implied vol, strike/expiry ladders |
| `backtest.js` | Day-by-day replay + trade simulation + reporting |

UI lives in `src/components/ORB.js` and `src/components/orb/*`, mounted as the
`ORB` tab in `src/App.js`, with five sub-screens: SCREENER, DATA, BACKTEST,
CHART and CONFIG.

The CHART screen replays a chosen session through the live screener's own
`analyzeSession` — same thresholds, same prior-days-only RVOL baseline — so the
opening range, VWAP and breakout marker it draws are what the screener would
have said that morning, not a re-derivation. Trades come from saved backtest
runs (`runs` store, last 10 kept). Because an options trade's entry, stop and
target are premiums, only its underlying entry/exit are marked on the price
axis; the premium levels are deliberately not drawn, since they have no meaning
on a price scale.

The modules above have no React or Next.js dependency, so they can be lifted into
another project as a folder.

## Preserved behaviour

`indicators.js` and the filter semantics in `analysis.js` are direct ports, not
rewrites, so the live screener and the backtest cannot drift numerically. Two
details are deliberate and easy to "fix" by mistake:

1. **Asymmetric gating.** `bodyClean` and `passesRvol` must be strictly `true`;
   RSI, VWAP, gap and ATR-range only have to not be `false`. A `null` (the
   indicator could not be computed — e.g. ATR before 15 daily bars exist) does
   not block a trigger.
2. **Breakout selection.** Default is the prototype's: scan forward and take the
   first candle that clears *every* filter. `singleShot: true` switches to
   "the first close outside the range is the signal, pass or fail".

## Look-ahead discipline

The backtest walks days in forward order and, for each day, only uses data that
existed before it: the RVOL baseline comes from strictly prior sessions
(`baselineForDayIndex`), ATR and gap % from daily bars strictly before the
session, RSI and VWAP only through the breakout candle, and trade management only
reads bars at or after the entry bar. A trailing stop is ratcheted using bars
that have already closed, never the bar currently being tested for a hit.

## Stop types

`slMode`/`slValue` set the **initial** stop. `slType` decides how it moves:

| Type | Behaviour |
|---|---|
| `strict` | Never moves. |
| `trailing` | Follows the **price** by the stop distance. A percentage here is a percentage *of price*, so a wide one (20%) is never reached inside a session and trades run to the close. |
| `giveback` | Follows the **open profit**, keeping `100 - givebackPct`% of the best gain so far. This is the "let it run, exit when it hands back a fifth" behaviour. |

`giveback` stays disarmed until the trade is `givebackActivatePct` in front. Without
that guard the first tick of profit drags the stop to breakeven and ordinary noise
closes the position on the next bar — measured on a trending session, activation
at 0% exits at 09:55 while activation at 0.5% rides to 12:05.

The two are genuinely different exits, not variations in tightness. On a short
entered at 81.60 that fell to 78.59:

```
20% trailing price     stop sits at 94.30, ~20% above anything price reached -> 16:00 close
20% profit giveback    exits 12:05 at 79.37, keeping ~80% of the peak gain
```

## Modelling assumptions (all configurable)

* Take profits fill **at the limit**; stops fill at the stop level **or the bar's
  open if it gapped through**, whichever is worse.
* When one 5-min candle contains both the stop and the target, the stop is
  assumed to have printed first (`ambiguity: 'stop_first'`).
* Trades are sized off equity at the **start of the entry day**, so several
  signals on one day do not compound off each other while all are still open.
* Sharpe is annualised from daily account returns at 252 days and treats a
  no-trade day as a 0% return.

## Backup and transfer

A cold one-year pull costs ~100 Twelve Data requests and about twelve minutes at
the free tier. `transfer.js` writes the entire cache — 5-min bars, daily bars,
coverage metadata and captured IV readings — to a single file, and reads it back
on any machine with no API key and no network calls.

The wire format is columnar: each bar is `[m, o, h, l, c, v]` with the session
date carried once on the row, rather than an object repeating its keys ~20,000
times per ticker. The epoch timestamp is **not written at all** — it is rebuilt
on import from the ET date and minute-of-day by the same converter that produced
it, which is what keeps the round trip lossless across both DST transitions.
Measured on real-shaped data: ~11 bytes per bar gzipped, so a 20-ticker year
lands around 4-5 MB.

Import is two-step by design. The file is parsed and validated first and its
contents shown per ticker; nothing is written until the mode is confirmed.
`merge` keeps everything already cached and lets the file win on overlapping
dates; `replace` clears each ticker named in the file first, leaving other
tickers untouched. Coverage metadata is always recomputed from what actually
landed rather than trusted from the file. API keys are never exported.

## Options mode

The same ORB signal can be expressed as a long call (long breakout) or long put
(short breakout). Both instruments share one management loop: in options mode the
loop walks a synthetic premium series built by pricing the contract at every
bar's underlying levels, so stops, targets, trailing and the ambiguous-candle
rule are literally the same code.

Because the premium is monotonic in the underlying, a bar's option high comes
from the underlying's high for a call and its low for a put. Time to expiry is
recomputed per bar, so theta decays through the session — which is the entire
story for a 0DTE contract.

Defaults: 0 DTE, strike nearest the session open, 20% trailing stop on the
premium, no take profit, fills at the model mid.

**What the model does not capture.** Prices come from Black-Scholes, not from
replayed quotes — no historical option data exists to replay. That means European
exercise, one volatility held constant for the life of each trade (so no intraday
IV crush or expansion), and no skew. At 0 DTE these limits bite hardest: real
same-day contracts carry pin risk and a steep skew a flat-sigma model does not
reproduce. With the spread set to zero, results are a clean read on whether the
signal has edge, but they are **not tradeable numbers** — crossing a short-dated
spread twice routinely flips a strategy's sign.

Where no volatility input exists (no captured reading and too little daily
history for realised vol), the trade is skipped and counted as *unpriceable*
rather than priced off a guess.

## Implied volatility

Tradier serves current option chains only; there is no historical-greeks endpoint
at any tier, and no free source of historical per-ticker IV exists. Rather than
substitute a realized-volatility proxy, the live screener writes each real ATM
reading into the `ivDaily` store, building a genuine forward history. The
backtest uses a reading only where one exists and otherwise reports IV as **not
evaluated**.
