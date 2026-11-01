// Small date helpers. All shift times are stored as ISO strings.

export const HOUR = 3600_000;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function startOfWeek(date = new Date()) {
  // Weeks run Monday to Sunday (UK convention).
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

export function endOfWeek(date = new Date()) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 7);
  return d;
}

export function startOfMonth(date = new Date()) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(date = new Date()) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export function periodRange(period, date = new Date()) {
  if (period === "month") return [startOfMonth(date), endOfMonth(date)];
  return [startOfWeek(date), endOfWeek(date)];
}

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

export function hoursBetween(start, end) {
  return Math.max(0, (new Date(end) - new Date(start)) / HOUR);
}

/** Hours of [start, end) that fall inside [rangeStart, rangeEnd). */
export function hoursInRange(start, end, rangeStart, rangeEnd) {
  const s = Math.max(+new Date(start), +new Date(rangeStart));
  const e = Math.min(+new Date(end), +new Date(rangeEnd));
  return Math.max(0, (e - s) / HOUR);
}

export function dayKey(date) {
  return DAY_KEYS[new Date(date).getDay()];
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * True if the shift fits inside one of the person's weekly availability windows.
 * availability looks like { mon: [["09:00","17:00"]], ... }; a missing day means unavailable.
 * Shifts that cross midnight are checked against the start day only (good enough for an MVP).
 */
export function fitsAvailability(availability, start, end) {
  const windows = availability?.[dayKey(start)] ?? [];
  const s = new Date(start);
  const e = new Date(end);
  const sMin = s.getHours() * 60 + s.getMinutes();
  let eMin = e.getHours() * 60 + e.getMinutes();
  if (e.toDateString() !== s.toDateString()) eMin = 24 * 60;
  return windows.some(([from, to]) => toMinutes(from) <= sMin && eMin <= toMinutes(to));
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
