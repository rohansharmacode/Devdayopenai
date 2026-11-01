// RotaBuddy front end. Plain JS, no build step.
const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const gbp = (n) => `£${Number(n).toFixed(2)}`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtRange = (s) => `${fmtDay(s.start)}, ${fmtTime(s.start)}–${fmtTime(s.end)}`;

let who = localStorage.getItem("who") ?? "manager";
let state = null;
let payPeriod = "week";
let calendar = null;
let myCalendar = null;
let position = null; // last known {lat, lng, source}
let distanceInfo = null;
let autoClock = localStorage.getItem("autoClock") !== "off";
let gpsWatch = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "content-type": "application/json", "x-user": who, ...(opts.headers ?? {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Error ${res.status}`), data);
  return data;
}

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `show${err ? " err" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ""), 3200);
}

const staffById = (id) => state.staff.find((s) => s.id === id);
const nameOf = (id) => staffById(id)?.name ?? "Unassigned";
const first = (id) => nameOf(id).split(" ")[0];

// ---------- boot ----------
async function load() {
  state = await api("/api/state");
  $("#siteName").textContent = `${state.site.name} · ${state.aiEnabled ? "AI cover finder on" : "rule-based cover finder"}`;
  renderWho();
  if (state.user.manager) renderManager();
  else renderWorker();
}

function renderWho() {
  const sel = $("#whoSelect");
  if (!sel.options.length) {
    sel.innerHTML =
      `<option value="manager">Sam (manager)</option>` +
      state.staff.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.role)}</option>`).join("");
    sel.addEventListener("change", () => {
      who = sel.value;
      localStorage.setItem("who", who);
      location.reload();
    });
  }
  sel.value = who;
}

// ---------- manager ----------
function shiftEvents(shifts, { mine } = {}) {
  return shifts.map((s) => {
    const p = staffById(s.staffId);
    const needs = s.status === "needs_cover";
    let title = `${p ? p.name.split(" ")[0] : "Open"} · ${s.role}`;
    if (needs) title = `NEEDS COVER · ${s.role} (was ${first(s.cover.requestedBy)})`;
    if (s.status === "covered") title = `${first(s.staffId)} covering ${first(s.cover.originalStaffId)} · ${s.role}`;
    if (mine) title = needs ? `Finding cover · ${s.role}` : s.role;
    return {
      id: s.id, title, start: s.start, end: s.end,
      backgroundColor: needs ? undefined : p?.color ?? "#a8a29e",
      borderColor: needs ? undefined : p?.color ?? "#a8a29e",
      classNames: [needs ? "needs-cover" : "", s.status === "covered" ? "covered" : ""],
    };
  });
}

function timeOffEvents(list) {
  return list
    .filter((t) => t.status !== "declined")
    .map((t) => ({
      id: `to-${t.id}`, title: `${first(t.staffId)} off${t.status === "pending" ? " (pending)" : ""}`,
      start: t.start, end: t.end, allDay: true, display: "block",
      backgroundColor: "#e7e5e4", borderColor: "#d6d3d1", textColor: "#44403c", classNames: ["timeoff"],
    }));
}

function renderManager() {
  $("#managerView").hidden = false;
  if (!calendar) {
    calendar = new FullCalendar.Calendar($("#calendar"), {
      initialView: "timeGridWeek",
      firstDay: 1,
      nowIndicator: true,
      slotMinTime: "06:00:00",
      slotMaxTime: "22:00:00",
      allDaySlot: true,
      height: "auto",
      expandRows: true,
      selectable: true,
      editable: true,
      eventOverlap: true,
      slotEventOverlap: false,
      locale: "en-gb",
      headerToolbar: { left: "prev,next today", center: "title", right: "timeGridWeek,dayGridMonth,listWeek" },
      buttonText: { today: "Today", week: "Week", month: "Month", list: "List" },
      slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      select: (info) => openNewShift(info.start, info.end),
      eventClick: (info) => {
        if (info.event.id.startsWith("to-")) return;
        openShift(info.event.id);
      },
      eventDrop: (info) => moveShift(info),
      eventResize: (info) => moveShift(info),
    });
    calendar.render();
  }
  calendar.removeAllEvents();
  calendar.addEventSource(shiftEvents(state.shifts));
  calendar.addEventSource(timeOffEvents(state.timeOff));
  renderAlerts();
  renderPay();
  renderTimeOff();
  renderActivity();
}

async function moveShift(info) {
  if (info.event.id.startsWith("to-")) return info.revert();
  try {
    await api(`/api/shifts/${info.event.id}`, {
      method: "PATCH", body: { start: info.event.start.toISOString(), end: info.event.end.toISOString() },
    });
    await load();
  } catch (e) {
    info.revert();
    toast(e.message, true);
  }
}

function renderAlerts() {
  const needs = state.shifts.filter((s) => s.status === "needs_cover").sort((a, b) => new Date(a.start) - new Date(b.start));
  const seen = new Set();
  const warnings = [...state.warnings, ...state.warningsNextWeek].filter((w) => {
    const k = w.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const html = [
    ...needs.map(
      (s) => `<div class="alert cover"><span><strong>${esc(first(s.cover.requestedBy))} can't make ${esc(s.role)}</strong> · ${esc(fmtRange(s))}.
        Asked ${s.cover.asked.map((id) => esc(first(id))).join(", ") || "nobody yet"}.</span>
        <button class="btn small" data-open="${esc(s.id)}">Find cover</button></div>`,
    ),
    ...warnings.map((w) => `<div class="alert ${esc(w.level)}"><span>${esc(w.text)}</span></div>`),
  ];
  $("#alerts").innerHTML = html.join("");
  $("#alerts").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openShift(b.dataset.open)));
}

async function renderPay() {
  const report = await api(`/api/pay?period=${payPeriod}`);
  const target = state.user.manager ? $("#payTable") : $("#myPay");
  const label = payPeriod === "month"
    ? new Date(report.from).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : `Week of ${fmtDay(report.from)}`;
  if (state.user.manager) {
    target.innerHTML = `<p class="muted" style="margin:0 0 6px;font-size:12px">${esc(label)}</p>
      <table><thead><tr><th>Name</th><th class="num">Hours</th><th class="num">Earned</th><th class="num">Projected</th></tr></thead>
      <tbody>${report.rows.map((r) => `<tr><td><span class="dot" style="background:${esc(staffById(r.staffId)?.color)}"></span>${esc(r.name.split(" ")[0])}${r.clockedIn ? '<span class="live">ON SHIFT</span>' : ""}</td>
        <td class="num">${r.workedHours}</td><td class="num">${gbp(r.earned)}</td><td class="num">${gbp(r.projected)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${report.totals.workedHours}</td><td class="num">${gbp(report.totals.earned)}</td><td class="num">${gbp(report.totals.projected)}</td></tr></tfoot></table>`;
    $("#csvLink").onclick = async (e) => {
      e.preventDefault();
      const res = await fetch(`/api/pay?period=${payPeriod}&format=csv`, { headers: { "x-user": who } });
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `pay-${payPeriod}-${report.from.slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    };
  } else {
    const r = report.rows[0];
    target.innerHTML = `<p class="muted" style="margin:0 0 6px;font-size:12px">${esc(label)} · ${gbp(r.hourlyRate)}/h</p>
      <div style="display:flex;gap:18px">
        <div><div class="big-num" style="font-size:28px;font-weight:800">${gbp(r.earned)}</div><small>earned so far (${r.workedHours}h)</small></div>
        <div><div style="font-size:20px;font-weight:700;margin-top:6px">${gbp(r.projected)}</div><small>if you work your rota (${r.scheduledHours}h)</small></div>
      </div>`;
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay-toggle] button");
  if (!b) return;
  payPeriod = b.dataset.period;
  document.querySelectorAll("[data-pay-toggle] button").forEach((x) => x.classList.toggle("on", x.dataset.period === payPeriod));
  renderPay();
});

function renderTimeOff() {
  const list = [...state.timeOff].sort((a, b) => new Date(a.start) - new Date(b.start));
  $("#timeOffList").innerHTML = list.length
    ? `<ul class="plain">${list.map((t) => `<li><span><strong>${esc(first(t.staffId))}</strong> ${esc(fmtDay(t.start))} → ${esc(fmtDay(new Date(+new Date(t.end) - 1)))}
        <br><small>${esc(t.reason || "No reason given")}</small></span>
        ${t.status === "pending"
          ? `<span><button class="btn small" data-to="${esc(t.id)}" data-s="approved">Approve</button> <button class="btn ghost small" data-to="${esc(t.id)}" data-s="declined">Decline</button></span>`
          : `<span class="badge ${esc(t.status)}">${esc(t.status)}</span>`}</li>`).join("")}</ul>`
    : `<p class="muted">No requests.</p>`;
  $("#timeOffList").querySelectorAll("[data-to]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api(`/api/timeoff/${b.dataset.to}`, { method: "PATCH", body: { status: b.dataset.s } });
          toast(r.coverOpenedFor.length ? `Approved. Cover requests opened for ${r.coverOpenedFor.length} shift(s).` : `Time off ${b.dataset.s}.`);
          await load();
        } catch (e) {
          toast(e.message, true);
        }
      }),
  );
}

function renderActivity() {
  $("#activity").innerHTML =
    state.log.map((l) => `<li><time>${esc(fmtTime(l.at))}</time>${esc(l.text)}</li>`).join("") || `<li class="muted">Nothing yet today.</li>`;
}

$("#resetBtn").onclick = async () => {
  if (!confirm("Reset all demo data to the starting rota?")) return;
  await api("/api/reset", { method: "POST" });
  location.reload();
};

// ---------- modals ----------
function modal(html) {
  $("#modalBody").innerHTML = html;
  const d = $("#modal");
  if (!d.open) d.showModal();
  d.onclick = (e) => {
    if (e.target === d || e.target.closest("[data-close]")) d.close();
  };
  return $("#modalBody");
}

function staffOptions(selected) {
  return `<option value="">Open (unassigned)</option>` +
    state.staff.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

function openNewShift(start, end) {
  const body = modal(`<h3>New shift</h3><p class="muted">${esc(fmtRange({ start, end }))}</p>
    <form class="form-grid" id="newShift">
      <label>Role <input name="role" value="Barista" required maxlength="60" /></label>
      <label>Who <select name="staffId">${staffOptions("")}</select></label>
      <label class="wide">Skills needed (comma separated) <input name="skills" value="barista" /></label>
      <div class="modal-actions wide"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Add shift</button></div>
    </form>`);
  body.querySelector("#newShift").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/api/shifts", {
        method: "POST",
        body: {
          start: start.toISOString(), end: end.toISOString(), role: f.get("role"),
          staffId: f.get("staffId") || null,
          skillsNeeded: String(f.get("skills")).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
        },
      });
      $("#modal").close();
      calendar.unselect();
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function openShift(id) {
  const s = state.shifts.find((x) => x.id === id);
  if (!s) return;
  const header = `<h3>${esc(s.role)}</h3><p class="muted">${esc(fmtRange(s))} · needs ${esc(s.skillsNeeded.join(", ") || "no specific skills")}</p>`;
  if (s.status === "needs_cover") return openCover(s, header);

  const body = modal(`${header}
    <form class="form-grid" id="editShift">
      <label>Role <input name="role" value="${esc(s.role)}" maxlength="60" /></label>
      <label>Who <select name="staffId">${staffOptions(s.staffId)}</select></label>
      ${s.status === "covered" ? `<p class="wide muted">Covered by ${esc(nameOf(s.cover.coveredBy))} for ${esc(nameOf(s.cover.originalStaffId))}.</p>` : ""}
      <div class="modal-actions wide">
        <button type="button" class="btn danger" id="delShift">Delete</button>
        ${s.staffId && new Date(s.end) > new Date() ? `<button type="button" class="btn ghost" id="findCover">Find cover</button>` : ""}
        <button class="btn">Save</button>
      </div>
    </form>`);
  body.querySelector("#editShift").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api(`/api/shifts/${s.id}`, { method: "PATCH", body: { role: f.get("role"), staffId: f.get("staffId") || null } });
      $("#modal").close();
      await load();
    } catch (err) {
      toast(err.message, true);
    }
  };
  body.querySelector("#delShift").onclick = async () => {
    if (!confirm("Delete this shift?")) return;
    await api(`/api/shifts/${s.id}`, { method: "DELETE" });
    $("#modal").close();
    await load();
  };
  const fc = body.querySelector("#findCover");
  if (fc) fc.onclick = async () => {
    fc.disabled = true;
    fc.textContent = "Ranking…";
    try {
      await api(`/api/shifts/${s.id}/cover`, { method: "POST", body: { reason: "Manager requested cover" } });
      await load();
      openShift(s.id);
    } catch (err) {
      toast(err.message, true);
    }
  };
}

async function openCover(s, header) {
  const cands = await api(`/api/shifts/${s.id}/candidates`);
  const rank = new Map(s.cover.ranking.map((r, i) => [r.staffId, { ...r, i }]));
  const ordered = [...cands].sort((a, b) => (rank.get(a.staffId)?.i ?? 99) - (rank.get(b.staffId)?.i ?? 99) || b.eligible - a.eligible);
  const body = modal(`${header}
    <div class="alert cover"><span><strong>${esc(nameOf(s.cover.requestedBy))}</strong> can't make it${s.cover.reason ? `: “${esc(s.cover.reason)}”` : "."}</span></div>
    <p style="margin:6px 0 0"><span class="badge ${s.cover.source === "ai" ? "ai" : ""}">${s.cover.source === "ai" ? "Ranked by AI" : "Ranked by rules"}</span>
      ${s.cover.note ? `<small> ${esc(s.cover.note)}</small>` : ""}</p>
    <ul class="cands">${ordered.map((c, i) => {
      const r = rank.get(c.staffId);
      const asked = s.cover.asked.includes(c.staffId);
      const declined = s.cover.declined.includes(c.staffId);
      return `<li class="${i === 0 && c.eligible ? "top" : ""} ${c.eligible ? "" : "ineligible"}">
        <div><strong>${esc(c.name)}</strong> <small>${esc(c.role)} · ${c.hoursThisWeek}/${c.maxHours}h · ${gbp(c.hourlyRate)}/h</small>
          <div class="reason">${esc(c.eligible ? r?.reason ?? "" : `Can't: ${c.exclusions.join(", ")}`)}</div></div>
        <div>${declined ? `<span class="badge bad">said no</span>` : asked ? `<span class="badge pending">asked</span>` : c.eligible ? `<button class="btn small" data-ask="${esc(c.staffId)}">Ask</button>` : ""}</div>
      </li>`;
    }).join("")}</ul>
    ${s.cover.message ? `<div class="draft"><strong>Message sent to top picks:</strong>\n${esc(s.cover.message)}</div>` : ""}
    <div class="modal-actions"><button class="btn ghost" id="cancelCover">Cancel request</button><button class="btn" data-close>Done</button></div>`);
  body.querySelectorAll("[data-ask]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api(`/api/shifts/${s.id}/cover/ask`, { method: "POST", body: { staffId: b.dataset.ask } });
          await load();
          openShift(s.id);
        } catch (err) {
          toast(err.message, true);
        }
      }),
  );
  body.querySelector("#cancelCover").onclick = async () => {
    await api(`/api/shifts/${s.id}/cover/cancel`, { method: "POST" });
    $("#modal").close();
    await load();
  };
}

// ---------- worker ----------
function renderWorker() {
  $("#workerView").hidden = false;
  renderClock();
  renderCoverAsks();
  renderPay();
  renderMyShifts();
  renderMyCalendar();
  renderMyTimeOff();
}

const SIMULATED = {
  site: () => ({ lat: state.site.lat + 0.0002, lng: state.site.lng - 0.0001, source: "Simulated: at work" }),
  away: () => ({ lat: state.site.lat + 0.011, lng: state.site.lng - 0.006, source: "Simulated: at home" }),
};

function renderClock() {
  const { open, shift } = state.clock;
  const d = distanceInfo;
  const ringClass = open ? "on" : d ? (d.onSite ? "near" : "far") : "";
  let status;
  if (open) status = `On shift since ${fmtTime(open.in)}`;
  else if (shift) status = `Next: ${esc(shift.role)} at ${fmtTime(shift.start)}`;
  else status = "No shift right now";
  const elapsed = open ? (Date.now() - new Date(open.in)) / 36e5 : 0;
  const rate = staffById(who)?.hourlyRate ?? 0;
  $("#clockCard").innerHTML = `
    <h2>Hi ${esc(state.user.name.split(" ")[0])}</h2>
    <div class="ring ${ringClass}">
      <div>${open ? `<div class="big-num">${gbp(elapsed * rate)}</div><small>this shift</small>`
        : d ? `<div class="big-num">${d.distanceM < 1000 ? `${d.distanceM}m` : `${(d.distanceM / 1000).toFixed(1)}km`}</div><small>from work</small>`
        : `<small>Location off</small>`}</div>
    </div>
    <div class="status">${status}${position ? ` · ${esc(position.source)}` : ""}</div>
    <button class="btn big" id="clockBtn" ${!open && !(shift && d?.onSite) ? "disabled" : ""}>${open ? "Clock out" : "Clock in"}</button>
    <div class="loc">
      <button class="btn ghost small" data-loc="gps">Use my GPS</button>
      <button class="btn ghost small" data-loc="site">Simulate: at work</button>
      <button class="btn ghost small" data-loc="away">Simulate: at home</button>
    </div>
    <label style="display:block;margin-top:10px;font-size:12px" class="muted">
      <input type="checkbox" id="autoClock" ${autoClock ? "checked" : ""}/> Clock me in automatically when I arrive (within ${state.site.radiusM}m)
    </label>`;
  $("#clockBtn").onclick = () => doClock(false);
  $("#autoClock").onchange = (e) => {
    autoClock = e.target.checked;
    localStorage.setItem("autoClock", autoClock ? "on" : "off");
  };
  document.querySelectorAll("[data-loc]").forEach((b) => (b.onclick = () => setLocation(b.dataset.loc)));
}

async function setLocation(mode) {
  localStorage.setItem("locMode", mode);
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch), (gpsWatch = null);
  if (mode === "gps") {
    if (!navigator.geolocation) return toast("This browser has no location access.", true);
    gpsWatch = navigator.geolocation.watchPosition(
      (p) => updatePosition({ lat: p.coords.latitude, lng: p.coords.longitude, source: `GPS ±${Math.round(p.coords.accuracy)}m` }),
      (err) => toast(`Location blocked: ${err.message}`, true),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
  } else {
    await updatePosition(SIMULATED[mode]());
  }
}

async function updatePosition(p) {
  position = p;
  distanceInfo = await api("/api/distance", { method: "POST", body: { lat: p.lat, lng: p.lng } });
  if (autoClock && distanceInfo.onSite && !state.clock.open && state.clock.shift) {
    await doClock(true);
    return;
  }
  renderClock();
}

async function doClock(auto) {
  if (!position) return toast("Turn on location first.", true);
  try {
    const r = await api("/api/clock", { method: "POST", body: { lat: position.lat, lng: position.lng } });
    toast(r.action === "in" ? `${auto ? "Auto " : ""}clocked in, ${r.distanceM}m from ${state.site.name}.` : "Clocked out. Nice work.");
    await load();
  } catch (e) {
    toast(e.message, true);
    renderClock();
  }
}

function renderCoverAsks() {
  $("#coverAsks").innerHTML = state.coverAsks
    .map(
      (s) => `<div class="card ask-card"><h2>Can you cover?</h2>
      <p style="margin:0 0 4px"><strong>${esc(s.role)}</strong> · ${esc(fmtRange(s))}</p>
      <p class="muted" style="margin:0 0 10px">${esc(first(s.cover.requestedBy))} can't make it.
        <br><strong>Why you:</strong> ${esc(s.cover.ranking.find((r) => r.staffId === who)?.reason ?? "")}</p>
      <button class="btn" data-accept="${esc(s.id)}">Yes, I'll cover</button>
      <button class="btn ghost" data-decline="${esc(s.id)}">Can't, sorry</button></div>`,
    )
    .join("");
  const respond = (id, accept) => async () => {
    try {
      await api(`/api/shifts/${id}/cover/respond`, { method: "POST", body: { accept } });
      toast(accept ? "Thanks! It's in your rota." : "No problem, we'll ask someone else.");
      await load();
    } catch (e) {
      toast(e.message, true);
      await load();
    }
  };
  document.querySelectorAll("[data-accept]").forEach((b) => (b.onclick = respond(b.dataset.accept, true)));
  document.querySelectorAll("[data-decline]").forEach((b) => (b.onclick = respond(b.dataset.decline, false)));
}

function myUpcoming() {
  const now = new Date();
  return state.shifts
    .filter((s) => (s.staffId === who || s.cover?.requestedBy === who) && new Date(s.end) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function renderMyShifts() {
  const list = myUpcoming().slice(0, 8);
  $("#myShifts").innerHTML =
    list
      .map((s) => {
        const mineNow = s.staffId === who;
        let right;
        if (s.status === "needs_cover" && s.cover.requestedBy === who) {
          right = `<span class="badge pending">Asking ${s.cover.asked.length}</span>`;
        } else if (s.status === "covered" && s.cover.originalStaffId === who && !mineNow) {
          right = `<span class="badge ok">Covered by ${esc(first(s.staffId))}</span>`;
        } else if (s.status === "covered" && s.cover.coveredBy === who) {
          right = `<span class="badge ok">You're covering</span>`;
        } else if (new Date(s.start) <= new Date() || state.clock.open?.shiftId === s.id) {
          right = `<span class="badge ok">In progress</span>`;
        } else {
          right = `<button class="btn ghost small" data-drop="${esc(s.id)}">Can't make it</button>`;
        }
        return `<li><div><div class="when">${esc(fmtDay(s.start))} ${esc(fmtTime(s.start))}–${esc(fmtTime(s.end))}</div><small>${esc(s.role)}</small></div>${right}</li>`;
      })
      .join("") || `<li class="muted">No upcoming shifts.</li>`;
  document.querySelectorAll("[data-drop]").forEach(
    (b) =>
      (b.onclick = () => {
        const s = state.shifts.find((x) => x.id === b.dataset.drop);
        const body = modal(`<h3>Can't make it?</h3><p class="muted">${esc(s.role)} · ${esc(fmtRange(s))}</p>
          <form id="dropForm" class="form-grid"><label class="wide">Reason (shared with your manager) <input name="reason" maxlength="200" placeholder="e.g. Uni exam moved" /></label>
          <div class="modal-actions wide"><button type="button" class="btn ghost" data-close>Keep shift</button><button class="btn">Find me cover</button></div></form>`);
        body.querySelector("#dropForm").onsubmit = async (e) => {
          e.preventDefault();
          const btn = e.target.querySelector("button:not([data-close])");
          btn.disabled = true;
          btn.textContent = "Finding the best people…";
          try {
            const r = await api(`/api/shifts/${s.id}/cover`, { method: "POST", body: { reason: new FormData(e.target).get("reason") } });
            const names = r.cover.asked.map(first);
            modal(`<h3>We're on it</h3>
              <p>${names.length ? `Asked <strong>${names.map(esc).join(", ")}</strong>. You'll see it here when someone says yes.` : "Nobody is free for this one, so your manager has been told."}</p>
              <ul class="cands">${r.cover.ranking.slice(0, 3).map((x) => `<li><div><strong>${esc(nameOf(x.staffId))}</strong><div class="reason">${esc(x.reason)}</div></div></li>`).join("")}</ul>
              <p><span class="badge ${r.cover.source === "ai" ? "ai" : ""}">${r.cover.source === "ai" ? "Ranked by AI" : "Ranked by rules"}</span></p>
              <div class="modal-actions"><button class="btn" data-close>OK</button></div>`);
            await load();
          } catch (err) {
            toast(err.message, true);
          }
        };
      }),
  );
}

function renderMyCalendar() {
  const mine = state.shifts.filter((s) => s.staffId === who || s.cover?.requestedBy === who);
  if (!myCalendar) {
    myCalendar = new FullCalendar.Calendar($("#myCalendar"), {
      initialView: "listWeek", firstDay: 1, height: "auto", locale: "en-gb",
      headerToolbar: { left: "prev,next", center: "title", right: "listWeek,dayGridMonth" },
      buttonText: { week: "Week", month: "Month" },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      noEventsContent: "No shifts this week",
    });
    myCalendar.render();
  }
  myCalendar.removeAllEvents();
  myCalendar.addEventSource(
    shiftEvents(mine, { mine: true }).map((e) => {
      const s = state.shifts.find((x) => x.id === e.id);
      if (s.status === "covered" && s.staffId !== who) e.title = `${s.role} (covered by ${first(s.staffId)})`;
      if (s.status === "covered" && s.cover.coveredBy === who) e.title = `${s.role} (covering ${first(s.cover.originalStaffId)})`;
      return e;
    }),
  );
  myCalendar.addEventSource(timeOffEvents(state.timeOff));
}

function renderMyTimeOff() {
  $("#myTimeOff").innerHTML = state.timeOff
    .map((t) => `<li><span>${esc(fmtDay(t.start))} → ${esc(fmtDay(new Date(+new Date(t.end) - 1)))}</span><span class="badge ${esc(t.status)}">${esc(t.status)}</span></li>`)
    .join("");
}

$("#timeOffForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const start = new Date(`${f.get("start")}T00:00:00`);
  const end = new Date(`${f.get("end")}T00:00:00`);
  end.setDate(end.getDate() + 1); // inclusive end date
  try {
    await api("/api/timeoff", { method: "POST", body: { start, end, reason: f.get("reason") } });
    toast("Sent to your manager.");
    e.target.reset();
    await load();
  } catch (err) {
    toast(err.message, true);
  }
};

// Keep two windows (manager + staff) in sync during a demo. Skip refresh while a dialog is open.
setInterval(() => {
  if (!$("#modal").open && document.visibilityState === "visible") load().catch(() => {});
}, 4000);

load()
  .then(() => {
    if (!state.user.manager) {
      const mode = localStorage.getItem("locMode");
      if (mode) setLocation(mode);
    }
  })
  .catch((e) => toast(e.message, true));
