// HTTP API and static front end.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  toggleClock, payReport, payCsv, hourWarnings, coverCandidates, openClock, clockableShift,
  distanceM, httpError,
} from "./rota.js";
import { rankCovers } from "./ai.js";
import { overlaps } from "./time.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTO_ASK = 3; // how many top picks are asked automatically when someone drops a shift

export function createApp({ store, now = () => new Date(), env = process.env, fetchImpl = fetch } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "50kb" }));
  app.use(express.static(path.join(ROOT, "public")));
  app.use("/vendor/fullcalendar", express.static(path.join(ROOT, "node_modules", "fullcalendar")));

  // Demo "login": the client sends who it is acting as. Not real auth (see README).
  app.use("/api", (req, _res, next) => {
    const who = req.get("x-user") ?? "manager";
    req.user = who === "manager" ? { id: "manager", manager: true } : store.staff(who);
    if (!req.user) return next(httpError(401, "Pick who you are first."));
    next();
  });
  const managerOnly = (req) => {
    if (!req.user.manager) throw httpError(403, "Only the manager can do that.");
  };

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.get("/api/state", (req, res) => {
    const { db } = store;
    const t = now();
    const me = req.user.manager ? null : req.user.id;
    res.json({
      now: t.toISOString(),
      aiEnabled: Boolean(env.OPENAI_API_KEY),
      user: req.user.manager ? { id: "manager", name: "Sam (manager)", manager: true } : req.user,
      site: db.site,
      staff: db.staff,
      shifts: db.shifts,
      timeOff: req.user.manager ? db.timeOff : db.timeOff.filter((x) => x.staffId === me),
      warnings: hourWarnings(db, t),
      warningsNextWeek: hourWarnings(db, new Date(+t + 7 * 864e5)),
      log: req.user.manager ? db.log.slice(0, 15) : [],
      clock: me
        ? { open: openClock(db, me), shift: clockableShift(db, me, t) }
        : { open: db.clock.filter((c) => !c.out) },
      coverAsks: me
        ? db.shifts.filter((s) => s.status === "needs_cover" && s.cover?.asked?.includes(me))
        : [],
    });
  });

  // ---- Shifts (manager) ----
  app.post("/api/shifts", (req, res) => {
    managerOnly(req);
    const shift = validShift(req.body);
    shift.id = store.newId("sh");
    store.db.shifts.push(shift);
    store.log("rota", `Added ${shift.role} shift.`);
    store.save();
    res.status(201).json(shift);
  });

  app.patch("/api/shifts/:id", (req, res) => {
    managerOnly(req);
    const shift = getShift(req.params.id);
    const next = validShift({ ...shift, ...req.body });
    Object.assign(shift, next);
    store.save();
    res.json(shift);
  });

  app.delete("/api/shifts/:id", (req, res) => {
    managerOnly(req);
    getShift(req.params.id);
    store.db.shifts = store.db.shifts.filter((s) => s.id !== req.params.id);
    store.save();
    res.status(204).end();
  });

  // ---- Clock in/out by proximity ----
  app.post("/api/clock", (req, res) => {
    if (req.user.manager) throw httpError(400, "Switch to a staff member to clock in.");
    const result = toggleClock(store, req.user.id, req.body, now());
    res.json(result);
  });

  app.post("/api/distance", (req, res) => {
    const { lat, lng } = req.body ?? {};
    if (!isFinite(lat) || !isFinite(lng)) throw httpError(400, "lat and lng are required.");
    const d = distanceM(store.db.site, { lat, lng });
    res.json({ distanceM: d, onSite: d <= store.db.site.radiusM });
  });

  // ---- Pay ----
  app.get("/api/pay", (req, res) => {
    const period = req.query.period === "month" ? "month" : "week";
    const date = req.query.date ? new Date(req.query.date) : now();
    if (isNaN(date)) throw httpError(400, "Bad date.");
    const report = payReport(store.db, {
      period, date, now: now(), staffId: req.user.manager ? undefined : req.user.id,
    });
    if (req.query.format === "csv") {
      managerOnly(req);
      res.type("text/csv").attachment(`pay-${period}-${report.from.slice(0, 10)}.csv`).send(payCsv(report));
      return;
    }
    res.json(report);
  });

  // ---- Cover requests ----
  app.get("/api/shifts/:id/candidates", (req, res) => {
    managerOnly(req);
    res.json(coverCandidates(store.db, getShift(req.params.id)));
  });

  app.post("/api/shifts/:id/cover", wrap(async (req, res) => {
    const shift = getShift(req.params.id);
    if (!req.user.manager && shift.staffId !== req.user.id) throw httpError(403, "That isn't your shift.");
    if (new Date(shift.end) < now()) throw httpError(409, "That shift is already over.");
    if (openClock(store.db, shift.staffId)?.shiftId === shift.id) {
      throw httpError(409, "You're clocked in to that shift already.");
    }
    if (!req.user.manager && new Date(shift.start) <= now()) {
      throw httpError(409, "That shift has already started. Talk to your manager.");
    }
    if (shift.status === "needs_cover") throw httpError(409, "Cover has already been requested.");
    const cover = await requestCover(shift, String(req.body?.reason ?? "").slice(0, 200));
    res.json({ shift, cover });
  }));

  app.post("/api/shifts/:id/cover/ask", (req, res) => {
    managerOnly(req);
    const shift = getShift(req.params.id);
    if (shift.status !== "needs_cover") throw httpError(409, "This shift doesn't need cover.");
    const staffId = req.body?.staffId;
    const cand = coverCandidates(store.db, shift).find((c) => c.staffId === staffId);
    if (!cand?.eligible) throw httpError(409, "They can't take this shift.");
    if (!shift.cover.asked.includes(staffId)) shift.cover.asked.push(staffId);
    store.log("cover", `Asked ${cand.name} to cover ${shift.role}.`);
    store.save();
    res.json(shift);
  });

  app.post("/api/shifts/:id/cover/respond", (req, res) => {
    const shift = getShift(req.params.id);
    const me = req.user.manager ? req.body?.staffId : req.user.id;
    if (shift.status !== "needs_cover") throw httpError(409, "Someone has already covered this shift.");
    if (!shift.cover.asked.includes(me)) throw httpError(403, "You weren't asked to cover this.");
    const person = store.staff(me);
    if (req.body?.accept) {
      const cand = coverCandidates(store.db, shift).find((c) => c.staffId === me);
      if (!cand?.eligible) throw httpError(409, `You can't take it any more: ${cand?.exclusions.join(", ")}.`);
      shift.cover.originalStaffId = shift.cover.requestedBy ?? shift.staffId;
      shift.cover.coveredBy = me;
      shift.cover.coveredAt = now().toISOString();
      shift.staffId = me;
      shift.status = "covered";
      store.log("cover", `${person.name} is covering ${shift.role} on ${new Date(shift.start).toDateString()}.`);
    } else {
      shift.cover.declined.push(me);
      shift.cover.asked = shift.cover.asked.filter((x) => x !== me);
      store.log("cover", `${person.name} can't cover ${shift.role}.`);
    }
    store.save();
    res.json(shift);
  });

  app.post("/api/shifts/:id/cover/cancel", (req, res) => {
    const shift = getShift(req.params.id);
    if (!req.user.manager && shift.cover?.requestedBy !== req.user.id) throw httpError(403, "Not yours to cancel.");
    if (shift.status !== "needs_cover") throw httpError(409, "Nothing to cancel.");
    shift.staffId = shift.cover.requestedBy ?? shift.staffId;
    shift.status = "assigned";
    shift.cover = null;
    store.save();
    res.json(shift);
  });

  // ---- Time off ----
  app.post("/api/timeoff", wrap(async (req, res) => {
    const staffId = req.user.manager ? req.body?.staffId : req.user.id;
    if (!store.staff(staffId)) throw httpError(400, "Unknown staff member.");
    const start = new Date(req.body?.start);
    const end = new Date(req.body?.end);
    if (isNaN(start) || isNaN(end) || end <= start) throw httpError(400, "Pick a valid start and end.");
    const t = {
      id: store.newId("t"), staffId, start: start.toISOString(), end: end.toISOString(),
      reason: String(req.body?.reason ?? "").slice(0, 200), status: "pending",
    };
    store.db.timeOff.push(t);
    store.log("timeoff", `${store.staff(staffId).name} asked for time off.`);
    store.save();
    res.status(201).json(t);
  }));

  app.patch("/api/timeoff/:id", wrap(async (req, res) => {
    managerOnly(req);
    const t = store.db.timeOff.find((x) => x.id === req.params.id);
    if (!t) throw httpError(404, "No such request.");
    const status = req.body?.status;
    if (!["approved", "declined"].includes(status)) throw httpError(400, "Status must be approved or declined.");
    t.status = status;
    const affected = [];
    if (status === "approved") {
      // Approving time off automatically opens cover requests for any clashing shifts.
      for (const s of store.db.shifts) {
        if (s.staffId === t.staffId && s.status === "assigned" && overlaps(s.start, s.end, t.start, t.end) && new Date(s.end) > now()) {
          await requestCover(s, "Approved time off");
          affected.push(s.id);
        }
      }
    }
    store.log("timeoff", `Time off for ${store.staff(t.staffId).name} ${status}.`);
    store.save();
    res.json({ timeOff: t, coverOpenedFor: affected });
  }));

  app.post("/api/reset", (req, res) => {
    managerOnly(req);
    store.reset();
    res.json({ ok: true });
  });

  app.use("/api", (_req, _res, next) => next(httpError(404, "Not found.")));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? (err.type === "entity.parse.failed" ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Something went wrong." : err.message, distanceM: err.distanceM });
  });

  async function requestCover(shift, reason) {
    const requester = store.staff(shift.staffId);
    shift.status = "needs_cover";
    shift.cover = {
      requestedBy: shift.staffId, reason, requestedAt: now().toISOString(),
      asked: [], declined: [], ranking: [], source: "rules", message: "",
    };
    const candidates = coverCandidates(store.db, shift);
    const ai = await rankCovers({ shift, candidates, requesterName: requester?.name, reason, env, fetchImpl });
    shift.cover.ranking = ai.ranked;
    shift.cover.source = ai.source;
    shift.cover.message = ai.message;
    if (ai.note) shift.cover.note = ai.note;
    shift.cover.asked = ai.ranked.slice(0, AUTO_ASK).map((r) => r.staffId);
    store.log("cover", `${requester?.name ?? "Someone"} can't make ${shift.role}. Asked ${shift.cover.asked.length} people (${ai.source === "ai" ? "AI-ranked" : "rule-ranked"}).`);
    store.save();
    return shift.cover;
  }

  function getShift(id) {
    const s = store.shift(id);
    if (!s) throw httpError(404, "No such shift.");
    return s;
  }

  function validShift(b) {
    const start = new Date(b?.start);
    const end = new Date(b?.end);
    if (isNaN(start) || isNaN(end) || end <= start) throw httpError(400, "Shift needs a valid start and end.");
    if ((end - start) / 36e5 > 16) throw httpError(400, "Shifts can't be longer than 16 hours.");
    if (b.staffId != null && !store.staff(b.staffId)) throw httpError(400, "Unknown staff member.");
    const skills = Array.isArray(b.skillsNeeded) ? b.skillsNeeded.map(String).slice(0, 10) : [];
    return {
      id: b.id,
      staffId: b.staffId ?? null,
      role: String(b.role ?? "Shift").slice(0, 60),
      skillsNeeded: skills,
      start: start.toISOString(),
      end: end.toISOString(),
      status: b.staffId ? (b.status === "needs_cover" || b.status === "covered" ? b.status : "assigned") : "open",
      cover: b.cover ?? null,
    };
  }

  return app;
}
