// Simulated futures account + order matching for the Practice Futures tool.
//
// Pure functions over a plain-object account so the whole state can be saved
// to IndexedDB as-is. Every exported mutator returns a NEW account (structured
// clone), so React state updates stay simple.
//
// Fills are simulated on 1-minute bars. Inside a bar the price is assumed to
// travel open -> nearer extreme -> farther extreme -> close, the usual
// bar-replay convention.
// shortcut: no tick data, so intrabar order of high/low is a guess; upgrade if tick/1s data is ever cached.

export const INSTRUMENTS = {
  ES: { key: 'ES', root: 'ES', name: 'E-mini S&P 500', pointValue: 50, tick: 0.25, fee: 2.25 },
  MES: { key: 'MES', root: 'ES', name: 'Micro E-mini S&P 500', pointValue: 5, tick: 0.25, fee: 0.62 },
  NQ: { key: 'NQ', root: 'NQ', name: 'E-mini Nasdaq-100', pointValue: 20, tick: 0.25, fee: 2.25 },
  MNQ: { key: 'MNQ', root: 'NQ', name: 'Micro E-mini Nasdaq-100', pointValue: 2, tick: 0.25, fee: 0.62 },
};

export const ORDER_TYPES = [
  { key: 'market', label: 'MARKET' },
  { key: 'limit', label: 'LIMIT' },
  { key: 'stop', label: 'STOP' },
  { key: 'stopLimit', label: 'STOP LIMIT' },
  { key: 'trail', label: 'TRAILING STOP' },
];

export const START_BALANCE = 25000;

export function newAccount(startBalance = START_BALANCE, ddLimit = null) {
  return {
    startBalance, balance: startBalance, positions: {}, orders: [], fills: [],
    last: {}, ddLimit, peak: startBalance, breached: false, nextId: 1,
  };
}

const clone = (a) => JSON.parse(JSON.stringify(a));
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const roundTick = (p, tick) => Math.round(p / tick) * tick;

export function unrealized(acct, inst) {
  const pos = acct.positions[inst];
  const px = acct.last[INSTRUMENTS[inst].root];
  if (!pos || !pos.qty || px == null) return 0;
  return (px - pos.avg) * pos.qty * INSTRUMENTS[inst].pointValue;
}

export function equity(acct) {
  return acct.balance + Object.keys(acct.positions).reduce((s, k) => s + unrealized(acct, k), 0);
}

export function ddThreshold(acct) {
  return acct.ddLimit ? acct.peak - acct.ddLimit : null;
}

// Apply one execution to the account (mutates `a`).
function execute(a, order, price, time) {
  const spec = INSTRUMENTS[order.inst];
  const pos = a.positions[order.inst] || { qty: 0, avg: 0 };
  let q = order.side === 'buy' ? order.qty : -order.qty;

  if (order.reduceOnly) {
    // Never let a TP/SL grow or flip the position it protects.
    if (!pos.qty || sgn(pos.qty) === sgn(q)) { order.status = 'cancelled'; return; }
    q = sgn(q) * Math.min(Math.abs(q), Math.abs(pos.qty));
  }

  let pnl = 0;
  if (pos.qty && sgn(pos.qty) !== sgn(q)) {
    const closed = Math.min(Math.abs(q), Math.abs(pos.qty));
    pnl = (price - pos.avg) * closed * sgn(pos.qty) * spec.pointValue;
  }
  const newQty = pos.qty + q;
  let avg = pos.avg;
  if (!pos.qty || sgn(newQty) !== sgn(pos.qty)) avg = price; // opened or flipped
  else if (Math.abs(newQty) > Math.abs(pos.qty)) avg = (pos.avg * pos.qty + price * q) / newQty;

  const fee = Math.abs(q) * spec.fee;
  a.balance += pnl - fee;
  if (newQty) a.positions[order.inst] = { qty: newQty, avg };
  else delete a.positions[order.inst];

  order.status = 'filled';
  order.fillPrice = price;
  order.filledAt = time;
  a.fills.push({
    id: order.id, time, inst: order.inst, side: order.side, qty: Math.abs(q), price, pnl, fee,
    label: order.label || order.type,
  });

  // One-cancels-other: the sibling TP/SL of a filled bracket leg.
  if (order.oco) {
    a.orders.forEach((o) => { if (o.oco === order.oco && o.id !== order.id && o.status === 'open') o.status = 'cancelled'; });
  }
  // Flat -> leftover protective orders are stale.
  if (!newQty) {
    a.orders.forEach((o) => { if (o.inst === order.inst && o.reduceOnly && o.status === 'open') o.status = 'cancelled'; });
  }
  // Entry with brackets -> spawn TP/SL legs around the actual fill.
  if (!order.reduceOnly && (order.tpPts || order.slPts)) {
    const dir = order.side === 'buy' ? 1 : -1;
    const exitSide = order.side === 'buy' ? 'sell' : 'buy';
    const base = { inst: order.inst, side: exitSide, qty: Math.abs(q), reduceOnly: true, oco: order.id, status: 'open', parent: order.id };
    if (order.tpPts) {
      a.orders.push({ ...base, id: a.nextId++, type: 'limit', label: 'TP', price: roundTick(price + dir * order.tpPts, spec.tick) });
    }
    if (order.slPts) {
      a.orders.push(order.slTrail
        ? { ...base, id: a.nextId++, type: 'trail', label: 'SL (trail)', trail: order.slPts, stop: roundTick(price - dir * order.slPts, spec.tick) }
        : { ...base, id: a.nextId++, type: 'stop', label: 'SL', stop: roundTick(price - dir * order.slPts, spec.tick) });
    }
  }
}

// Fill price for `order` if it triggers while price moves a -> b, else null.
function triggerOnSegment(order, a, b) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const buy = order.side === 'buy';
  if (order.type === 'limit') {
    if (buy && lo <= order.price) return a <= order.price ? a : order.price;
    if (!buy && hi >= order.price) return a >= order.price ? a : order.price;
    return null;
  }
  // stop, trail and the stop leg of stopLimit
  if (buy && hi >= order.stop) return a >= order.stop ? a : order.stop;
  if (!buy && lo <= order.stop) return a <= order.stop ? a : order.stop;
  return null;
}

function updateTrail(o, px, tick) {
  if (o.type !== 'trail' || o.status !== 'open') return;
  const next = o.side === 'sell' ? roundTick(px - o.trail, tick) : roundTick(px + o.trail, tick);
  o.stop = o.side === 'sell' ? Math.max(o.stop, next) : Math.min(o.stop, next);
}

function liquidateAll(a, time) {
  a.orders.forEach((o) => { if (o.status === 'open') o.status = 'cancelled'; });
  Object.keys(a.positions).forEach((inst) => {
    const pos = a.positions[inst];
    const px = a.last[INSTRUMENTS[inst].root];
    execute(a, { id: a.nextId++, inst, side: pos.qty > 0 ? 'sell' : 'buy', qty: Math.abs(pos.qty), type: 'market', label: 'DD LIQUIDATION' }, px, time);
  });
}

// Track the equity high-water mark; breach -> flatten everything and lock.
function checkDrawdown(a, time) {
  const eq = equity(a);
  if (eq > a.peak) a.peak = eq;
  const th = ddThreshold(a);
  if (!a.breached && th != null && eq <= th) {
    liquidateAll(a, time);
    a.breached = true;
    return true;
  }
  return false;
}

/** Run one 1-minute bar ({t,o,h,l,c}) of `root` through the account. */
export function processBar(acct, root, bar) {
  const a = clone(acct);
  const path = (bar.o - bar.l) < (bar.h - bar.o) ? [bar.o, bar.l, bar.h, bar.c] : [bar.o, bar.h, bar.l, bar.c];
  const mine = (o) => o.status === 'open' && INSTRUMENTS[o.inst].root === root;

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i], to = path[i + 1];
    a.last[root] = from;
    a.orders.filter(mine).forEach(o => updateTrail(o, from, INSTRUMENTS[o.inst].tick));
    if (checkDrawdown(a, bar.t)) break;
    // Snapshot: bracket legs spawned by a fill in this segment start checking on the next one.
    a.orders.filter(mine).forEach((o) => {
      if (o.status !== 'open') return; // cancelled by an OCO sibling earlier in this loop
      const px = triggerOnSegment(o, from, to);
      if (px === null) return;
      if (o.type === 'stopLimit') {
        o.type = 'limit';
        const lpx = triggerOnSegment(o, px, to);
        if (lpx !== null) execute(a, o, lpx, bar.t);
        return;
      }
      execute(a, o, px, bar.t);
    });
  }
  a.last[root] = bar.c;
  if (!a.breached) {
    a.orders.filter(mine).forEach(o => updateTrail(o, bar.c, INSTRUMENTS[o.inst].tick));
    checkDrawdown(a, bar.t);
  }
  a.orders = a.orders.filter(o => o.status === 'open');
  return a;
}

/**
 * Submit an order. `order` = { inst, side, qty, type, price?, stop?, trail?, tpPts?, slPts?, slTrail? }.
 * Market orders fill immediately at the current price of their root.
 * Returns { acct, error }.
 */
export function placeOrder(acct, order, time) {
  if (acct.breached) return { acct, error: 'Drawdown limit hit — reset the limit to keep trading.' };
  const spec = INSTRUMENTS[order.inst];
  const px = acct.last[spec.root];
  if (px == null) return { acct, error: 'No price yet — start the replay first.' };
  if (!(order.qty > 0)) return { acct, error: 'Quantity must be at least 1.' };
  const need = { limit: ['price'], stop: ['stop'], stopLimit: ['stop', 'price'], trail: ['trail'] }[order.type] || [];
  const missing = need.find(k => !(order[k] > 0));
  if (missing) return { acct, error: `Enter a ${missing} for a ${order.type} order.` };

  const a = clone(acct);
  const o = { ...order, id: a.nextId++, status: 'open', placedAt: time };
  if (o.price) o.price = roundTick(o.price, spec.tick);
  if (o.stop) o.stop = roundTick(o.stop, spec.tick);
  if (o.type === 'trail') o.stop = roundTick(o.side === 'sell' ? px - o.trail : px + o.trail, spec.tick);

  if (o.type === 'market') {
    execute(a, o, px, time);
  } else {
    // A stop already through the market would fill instantly — treat it like the exchange would.
    const instant = triggerOnSegment(o, px, px);
    if (instant !== null && o.type !== 'stopLimit') execute(a, o, instant, time);
    else a.orders.push(o);
  }
  a.orders = a.orders.filter(x => x.status === 'open');
  return { acct: a, error: null };
}

export function cancelOrder(acct, id) {
  const a = clone(acct);
  a.orders = a.orders.filter(o => o.id !== id);
  return a;
}

export function closePosition(acct, inst, time) {
  const pos = acct.positions[inst];
  if (!pos) return acct;
  const a = clone(acct);
  a.orders = a.orders.filter(o => o.inst !== inst);
  execute(a, { id: a.nextId++, inst, side: pos.qty > 0 ? 'sell' : 'buy', qty: Math.abs(pos.qty), type: 'market', label: 'CLOSE' }, a.last[INSTRUMENTS[inst].root], time);
  return a;
}

export function setDrawdownLimit(acct, ddLimit) {
  const a = clone(acct);
  a.ddLimit = ddLimit > 0 ? ddLimit : null;
  a.peak = equity(a);
  a.breached = false;
  return a;
}

// "Reset the limit": trail from today's equity again and unlock trading.
export const resetDrawdown = (acct) => setDrawdownLimit(acct, acct.ddLimit);
