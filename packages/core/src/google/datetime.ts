// Strict RFC3339 date-time validation shared by every surface that feeds
// Calendar `dateTime`/`timeMin` values (agent tool args, remote-host command
// params). Calendar rejects date-only / offset-less values with an opaque
// 400, so callers validate here and return an actionable message instead.

// Fractional seconds are normalized away first — an optional `(\.\d+)?`
// group inside the main pattern trips security/detect-unsafe-regex.
const ISO_DATE_TIME_WITH_OFFSET_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|[+-](\d{2}):(\d{2}))$/;
const FRACTIONAL_SECONDS_RE = /\.\d+(?=Z|[+-])/;

const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_SECOND = 59;

// JS Date normalizes overflowed components (2026-02-31 parses as
// 2026-03-03), so `new Date(value)` alone cannot reject impossible dates —
// a UTC round-trip of the raw components can.
const isRealCalendarDate = (year: number, month: number, day: number): boolean => {
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day;
};

export const isIsoDateTimeWithOffset = (value: string): boolean => {
  const match = ISO_DATE_TIME_WITH_OFFSET_RE.exec(value.replace(FRACTIONAL_SECONDS_RE, ""));
  if (!match) return false;
  const [year = 0, month = 0, day = 0, hour = 0, minute = 0, second = 0] = match.slice(1, 7).map(Number);
  const timeInRange = hour <= MAX_HOUR && minute <= MAX_MINUTE && second <= MAX_SECOND;
  // RFC3339 bounds the offset to 00-23:59; groups 7/8 are undefined for "Z".
  const offsetInRange = match[7] === undefined || (Number(match[7]) <= MAX_HOUR && Number(match[8]) <= MAX_MINUTE);
  return isRealCalendarDate(year, month, day) && timeInRange && offsetInRange;
};
