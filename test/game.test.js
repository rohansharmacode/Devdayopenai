import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { createApp } from "../src/app.js";
import { levelFor, stageFor, totalXp, leaderboard, profile, XP } from "../src/game.js";

const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wed 4 Nov 2026, 10:00

async function withServer(fn) {
  const store = createStore(null, { now: () => NOW });
  const app = createApp({ store, now: () => NOW, env: {} });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { as = "manager", method = "GET", body } = {}) => {
    const headers = { "content-type": "application/json" };
    if (as) headers["x-user"] = as;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    await fn({ store, call });
  } finally {
    server.close();
  }
}

test("levels: thresholds and pet stages", () => {
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(99).level, 1);
  assert.equal(levelFor(100).level, 2);
  assert.equal(levelFor(600).level, 4);
  assert.deepEqual([1, 2, 4, 7].map((l) => stageFor(l).stage), ["egg", "baby", "kid", "hero"]);
  const p = levelFor(650);
  assert.equal(p.into, 50);
  assert.equal(p.needed, 400);
});

test("seeded team has pets at different stages and a populated league", () => {
  const store = createStore(null, { now: () => NOW });
  const lb = leaderboard(store.db, NOW);
  assert.equal(lb.length, 6);
  assert.ok(lb.every((r, i) => i === 0 || lb[i - 1].weekXp >= r.weekXp), "sorted by weekly XP");
  assert.ok(new Set(lb.map((r) => r.stage.stage)).size >= 3);
  assert.ok(lb.every((r) => r.pet.name && r.pet.species));
});

test("on-time proximity clock-in earns XP, clock-out earns more", async () => {
  await withServer(async ({ store, call }) => {
    const before = totalXp(store.db, "s3");
    const site = store.db.site;
    // Give Aisha a shift starting in 10 minutes so she can clock in on time.
    const start = new Date(+NOW + 10 * 60_000);
    store.db.shifts.push({ id: "shT", staffId: "s5", role: "Barista", skillsNeeded: [], start: start.toISOString(), end: new Date(+start + 3 * 3600e3).toISOString(), status: "assigned", cover: null });
    const a0 = totalXp(store.db, "s5");
    const r = await call("/api/clock", { as: "s5", method: "POST", body: { lat: site.lat, lng: site.lng } });
    assert.equal(r.status, 200);
    assert.equal(r.data.action, "in");
    assert.ok(r.data.awards.some((x) => x.kind === "on_time" && x.points === XP.onTime));
    const out = await call("/api/clock", { as: "s5", method: "POST", body: { lat: site.lat, lng: site.lng } });
    assert.equal(out.data.action, "out");
    assert.equal(totalXp(store.db, "s5"), a0 + XP.onTime + XP.shiftDone);
    assert.equal(totalXp(store.db, "s3"), before, "others unaffected");
  });
});

test("covering a shift earns hero XP (plus last-minute bonus) and can level a pet up", async () => {
  await withServer(async ({ store, call }) => {
    // Tom's Thursday 07:00 shift starts 21 hours after NOW, so the last-minute bonus applies.
    const shift = store.db.shifts.find((s) => s.staffId === "s2" && new Date(s.start).getDay() === 4 && new Date(s.start) > NOW);
    const drop = await call(`/api/shifts/${shift.id}/cover`, { as: "s2", method: "POST", body: { reason: "Exam" } });
    const taker = drop.data.cover.asked[0];
    const xp0 = totalXp(store.db, taker);
    const ok = await call(`/api/shifts/${shift.id}/cover/respond`, { as: taker, method: "POST", body: { accept: true } });
    assert.equal(ok.status, 200);
    const gained = totalXp(store.db, taker) - xp0;
    assert.equal(gained, XP.cover + XP.lastMinuteCover);
    const p = profile(store.db, taker, NOW);
    assert.ok(p.badges.find((b) => b.id === "hero").earned);
  });
});

test("customer review page: public, validated, gives XP and tips show in pay", async () => {
  await withServer(async ({ store, call }) => {
    const team = await call("/api/public/team", { as: null });
    assert.equal(team.status, 200);
    assert.ok(team.data.team.every((m) => !("hourlyRate" in m) && !("name" in m)), "no private fields exposed");
    const bad = await call("/api/public/reviews", { as: null, method: "POST", body: { staffId: "s4", stars: 9 } });
    assert.equal(bad.status, 400);
    const xp0 = totalXp(store.db, "s4");
    const r = await call("/api/public/reviews", { as: null, method: "POST", body: { staffId: "s4", stars: 5, tip: 5, comment: "Yum" } });
    assert.equal(r.status, 201);
    assert.equal(r.data.xp, XP.review5 + 5 * XP.tipPerPound);
    assert.equal(totalXp(store.db, "s4"), xp0 + r.data.xp);
    const big = await call("/api/public/reviews", { as: null, method: "POST", body: { staffId: "s4", stars: 4, tip: 500 } });
    assert.equal(store.db.reviews.at(-1).tip, 20, "tips are capped");
    assert.equal(big.status, 201);
    const pay = await call("/api/pay", { as: "s4" });
    assert.ok(pay.data.rows[0].tips >= 25);
  });
});
