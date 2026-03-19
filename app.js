/**
 * Quick FX P&L Tracker
 * Tracks the profit/loss of a single forex trade in real time.
 *
 * Price source: Frankfurter API (ECB reference rates, free, no key required)
 *   https://api.frankfurter.app/latest?from={base}&to={quote}
 *
 * Polling interval: 60 seconds (background refresh even without user action).
 */

'use strict';

/* ── Constants ─────────────────────────────────────────────────── */
const POLL_INTERVAL_MS = 60_000;          // 1 minute
const FRANKFURTER_URL  = 'https://api.frankfurter.app/latest';

/* ── State ─────────────────────────────────────────────────────── */
let trade        = null;   // active trade object
let currentPrice = null;   // latest fetched price
let pollTimer    = null;   // setInterval handle
let tradeClosed  = false;

/* ── DOM refs ───────────────────────────────────────────────────── */
const setupCard   = document.getElementById('setup-card');
const statusCard  = document.getElementById('status-card');
const closedCard  = document.getElementById('closed-card');

const pairInput    = document.getElementById('pair');
const entryInput   = document.getElementById('entry-price');
const lotInput     = document.getElementById('lot-size');
const slInput      = document.getElementById('stop-loss');
const tpInput      = document.getElementById('take-profit');
const accountInput = document.getElementById('account-size');
const setupError   = document.getElementById('setup-error');

const dispEntry   = document.getElementById('disp-entry');
const dispCurrent = document.getElementById('disp-current');
const dispSl      = document.getElementById('disp-sl');
const dispTp      = document.getElementById('disp-tp');

const pnlMain    = document.getElementById('pnl-main');
const pnlPips    = document.getElementById('pnl-pips');
const pnlPct     = document.getElementById('pnl-pct');
const slBar      = document.getElementById('sl-bar');
const tpBar      = document.getElementById('tp-bar');
const slDist     = document.getElementById('sl-dist');
const tpDist     = document.getElementById('tp-dist');

const lastUpdated   = document.getElementById('last-updated');
const apiError      = document.getElementById('api-error');
const statusPairLbl = document.getElementById('status-pair-label');
const pollBadge     = document.getElementById('poll-badge');

const setTradeBtn  = document.getElementById('set-trade-btn');
const refreshBtn   = document.getElementById('refresh-btn');
const closeBtn     = document.getElementById('close-btn');
const newTradeBtn  = document.getElementById('new-trade-btn');
const newTradeBtn2 = document.getElementById('new-trade-btn-2');

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * Parse a currency pair string ("EURUSD", "EUR/USD", "eur usd" …)
 * and return { base: "EUR", quote: "USD" } or null if invalid.
 */
function parsePair(raw) {
  const clean = raw.replace(/[^a-zA-Z]/g, '').toUpperCase();
  if (clean.length !== 6) return null;
  return { base: clean.slice(0, 3), quote: clean.slice(3, 6) };
}

/**
 * Return the pip size for the currency pair.
 * JPY-quoted pairs use 0.01; everything else uses 0.0001.
 */
function pipSize(quoteCurrency) {
  return quoteCurrency === 'JPY' ? 0.01 : 0.0001;
}

/**
 * Decimal places to show for prices.
 */
function priceDecimals(quoteCurrency) {
  return quoteCurrency === 'JPY' ? 3 : 5;
}

function fmt(value, decimals) {
  return value.toFixed(decimals);
}

function fmtPrice(value, quoteCurrency) {
  return fmt(value, priceDecimals(quoteCurrency));
}

/** Format a P&L value as a currency string (USD-based). */
function fmtPnl(value) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

/* ── Price Fetching ─────────────────────────────────────────────── */

/**
 * Fetch the current exchange rate for a pair from Frankfurter API.
 * Returns the rate as a number, or throws an error.
 */
async function fetchPrice(base, quote) {
  const url = `${FRANKFURTER_URL}?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  if (!data.rates || !(quote in data.rates)) {
    throw new Error(`Rate not found for ${base}/${quote}`);
  }
  return data.rates[quote];
}

/* ── P&L Calculation ────────────────────────────────────────────── */

/**
 * Calculate profit/loss details for an active trade.
 *
 * Returns:
 *   pnlQuote  – P&L in the quote currency
 *   pips      – number of pips gained/lost
 *   pnlPct    – P&L as % of account size
 *   slDistPct – how close price is to SL (0–100%)
 *   tpDistPct – how close price is to TP (0–100%)
 *   slDistPips– distance from current to SL in pips
 *   tpDistPips– distance from current to TP in pips
 */
function calcPnl(trade, price) {
  const dir  = trade.direction === 'buy' ? 1 : -1;
  const ps   = pipSize(trade.quote);
  const decs = priceDecimals(trade.quote);

  const rawDiff   = (price - trade.entry) * dir;
  const pnlQuote  = rawDiff * trade.units;
  const pips      = rawDiff / ps;
  const pnlPct    = trade.accountSize > 0 ? (pnlQuote / trade.accountSize) * 100 : 0;

  // Distance to SL / TP
  const slDiff = trade.direction === 'buy'
    ? price - trade.sl
    : trade.sl - price;
  const tpDiff = trade.direction === 'buy'
    ? trade.tp - price
    : price - trade.tp;

  const totalSlRange = Math.abs(trade.entry - trade.sl);
  const totalTpRange = Math.abs(trade.tp - trade.entry);

  // How much of the SL range has been consumed (price moving toward SL)
  const slConsumed = totalSlRange > 0 ? Math.max(0, totalSlRange - Math.max(0, slDiff)) : 0;
  const tpConsumed = totalTpRange > 0 ? Math.max(0, totalTpRange - Math.max(0, tpDiff)) : 0;

  const slDistPct = totalSlRange > 0 ? Math.min(100, (slConsumed / totalSlRange) * 100) : 0;
  const tpDistPct = totalTpRange > 0 ? Math.min(100, (tpConsumed / totalTpRange) * 100) : 0;

  const slDistPips = slDiff / ps;
  const tpDistPips = tpDiff / ps;

  return { pnlQuote, pips, pnlPct, slDistPct, tpDistPct, slDistPips, tpDistPips };
}

/* ── Display Update ─────────────────────────────────────────────── */

function updateStatusDisplay(price) {
  const decs = priceDecimals(trade.quote);

  dispCurrent.textContent = fmtPrice(price, trade.quote);

  const result = calcPnl(trade, price);

  // P&L colour
  pnlMain.textContent = fmtPnl(result.pnlQuote);
  pnlMain.className   = 'pnl-main ' + (result.pnlQuote >= 0 ? 'profit' : 'loss');

  // Sub-line
  const pipSign = result.pips >= 0 ? '+' : '';
  pnlPips.textContent = `${pipSign}${result.pips.toFixed(1)} pips`;

  const pctSign = result.pnlPct >= 0 ? '+' : '';
  pnlPct.textContent  = `${pctSign}${result.pnlPct.toFixed(2)}% of account`;

  // Progress bars
  slBar.style.width = `${result.slDistPct.toFixed(1)}%`;
  tpBar.style.width = `${result.tpDistPct.toFixed(1)}%`;

  slDist.textContent = `${result.slDistPips.toFixed(1)} pips away`;
  tpDist.textContent = `${result.tpDistPips.toFixed(1)} pips away`;

  // Timestamp
  const now = new Date();
  lastUpdated.textContent = `Last updated: ${now.toLocaleTimeString()}`;
  apiError.textContent    = '';
}

/* ── Refresh ────────────────────────────────────────────────────── */

async function doRefresh() {
  if (!trade || tradeClosed) return;

  refreshBtn.disabled = true;
  refreshBtn.textContent = '↻ Refreshing…';

  try {
    const price = await fetchPrice(trade.base, trade.quote);
    currentPrice = price;
    updateStatusDisplay(price);
  } catch (err) {
    apiError.textContent = `⚠ ${err.message}`;
    lastUpdated.textContent = `Last update attempt: ${new Date().toLocaleTimeString()}`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻ Refresh';
  }
}

/* ── Poller ─────────────────────────────────────────────────────── */

function startPoller() {
  stopPoller();
  pollBadge.textContent = '● Live';
  pollBadge.classList.remove('offline');
  pollTimer = setInterval(doRefresh, POLL_INTERVAL_MS);
}

function stopPoller() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/* ── Set Trade ───────────────────────────────────────────────────── */

async function handleSetTrade() {
  setupError.textContent = '';

  // -- Validate pair
  const pairRaw = pairInput.value.trim();
  const parsed  = parsePair(pairRaw);
  if (!parsed) {
    setupError.textContent = 'Enter a valid 6-character currency pair (e.g. EURUSD).';
    return;
  }

  // -- Validate numbers
  const entry   = parseFloat(entryInput.value);
  const units   = parseFloat(lotInput.value);
  const sl      = parseFloat(slInput.value);
  const tp      = parseFloat(tpInput.value);
  const account = parseFloat(accountInput.value);
  const dir     = document.querySelector('input[name="direction"]:checked').value;

  if ([entry, units, sl, tp, account].some(v => isNaN(v) || v <= 0)) {
    setupError.textContent = 'All numeric fields must be positive numbers.';
    return;
  }

  // -- Direction-specific SL/TP sanity checks
  if (dir === 'buy') {
    if (sl >= entry) { setupError.textContent = 'For a BUY trade, Stop Loss must be below Entry Price.'; return; }
    if (tp <= entry) { setupError.textContent = 'For a BUY trade, Take Profit must be above Entry Price.'; return; }
  } else {
    if (sl <= entry) { setupError.textContent = 'For a SELL trade, Stop Loss must be above Entry Price.'; return; }
    if (tp >= entry) { setupError.textContent = 'For a SELL trade, Take Profit must be below Entry Price.'; return; }
  }

  // -- Build trade object
  trade = {
    base:        parsed.base,
    quote:       parsed.quote,
    direction:   dir,
    entry:       entry,
    units:       units,
    sl:          sl,
    tp:          tp,
    accountSize: account,
  };
  tradeClosed  = false;
  currentPrice = null;

  // -- Show status card
  const decs = priceDecimals(trade.quote);
  statusPairLbl.textContent  = `${parsed.base}/${parsed.quote} · ${dir.toUpperCase()}`;
  dispEntry.textContent      = fmtPrice(entry, trade.quote);
  dispSl.textContent         = fmtPrice(sl, trade.quote);
  dispTp.textContent         = fmtPrice(tp, trade.quote);
  dispCurrent.textContent    = '—';
  pnlMain.textContent        = '—';
  pnlMain.className          = 'pnl-main';
  pnlPips.textContent        = '— pips';
  pnlPct.textContent         = '—% of account';
  slBar.style.width          = '0%';
  tpBar.style.width          = '0%';
  slDist.textContent         = '—';
  tpDist.textContent         = '—';
  lastUpdated.textContent    = 'Fetching price…';
  apiError.textContent       = '';

  setupCard.hidden  = true;
  statusCard.hidden = false;
  closedCard.hidden = true;

  // -- Initial fetch + start poller
  await doRefresh();
  startPoller();
}

/* ── Close Trade ─────────────────────────────────────────────────── */

async function handleCloseTrade() {
  if (!trade || tradeClosed) return;

  closeBtn.disabled = true;
  closeBtn.textContent = '✕ Closing…';

  // Final price fetch
  let closePrice = currentPrice;
  try {
    closePrice = await fetchPrice(trade.base, trade.quote);
    currentPrice = closePrice;
  } catch (_) {
    // Use last known price if fetch fails
  }

  stopPoller();
  tradeClosed = true;

  if (closePrice === null) {
    closePrice = trade.entry; // fallback
  }

  const result = calcPnl(trade, closePrice);
  const decs   = priceDecimals(trade.quote);

  // Populate closed card
  document.getElementById('closed-pair').textContent  = `${trade.base}/${trade.quote}`;
  document.getElementById('closed-dir').textContent   = trade.direction.toUpperCase();
  document.getElementById('closed-entry').textContent = fmtPrice(trade.entry, trade.quote);
  document.getElementById('closed-exit').textContent  = fmtPrice(closePrice, trade.quote);
  document.getElementById('closed-units').textContent = trade.units.toLocaleString();

  const closedPnlEl = document.getElementById('closed-pnl');
  closedPnlEl.textContent  = fmtPnl(result.pnlQuote);
  closedPnlEl.style.color  = result.pnlQuote >= 0 ? 'var(--green)' : 'var(--red)';

  const pipSign = result.pips >= 0 ? '+' : '';
  document.getElementById('closed-pips').textContent = `${pipSign}${result.pips.toFixed(1)} pips`;

  const pctSign = result.pnlPct >= 0 ? '+' : '';
  document.getElementById('closed-pct').textContent  = `${pctSign}${result.pnlPct.toFixed(2)}%`;

  // Switch cards
  statusCard.hidden = true;
  closedCard.hidden = false;
  setupCard.hidden  = true;

  // Update badge
  pollBadge.textContent = '○ Stopped';
  pollBadge.classList.add('offline');

  closeBtn.disabled    = false;
  closeBtn.textContent = '✕ Close Trade';
}

/* ── New Trade ───────────────────────────────────────────────────── */

function handleNewTrade() {
  stopPoller();
  trade        = null;
  currentPrice = null;
  tradeClosed  = false;

  // Reset form
  pairInput.value    = '';
  entryInput.value   = '';
  lotInput.value     = '';
  slInput.value      = '';
  tpInput.value      = '';
  accountInput.value = '';
  setupError.textContent = '';
  document.querySelector('input[name="direction"][value="buy"]').checked = true;

  setupCard.hidden  = false;
  statusCard.hidden = true;
  closedCard.hidden = true;
}

/* ── Event Listeners ─────────────────────────────────────────────── */

setTradeBtn.addEventListener('click', handleSetTrade);
refreshBtn.addEventListener('click', doRefresh);
closeBtn.addEventListener('click', handleCloseTrade);
newTradeBtn.addEventListener('click', handleNewTrade);
newTradeBtn2.addEventListener('click', handleNewTrade);

// Allow pressing Enter in the form to set the trade
[pairInput, entryInput, lotInput, slInput, tpInput, accountInput].forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSetTrade();
  });
});
