import {
  newAccount, placeOrder, processBar, closePosition, setDrawdownLimit, resetDrawdown, equity,
} from './engine';

const bar = (t, o, h, l, c) => ({ t, o, h, l, c });
const seed = (px = 5000) => processBar(newAccount(), 'ES', bar(0, px, px, px, px));

test('market buy fills at last price, charges fee, marks to market', () => {
  let { acct } = placeOrder(seed(), { inst: 'ES', side: 'buy', qty: 2, type: 'market' }, 1);
  expect(acct.positions.ES).toEqual({ qty: 2, avg: 5000 });
  expect(acct.balance).toBeCloseTo(25000 - 4.5);
  acct = processBar(acct, 'ES', bar(2, 5000, 5010, 5000, 5010));
  expect(equity(acct)).toBeCloseTo(25000 - 4.5 + 10 * 2 * 50);
});

test('bracket: TP and SL legs spawn on fill, TP fill cancels SL (OCO)', () => {
  let { acct } = placeOrder(seed(), { inst: 'MES', side: 'buy', qty: 1, type: 'market', tpPts: 10, slPts: 5 }, 1);
  expect(acct.orders.map(o => [o.label, o.price || o.stop])).toEqual([['TP', 5010], ['SL', 4995]]);
  acct = processBar(acct, 'ES', bar(2, 5001, 5012, 5000, 5011));
  expect(acct.positions.MES).toBeUndefined();
  expect(acct.orders).toHaveLength(0);
  expect(acct.fills[1].pnl).toBeCloseTo(10 * 5);
});

test('buy limit fills at limit, or better on a gap', () => {
  let { acct } = placeOrder(seed(), { inst: 'ES', side: 'buy', qty: 1, type: 'limit', price: 4990 }, 1);
  acct = processBar(acct, 'ES', bar(2, 4985, 4986, 4980, 4982)); // gaps below
  expect(acct.positions.ES.avg).toBe(4985);
});

test('sell stop-limit triggers then fills as limit', () => {
  let { acct } = placeOrder(seed(), { inst: 'ES', side: 'sell', qty: 1, type: 'stopLimit', stop: 4995, price: 4994 }, 1);
  acct = processBar(acct, 'ES', bar(2, 5000, 5001, 4990, 4992));
  expect(acct.positions.ES).toEqual({ qty: -1, avg: 4995 }) // limit 4994 or better;
});

test('trailing SL follows price up and exits on pullback', () => {
  let { acct } = placeOrder(seed(), { inst: 'ES', side: 'buy', qty: 1, type: 'market', slPts: 5, slTrail: true }, 1);
  acct = processBar(acct, 'ES', bar(2, 5000, 5020, 5000, 5020));
  expect(acct.orders[0].stop).toBe(5015);
  acct = processBar(acct, 'ES', bar(3, 5020, 5020, 5010, 5012));
  expect(acct.positions.ES).toBeUndefined();
  expect(acct.fills[1].price).toBe(5015);
});

test('flip from long to short realizes PnL and resets avg', () => {
  let { acct } = placeOrder(processBar(newAccount(), 'NQ', bar(0, 100, 100, 100, 100)), { inst: 'NQ', side: 'buy', qty: 1, type: 'market' }, 1);
  acct = processBar(acct, 'NQ', bar(2, 100, 110, 100, 110));
  ({ acct } = placeOrder(acct, { inst: 'NQ', side: 'sell', qty: 3, type: 'market' }, 3));
  expect(acct.positions.NQ).toEqual({ qty: -2, avg: 110 });
  expect(acct.fills[1].pnl).toBeCloseTo(10 * 20);
});

test('trailing drawdown breach liquidates, locks, and reset unlocks', () => {
  let acct = setDrawdownLimit(seed(), 1000);
  ({ acct } = placeOrder(acct, { inst: 'ES', side: 'buy', qty: 1, type: 'market' }, 1));
  acct = processBar(acct, 'ES', bar(2, 5000, 5030, 5000, 5030)); // peak +1500
  acct = processBar(acct, 'ES', bar(3, 5030, 5030, 5005, 5010)); // drops 1250 from peak
  expect(acct.breached).toBe(true);
  expect(acct.positions.ES).toBeUndefined();
  expect(placeOrder(acct, { inst: 'ES', side: 'buy', qty: 1, type: 'market' }, 4).error).toMatch(/Drawdown/);
  acct = resetDrawdown(acct);
  expect(acct.breached).toBe(false);
  expect(placeOrder(acct, { inst: 'ES', side: 'buy', qty: 1, type: 'market' }, 4).error).toBeNull();
});

test('closing a position cancels its brackets', () => {
  let { acct } = placeOrder(seed(), { inst: 'ES', side: 'sell', qty: 1, type: 'market', tpPts: 4, slPts: 4 }, 1);
  acct = closePosition(acct, 'ES', 2);
  expect(acct.orders).toHaveLength(0);
  expect(acct.positions.ES).toBeUndefined();
});
