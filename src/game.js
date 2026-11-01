// Shift+ game layer: XP, levels, streaks, badges, pets and the leaderboard.
// Everything is derived from an append-only XP ledger (db.xp) so it's easy to audit.

export const XP = {
  onTime: 20, // clocked in no more than 5 minutes late
  showedUp: 5, // clocked in, but late
  shiftDone: 10, // clocked out at the end of a shift
  cover: 50, // covered a colleague's shift
  lastMinuteCover: 25, // extra if the shift starts within 24 hours
  review5: 30,
  review4: 15,
  tipPerPound: 2,
  streakBonus: 25, // every 5 on-time arrivals in a row
};

const ON_TIME_GRACE_MIN = 5;

/** Level thresholds grow gently: L2 at 100 XP, L3 at 300, L4 at 600, L5 at 1000... */
export function xpForLevel(level) {
  return 50 * level * (level - 1);
}

export function levelFor(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, into: xp - floor, needed: next - floor, next };
}

export const STAGES = [
  { min: 1, stage: "egg", label: "Egg" },
  { min: 2, stage: "baby", label: "Hatchling" },
  { min: 4, stage: "kid", label: "Buddy" },
  { min: 7, stage: "hero", label: "Legend" },
];

export function stageFor(level) {
  return [...STAGES].reverse().find((s) => level >= s.min);
}

function ledger(db) {
  if (!db.xp) db.xp = [];
  return db.xp;
}

/** Adds an XP entry. Returns { entry, before, after, levelUp }. */
export function award(store, staffId, kind, points, note, at = new Date()) {
  const db = store.db;
  const before = levelFor(totalXp(db, staffId));
  const entry = { id: store.newId("x"), staffId, kind, points, note, at: new Date(at).toISOString() };
  ledger(db).push(entry);
  const after = levelFor(before.xp + points);
  const levelUp = after.level > before.level;
  if (levelUp) {
    const person = db.staff.find((s) => s.id === staffId);
    const stage = stageFor(after.level);
    const grew = stageFor(before.level).stage !== stage.stage;
    store.log("game", `${person?.name}'s ${person?.pet?.name ?? "pet"} reached level ${after.level}${grew ? ` and became a ${stage.label}` : ""}!`);
  }
  return { entry, before, after, levelUp };
}

export function totalXp(db, staffId) {
  return ledger(db).filter((e) => e.staffId === staffId).reduce((t, e) => t + e.points, 0);
}

/** Consecutive on-time arrivals, most recent first. */
export function streak(db, staffId) {
  const arrivals = db.clock
    .filter((c) => c.staffId === staffId)
    .sort((a, b) => new Date(b.in) - new Date(a.in));
  let n = 0;
  for (const c of arrivals) {
    if ((c.lateMin ?? 0) <= ON_TIME_GRACE_MIN) n++;
    else break;
  }
  return n;
}

/** Called after a successful clock-in. */
export function onClockIn(store, staffId, entry, now = new Date()) {
  const awards = [];
  if ((entry.lateMin ?? 0) <= ON_TIME_GRACE_MIN) {
    awards.push(award(store, staffId, "on_time", XP.onTime, "Right on time", now));
    const s = streak(store.db, staffId);
    if (s > 0 && s % 5 === 0) awards.push(award(store, staffId, "streak", XP.streakBonus, `${s} on-time shifts in a row`, now));
  } else {
    awards.push(award(store, staffId, "showed_up", XP.showedUp, `Made it (${entry.lateMin} min late)`, now));
  }
  return awards;
}

export function onClockOut(store, staffId, now = new Date()) {
  return [award(store, staffId, "shift_done", XP.shiftDone, "Shift complete", now)];
}

export function onCover(store, staffId, shift, now = new Date()) {
  const awards = [award(store, staffId, "cover", XP.cover, `Covered ${shift.role}`, now)];
  if (new Date(shift.start) - now < 24 * 3600_000) {
    awards.push(award(store, staffId, "last_minute", XP.lastMinuteCover, "Last-minute hero", now));
  }
  return awards;
}

export function onReview(store, review, now = new Date()) {
  const awards = [];
  if (review.stars === 5) awards.push(award(store, review.staffId, "review", XP.review5, "5-star review", now));
  else if (review.stars === 4) awards.push(award(store, review.staffId, "review", XP.review4, "4-star review", now));
  if (review.tip > 0) {
    awards.push(award(store, review.staffId, "tip", Math.round(review.tip * XP.tipPerPound), `£${review.tip.toFixed(2)} tip`, now));
  }
  return awards;
}

export const BADGES = [
  { id: "early-bird", icon: "sunrise", name: "Early Bird", desc: "5 on-time arrivals",
    test: (s) => s.counts.on_time >= 5 },
  { id: "hero", icon: "shield", name: "Shift Hero", desc: "Covered a colleague",
    test: (s) => s.counts.cover >= 1 },
  { id: "superhero", icon: "cape", name: "Super Hero", desc: "Covered 3 shifts",
    test: (s) => s.counts.cover >= 3 },
  { id: "crowd-fav", icon: "star", name: "Crowd Favourite", desc: "A 5-star review",
    test: (s) => s.fiveStars >= 1 },
  { id: "tip-magnet", icon: "coin", name: "Tip Magnet", desc: "£20 in tips",
    test: (s) => s.tips >= 20 },
  { id: "on-fire", icon: "flame", name: "On Fire", desc: "5-shift on-time streak",
    test: (s) => s.streak >= 5 },
];

function stats(db, staffId) {
  const entries = ledger(db).filter((e) => e.staffId === staffId);
  const counts = {};
  for (const e of entries) counts[e.kind] = (counts[e.kind] ?? 0) + 1;
  const reviews = (db.reviews ?? []).filter((r) => r.staffId === staffId);
  return {
    counts: new Proxy(counts, { get: (o, k) => o[k] ?? 0 }),
    fiveStars: reviews.filter((r) => r.stars === 5).length,
    tips: reviews.reduce((t, r) => t + (r.tip ?? 0), 0),
    streak: streak(db, staffId),
  };
}

export function moodFor(db, staffId, now = new Date()) {
  const last = ledger(db)
    .filter((e) => e.staffId === staffId)
    .reduce((m, e) => Math.max(m, +new Date(e.at)), 0);
  const hours = (now - last) / 3600_000;
  if (hours < 6) return "ecstatic";
  if (hours < 48) return "happy";
  return "sleepy";
}

export function profile(db, staffId, now = new Date()) {
  const person = db.staff.find((s) => s.id === staffId);
  const xp = totalXp(db, staffId);
  const lvl = levelFor(xp);
  const st = stats(db, staffId);
  const weekAgo = +now - 7 * 24 * 3600_000;
  const recent = ledger(db)
    .filter((e) => e.staffId === staffId)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);
  return {
    staffId,
    name: person?.name,
    ...lvl,
    stage: stageFor(lvl.level),
    pet: { ...(person?.pet ?? {}), mood: moodFor(db, staffId, now) },
    streak: st.streak,
    weekXp: ledger(db)
      .filter((e) => e.staffId === staffId && +new Date(e.at) >= weekAgo && +new Date(e.at) <= +now)
      .reduce((t, e) => t + e.points, 0),
    tips: Math.round(st.tips * 100) / 100,
    badges: BADGES.map(({ test, ...b }) => ({ ...b, earned: test(st) })),
    recent,
  };
}

/** Rolling 7-day leaderboard, highest XP first. */
export function leaderboard(db, now = new Date()) {
  return db.staff
    .map((s) => {
      const p = profile(db, s.id, now);
      return {
        staffId: s.id, name: s.name, role: s.role, color: s.color,
        weekXp: p.weekXp, level: p.level, stage: p.stage, pet: p.pet, streak: p.streak,
      };
    })
    .sort((a, b) => b.weekXp - a.weekXp || b.level - a.level || a.name.localeCompare(b.name))
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
