import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/store.js";
import { createApp } from "../src/app.js";
import { rankCovers } from "../src/ai.js";

const NOW = new Date(2026, 10, 4, 10, 0, 0);
let server;
let base;
let store;

// Fake OpenAI endpoint: returns candidates in reverse order so we can tell the AI ran.
const fakeFetch = async (_url, init) => {
  const body = JSON.parse(init.body);
  assert.equal(body.text.format.type, "json_schema");
  const ids = [...body.input.matchAll(/"staffId":"(s\d)"/g)].map((m) => m[1]).reverse();
  const out = { ranked: [...ids, "s999"].map((id) => ({ staffId: id, reason: `AI likes ${id}` })), message: "Hi, can you cover?" };
  return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(out) }] }] }));
};

before(async () => {
  store = createStore(null, { now: () => NOW });
  const app = createApp({ store, now: () => NOW, env: { OPENAI_API_KEY: "test-key" }, fetchImpl: fakeFetch });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (path, { as = "manager", method = "GET", body } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", "x-user": as },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, data };
};

test("state loads for manager and worker", async () => {
  const m = await call("/api/state");
  assert.equal(m.status, 200);
  assert.ok(m.data.shifts.length > 20);
  const w = await call("/api/state", { as: "s2" });
  assert.equal(w.data.user.name, "Tom Okafor");
  assert.ok(w.data.clock.shift, "Tom has a clockable demo shift");
});

test("workers can't edit the rota", async () => {
  const r = await call("/api/shifts", { as: "s2", method: "POST", body: { start: NOW, end: NOW } });
  assert.equal(r.status, 403);
});

test("unknown users are rejected", async () => {
  const r = await call("/api/state", { as: "nobody" });
  assert.equal(r.status, 401);
});

test("full cover journey: drop shift, AI ranks, candidate accepts, calendar updates", async () => {
  const tomShift = store.db.shifts.find(
    (s) => s.staffId === "s2" && new Date(s.start).getDay() === 4 && new Date(s.start) > NOW,
  );
  const drop = await call(`/api/shifts/${tomShift.id}/cover`, { as: "s2", method: "POST", body: { reason: "Exam" } });
  assert.equal(drop.status, 200);
  assert.equal(drop.data.cover.source, "ai");
  assert.ok(!drop.data.cover.ranking.some((r) => r.staffId === "s999"), "unknown ids from the model are dropped");
  const asked = drop.data.cover.asked;
  assert.ok(asked.length >= 1 && asked.length <= 3);

  // Someone who wasn't asked can't grab it.
  const notAsked = store.db.staff.find((s) => !asked.includes(s.id) && s.id !== "s2");
  const sneaky = await call(`/api/shifts/${tomShift.id}/cover/respond`, { as: notAsked.id, method: "POST", body: { accept: true } });
  assert.equal(sneaky.status, 403);

  const taker = asked[0];
  const ok = await call(`/api/shifts/${tomShift.id}/cover/respond`, { as: taker, method: "POST", body: { accept: true } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.staffId, taker);
  assert.equal(ok.data.status, "covered");
  assert.equal(ok.data.cover.originalStaffId, "s2");

  // A second acceptance fails because it's already covered.
  if (asked[1]) {
    const late = await call(`/api/shifts/${tomShift.id}/cover/respond`, { as: asked[1], method: "POST", body: { accept: true } });
    assert.equal(late.status, 409);
  }
});

test("can't drop a shift that has already started", async () => {
  const started = store.db.shifts.find((s) => s.staffId === "s3" && new Date(s.start) <= NOW && new Date(s.end) > NOW);
  assert.ok(started);
  const r = await call(`/api/shifts/${started.id}/cover`, { as: "s3", method: "POST", body: {} });
  assert.equal(r.status, 409);
});

test("approving time off opens cover requests for clashing shifts", async () => {
  const t = store.db.timeOff.find((x) => x.status === "pending");
  const r = await call(`/api/timeoff/${t.id}`, { method: "PATCH", body: { status: "approved" } });
  assert.equal(r.status, 200);
  assert.ok(r.data.coverOpenedFor.length >= 1);
  for (const id of r.data.coverOpenedFor) assert.equal(store.shift(id).status, "needs_cover");
});

test("CSV export is manager only", async () => {
  const w = await call("/api/pay?format=csv", { as: "s1" });
  assert.equal(w.status, 403);
  const res = await fetch(`${base}/api/pay?format=csv&period=month`, { headers: { "x-user": "manager" } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
});

test("AI falls back to rules without a key or on errors", async () => {
  const candidates = [
    { staffId: "a", name: "Ann Lee", eligible: true, matchedSkills: ["barista"], missingSkills: [], availableUsually: true, hoursThisWeek: 8, maxHours: 30, score: 90 },
    { staffId: "b", name: "Bo Kim", eligible: false, matchedSkills: [], missingSkills: [], availableUsually: true, hoursThisWeek: 8, maxHours: 30, score: 10, exclusions: ["x"] },
  ];
  const shift = { role: "Barista", start: NOW.toISOString(), end: new Date(+NOW + 3600e3).toISOString(), skillsNeeded: ["barista"] };
  const noKey = await rankCovers({ shift, candidates, env: {} });
  assert.equal(noKey.source, "rules");
  assert.deepEqual(noKey.ranked.map((r) => r.staffId), ["a"]);
  const broken = await rankCovers({ shift, candidates, env: { OPENAI_API_KEY: "k" }, fetchImpl: async () => new Response("nope", { status: 500 }) });
  assert.equal(broken.source, "rules");
  assert.match(broken.note, /AI unavailable/);
});
