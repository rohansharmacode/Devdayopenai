// Core rules: proximity clock-in, pay, hour warnings and cover candidates.
import {
  periodRange, startOfWeek, endOfWeek, overlaps, hoursBetween, hoursInRange,
  fitsAvailability, round2, HOUR,
} from "./time.js";

export const WORKING_TIME_LIMIT = 48; // UK Working Time Regulations weekly average limit (opt-out possible).
const CLOCK_IN_EARLY_MIN = 30; // can clock in up to 30 min before a shift starts

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const R = 6371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function openClock(db, staffId) {
  return db.clock.find((c) => c.staffId === staffId && !c.out) ?? null;
}

/** The shift a person can clock into right now, if any. */
export function clockableShift(db, staffId, now = new Date()) {
  return (
    db.shifts.find(
      (s) =>
        s.staffId === staffId &&
        new Date(s.start) - CLOCK_IN_EARLY_MIN * 60_000 <= now &&
        now < new Date(s.end),
    ) ?? null
  );
}

/**
 * Proximity clock-in/out. Returns { action, entry, distanceM } or throws with a friendly message.
 * Clocking in needs you on site and a shift starting soon. Clocking out works anywhere
 * (people forget), but we record the distance.
 */
export function toggleClock(store, staffId, position, now = new Date()) {
  const { db } = store;
  const person = store.staff(staffId);
  if (!person) throw httpError(404, "Unknown staff member.");
  if (!isFinite(position?.lat) || !isFinite(position?.lng)) {
    throw httpError(400, "We need your location to clock in.");
  }
  const dist = distanceM(db.site, position);
  const current = openClock(db, staffId);
  if (current) {
    current.out = now.toISOString();
    current.outDistanceM = dist;
    store.log("clock", `${person.name} clocked out (${round2(hoursBetween(current.in, current.out))}h).`);
    store.save();
    return { action: "out", entry: current, distanceM: dist };
  }
  if (dist > db.site.radiusM) {
    throw httpError(
      403,
      `You're ${dist}m from ${db.site.name}. Get within ${db.site.radiusM}m to clock in.`,
      { distanceM: dist },
    );
  }
  const shift = clockableShift(db, staffId, now);
  if (!shift) {
    throw httpError(409, "You don't have a shift starting in the next 30 minutes.", { distanceM: dist });
  }
  const entry = {
    id: store.newId("c"), staffId, shiftId: shift.id,
    in: now.toISOString(), out: null, distanceM: dist,
    lateMin: Math.max(0, Math.round((now - new Date(shift.start)) / 60_000)),
  };
  db.clock.push(entry);
  store.log("clock", `${person.name} clocked in ${dist}m from site${entry.lateMin > 5 ? `, ${entry.lateMin} min late` : ""}.`);
  store.save();
  return { action: "in", entry, distanceM: dist };
}

/** Pay summary for every staff member (or one) over a week or month. */
export function payReport(db, { period = "week", date = new Date(), now = new Date(), staffId } = {}) {
  const [from, to] = periodRange(period, date);
  const people = staffId ? db.staff.filter((s) => s.id === staffId) : db.staff;
  const rows = people.map((p) => {
    const worked = db.clock
      .filter((c) => c.staffId === p.id)
      .reduce((h, c) => h + hoursInRange(c.in, c.out ?? now.toISOString(), from, to), 0);
    const scheduled = db.shifts
      .filter((s) => s.staffId === p.id)
      .reduce((h, s) => h + hoursInRange(s.start, s.end, from, to), 0);
    const tips = (db.reviews ?? [])
      .filter((r) => r.staffId === p.id && new Date(r.at) >= from && new Date(r.at) < to)
      .reduce((t, r) => t + (r.tip ?? 0), 0);
    return {
      staffId: p.id,
      name: p.name,
      tips: round2(tips),
      hourlyRate: p.hourlyRate,
      workedHours: round2(worked),
      scheduledHours: round2(scheduled),
      earned: round2(worked * p.hourlyRate),
      projected: round2(Math.max(worked, scheduled) * p.hourlyRate),
      clockedIn: Boolean(openClock(db, p.id)),
    };
  });
  const totals = rows.reduce(
    (t, r) => ({
      workedHours: round2(t.workedHours + r.workedHours),
      earned: round2(t.earned + r.earned),
      projected: round2(t.projected + r.projected),
      tips: round2(t.tips + r.tips),
    }),
    { workedHours: 0, earned: 0, projected: 0, tips: 0 },
  );
  return { period, from: from.toISOString(), to: to.toISOString(), rows, totals };
}

export function payCsv(report) {
  const head = "Name,Hourly rate (GBP),Scheduled hours,Worked hours,Earned (GBP),Tips (GBP),Projected (GBP)";
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
  const lines = report.rows.map((r) =>
    [r.name, r.hourlyRate.toFixed(2), r.scheduledHours, r.workedHours, r.earned.toFixed(2), r.tips.toFixed(2), r.projected.toFixed(2)]
      .map(esc)
      .join(","),
  );
  return [head, ...lines].join("\n") + "\n";
}

export function scheduledHoursInWeek(db, staffId, date, { excludeShiftId } = {}) {
  const from = startOfWeek(date);
  const to = endOfWeek(date);
  return db.shifts
    .filter((s) => s.staffId === staffId && s.id !== excludeShiftId)
    .reduce((h, s) => h + hoursInRange(s.start, s.end, from, to), 0);
}

/** Over-hours warnings for the week containing `date`. */
export function hourWarnings(db, date = new Date()) {
  const out = [];
  for (const p of db.staff) {
    const h = round2(scheduledHoursInWeek(db, p.id, date));
    if (h > WORKING_TIME_LIMIT) {
      out.push({ staffId: p.id, name: p.name, hours: h, level: "danger",
        text: `${p.name} is rota'd for ${h}h this week, over the 48h Working Time limit unless they've opted out.` });
    } else if (h > p.maxHours) {
      out.push({ staffId: p.id, name: p.name, hours: h, level: "warn",
        text: `${p.name} is rota'd for ${h}h, more than the ${p.maxHours}h they asked for.` });
    }
  }
  return out;
}

function onTimeOff(db, staffId, start, end) {
  return db.timeOff.some(
    (t) => t.staffId === staffId && t.status !== "declined" && overlaps(t.start, t.end, start, end),
  );
}

/**
 * Everyone who could cover a shift, with the facts and a rule-based score.
 * Hard rules exclude people (clash, time off, would break 48h); soft rules affect the score.
 */
export function coverCandidates(db, shift) {
  const len = hoursBetween(shift.start, shift.end);
  const results = [];
  for (const p of db.staff) {
    if (p.id === shift.staffId || p.id === shift.cover?.requestedBy) continue;
    const exclusions = [];
    const clash = db.shifts.find(
      (s) => s.staffId === p.id && s.id !== shift.id && overlaps(s.start, s.end, shift.start, shift.end),
    );
    if (clash) exclusions.push(`already working ${fmtTime(clash.start)}–${fmtTime(clash.end)}`);
    if (onTimeOff(db, p.id, shift.start, shift.end)) exclusions.push("on time off");
    const weekHours = scheduledHoursInWeek(db, p.id, shift.start);
    if (weekHours + len > WORKING_TIME_LIMIT) exclusions.push(`would go over 48h (${round2(weekHours + len)}h)`);
    const declined = shift.cover?.declined?.includes(p.id);
    if (declined) exclusions.push("already said no");

    const needed = shift.skillsNeeded ?? [];
    const matched = needed.filter((s) => p.skills.includes(s));
    const missing = needed.filter((s) => !p.skills.includes(s));
    const available = fitsAvailability(p.availability, shift.start, shift.end);
    const headroom = p.maxHours - weekHours;

    let score = 0;
    score += needed.length ? (matched.length / needed.length) * 60 : 30;
    score += available ? 25 : 0;
    score += headroom >= len ? 15 : headroom > 0 ? 5 : -10;
    results.push({
      staffId: p.id,
      name: p.name,
      role: p.role,
      matchedSkills: matched,
      missingSkills: missing,
      availableUsually: available,
      hoursThisWeek: round2(weekHours),
      maxHours: p.maxHours,
      hourlyRate: p.hourlyRate,
      eligible: exclusions.length === 0,
      exclusions,
      score: Math.round(score),
    });
  }
  return results.sort((a, b) => b.eligible - a.eligible || b.score - a.score);
}

export function ruleReason(c) {
  const bits = [];
  if (c.matchedSkills.length) bits.push(`has ${c.matchedSkills.join(", ")}`);
  if (c.missingSkills.length) bits.push(`missing ${c.missingSkills.join(", ")}`);
  bits.push(c.availableUsually ? "usually free then" : "not usually available then");
  bits.push(`${c.hoursThisWeek}/${c.maxHours}h this week`);
  const s = bits.join("; ");
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

function fmtTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

export { HOUR };
