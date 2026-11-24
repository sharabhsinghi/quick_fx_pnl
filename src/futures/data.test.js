import { addCoverage, missingRanges, contractPieces, withEtFields, aggregate } from './data';

const D = (s) => Date.parse(s + 'T00:00:00Z');

test('coverage merges and gaps only cover what is missing', () => {
  let cov = addCoverage([], D('2025-01-01'), D('2025-01-10'));
  cov = addCoverage(cov, D('2025-01-20'), D('2025-01-25'));
  cov = addCoverage(cov, D('2025-01-09'), D('2025-01-12'));
  expect(cov).toEqual([[D('2025-01-01'), D('2025-01-12')], [D('2025-01-20'), D('2025-01-25')]]);
  expect(missingRanges(cov, D('2024-12-30'), D('2025-01-22'))).toEqual([
    [D('2024-12-30'), D('2025-01-01')], [D('2025-01-12'), D('2025-01-20')],
  ]);
  expect(missingRanges(cov, D('2025-01-02'), D('2025-01-05'))).toEqual([]);
});

test('front-month rolls 8 days before the 3rd-Friday expiry', () => {
  // Dec 2025 expiry is Fri 19 Dec -> roll Thu 11 Dec into Mar 2026 (ESH6).
  expect(contractPieces('ES', D('2025-12-01'), D('2025-12-20'))).toEqual([
    { ticker: 'ESZ5', from: D('2025-12-01'), to: D('2025-12-11') },
    { ticker: 'ESH6', from: D('2025-12-11'), to: D('2025-12-20') },
  ]);
});

test('ET fields and session-anchored aggregation', () => {
  // 2025-07-01 17:59 ET (EDT) = 21:59Z; 18:00 ET opens the 07-02 session.
  const a = withEtFields({ t: Date.parse('2025-07-01T21:59:00Z') });
  expect([a.d, a.m, a.sess]).toEqual(['2025-07-01', 17 * 60 + 59, '2025-07-01']);
  const b = withEtFields({ t: Date.parse('2025-07-01T22:00:00Z') });
  expect(b.sess).toBe('2025-07-02');
  const bars = [0, 1, 2, 3, 4, 5].map(i => withEtFields({ t: Date.parse('2025-07-02T13:30:00Z') + i * 60000, o: i, h: i + 1, l: i - 1, c: i, v: 1 }));
  const five = aggregate(bars, 5);
  expect(five.map(c => [c.m, c.o, c.h, c.l, c.c, c.v])).toEqual([[570, 0, 5, -1, 4, 5], [575, 5, 6, 4, 5, 1]]);
});
