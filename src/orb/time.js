// ET wall-clock <-> epoch helpers.
//
// Twelve Data returns datetime strings in the exchange's local time (ET for US
// equities), e.g. "2026-08-31 09:35:00" for intraday or "2026-08-29" for daily.
// The analysis code was originally written against Polygon's {t: epochMs,...}
// shape, so bars are normalised to epoch ms — but we ALSO carry the ET date key
// and minutes-of-day alongside each bar, parsed straight out of the string.
//
// That matters for the backtest: deriving ET fields via Intl/toLocaleString for
// ~400k bars is slow, and the source string already is ET wall clock, so there
// is nothing to convert. The Intl-based helpers below are kept for the live path
// and for any bar that arrives without precomputed fields.

import { SESSION_OPEN_MINS, SESSION_CLOSE_MINS } from './constants';

// "2026-08-31 09:35:00" or "2026-08-31" -> epoch ms, honouring EST/EDT.
export function etWallClockToEpochMs(dateTimeStr) {
  const hasTime = dateTimeStr.indexOf(':') !== -1;
  const datePart = dateTimeStr.split(' ')[0];
  const timePart = hasTime ? dateTimeStr.split(' ')[1] : '16:00:00'; // daily bars: end-of-day ET

  // Determine the ET UTC offset for this date (handles DST) by rendering a known
  // UTC instant in ET and reading back the hour.
  const probeUtc = new Date(datePart + 'T12:00:00Z'); // noon UTC, safely clear of any DST edge
  const etString = probeUtc.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const etHour = Number(etString.split(', ')[1].split(':')[0]);
  const offsetHours = 12 - etHour; // ET = UTC - offsetHours

  const asIfUtc = new Date(datePart + 'T' + timePart + 'Z').getTime();
  return asIfUtc + offsetHours * 60 * 60 * 1000;
}

// Intl-based fallback: epoch ms -> { dateKey: "M/D/YYYY", mins }.
export function etMinutesOfDay(ms) {
  const et = new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false });
  const parts = et.split(', ');
  const hhmm = parts[1].split(':');
  return { dateKey: parts[0], mins: Number(hhmm[0]) * 60 + Number(hhmm[1]) };
}

// "8/31/2026" -> "2026-08-31"
export function normalizeDateKey(dateKey) {
  const [mo, da, yr] = dateKey.split('/');
  return yr + '-' + mo.padStart(2, '0') + '-' + da.padStart(2, '0');
}

// Preferred accessor: uses the fields precomputed at ingest when present,
// otherwise falls back to the Intl path. Returns an ISO date key ("2026-08-31").
export function etFields(bar) {
  if (bar.d !== undefined && bar.m !== undefined) return { dateKey: bar.d, mins: bar.m };
  const em = etMinutesOfDay(bar.t);
  return { dateKey: normalizeDateKey(em.dateKey), mins: em.mins };
}

export function isRegularSession(barOrMs) {
  const mins = typeof barOrMs === 'number'
    ? etMinutesOfDay(barOrMs).mins
    : etFields(barOrMs).mins;
  return mins >= SESSION_OPEN_MINS && mins < SESSION_CLOSE_MINS;
}

// Most recent weekday, in ET, as "YYYY-MM-DD".
export function getSessionDate() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  if (day === 0) et.setDate(et.getDate() - 2);
  if (day === 6) et.setDate(et.getDate() - 1);
  return et.getFullYear() + '-' +
    String(et.getMonth() + 1).padStart(2, '0') + '-' +
    String(et.getDate()).padStart(2, '0');
}

// "YYYY-MM-DD" for an epoch ms, in ET.
export function isoDateKey(ms) {
  return normalizeDateKey(etMinutesOfDay(ms).dateKey);
}

export function shiftIsoDate(isoDate, days) {
  const d = new Date(isoDate + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatEtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York',
  });
}

// "09:35" from minutes-of-day.
export function minsToHHMM(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}
