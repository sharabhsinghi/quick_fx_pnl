export function fmtNum(n, d = 2) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtMoney(n, d = 2) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US',
    { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtPct(n, d = 1) {
  if (n === null || n === undefined || isNaN(n) || !isFinite(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(d) + '%';
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
}

export function fmtAgo(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.round(hrs / 24) + 'd ago';
}
