import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import {
  distanceM, toggleClock, payReport, payCsv, hourWarnings, coverCandidates,
} from "../src/rota.js";
import { fitsAvailability, startOfWeek } from "../src/time.js";

// Wednesday 4 Nov 2026, 10:00 local time.
const NOW = new Date(2026, 10, 4, 10, 0, 0);
const fresh = () => createStore(null, { now: () => NOW });

test("distance: same point is 0m and ~111m per 0.001 deg latitude", () => {
  const a = { lat: 51.5, lng: -0.1 };
  assert.equal(distanceM(a, a), 0);
  const d = distanceM(a, { lat: 51.501, lng: -0.1 });
  assert.ok(d > 105 && d < 117, `got ${d}`);
});

test("weeks start on Monday", () => {
  const mon = startOfWeek(NOW);
  assert.equal(mon.getDay(), 1);
  assert.equal(mon.getDate(), 2);
});

test("availability windows", () => {
  const av = { wed: [["09:00", "17:00"]] };
  assert.equal(fitsAvailability(av, new Date(2026, 10, 4, 9), new Date(2026, 10, 4, 17)), true);
  assert.equal(fitsAvailability(av, new Date(2026, 10, 4, 8), new Date(2026, 10, 4, 12)), false);
  assert.equal(fitsAvailability(av, new Date(2026, 10, 5, 9), new Date(2026, 10, 5, 12)), false);
});

test("clock-in is refused when too far from site", () => {
  const store = fresh();
  const far = { lat: store.db.site.lat + 0.01, lng: store.db.site.lng };
  assert.throws(() => toggleClock(store, "s2", far, NOW), (e) => e.status === 403 && /Get within/.test(e.message));
});

test("clock-in on site during a shift, then clock-out records hours", () => {
  const store = fresh();
  const here = { lat: store.db.site.lat, lng: store.db.site.lng };
  // Tom has the demo shift starting within 15 minutes of NOW (seeded relative to now).
  const r = toggleClock(store, "s2", here, NOW);
  assert.equal(r.action, "in");
  assert.ok(r.distanceM <= store.db.site.radiusM);
  const later = new Date(+NOW + 2 * 3600_000);
  const out = toggleClock(store, "s2", here, later);
  assert.equal(out.action, "out");
  const pay = payReport(store.db, { period: "week", date: NOW, now: later, staffId: "s2" });
  assert.ok(pay.rows[0].workedHours >= 2);
});

test("clock-in is refused with no shift soon", () => {
  const store = fresh();
  const here = { lat: store.db.site.lat, lng: store.db.site.lng };
  // Aisha only works Wed-Sun from 12:00; at 10:00 her shift is 2h away.
  assert.throws(() => toggleClock(store, "s5", here, NOW), (e) => e.status === 409);
});

test("pay = worked hours x hourly rate, and CSV has a row per person", () => {
  const store = fresh();
  const rep = payReport(store.db, { period: "week", date: NOW, now: NOW });
  for (const r of rep.rows) {
    assert.ok(Math.abs(r.earned - r.workedHours * r.hourlyRate) < 0.1, `${r.name}: ${r.earned}`);
  }
  const csv = payCsv(rep).trim().split("\n");
  assert.equal(csv.length, store.db.staff.length + 1);
  assert.match(csv[0], /^Name,/);
});

test("monthly pay covers more hours than weekly", () => {
  const store = fresh();
  const later = new Date(2026, 10, 9, 10); // week two
  const wk = payReport(store.db, { period: "week", date: later, now: later });
  const mo = payReport(store.db, { period: "month", date: later, now: later });
  assert.ok(mo.totals.workedHours >= wk.totals.workedHours);
});

test("48h Working Time warning fires for the supervisor", () => {
  const store = fresh();
  const w = hourWarnings(store.db, NOW);
  const mei = w.find((x) => x.staffId === "s3");
  assert.equal(mei?.level, "danger");
});

test("cover candidates exclude clashes and the requester, and rank skills first", () => {
  const store = fresh();
  // Tom's Thursday opening shift (07:00-15:00).
  const shift = store.db.shifts.find(
    (s) => s.staffId === "s2" && new Date(s.start).getDay() === 4 && new Date(s.start) > NOW,
  );
  assert.ok(shift, "Tom has a Thursday shift");
  const c = coverCandidates(store.db, shift);
  assert.ok(!c.some((x) => x.staffId === "s2"), "requester excluded");
  const jack = c.find((x) => x.staffId === "s4");
  assert.equal(jack.eligible, false, "Jack is in the kitchen then");
  const top = c.find((x) => x.eligible);
  assert.ok(top.matchedSkills.includes("barista"));
  // Eligible people always rank above ineligible ones.
  const firstIneligible = c.findIndex((x) => !x.eligible);
  assert.ok(c.slice(firstIneligible).every((x) => !x.eligible));
});
