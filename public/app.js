// RotaBuddy front end. Plain JS, no build step.
const $ = (sel) => document.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const gbp = (n) => `£${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const gbp0 = (n) => `£${Math.round(Number(n)).toLocaleString("en-GB")}`;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtRange = (s) => `${fmtDay(s.start)} · ${fmtTime(s.start)}–${fmtTime(s.end)}`;
const hrs = (n) => `${Number(n).toFixed(1).replace(/\.0$/, "")}h`;

// Who you are comes from the link (?as=s2) so two windows can be two people; falls back to the last choice.
let who = new URLSearchParams(location.search).get("as") ?? localStorage.getItem("who") ?? "manager";
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
const aiBadge = (source) =>
  source === "ai" ? `<span class="badge ai">Ranked by AI</span>` : `<span class="badge">Ranked by rules</span>`;

// ---------- boot ----------
async function load() {
  state = await api("/api/state");
  $("#siteName").textContent = state.site.name;
  renderWho();
  if (state.user.manager) renderManager();
  else renderWorker();
}

function renderWho() {
  const sel = $("#whoSelect");
  if (!sel.options.length) {
    sel.innerHTML =
      `<option value="manager">Sam · Manager</option>` +
      state.staff.map((s) => `<option value="${esc(s.id)}">${esc(s.name)} · ${esc(s.role)}</option>`).join("");
    sel.addEventListener("change", () => {
      localStorage.setItem("who", sel.value);
      const url = new URL(location.href);
      url.searchParams.set("as", sel.value);
      location.href = url.toString();
    });
  }
  sel.value = who;
}

// ---------- calendar events ----------
function shiftEvents(shifts, { mine } = {}) {
  return shifts.map((s) => {
    const p = staffById(s.staffId);
    const needs = s.status === "needs_cover";
    let title = `${p ? p.name.split(" ")[0] : "Open"} · ${s.role}`;
    if (needs) title = `Needs cover · ${s.role}`;
    if (s.status === "covered") title = `${first(s.staffId)} for ${first(s.cover.originalStaffId)} · ${s.role}`;
    if (mine) {
      title = needs ? `${s.role} · finding cover` : s.role;
      if (s.status === "covered" && s.staffId !== who) title = `${s.role} · covered by ${first(s.staffId)}`;
      if (s.status === "covered" && s.cover.coveredBy === who) title = `${s.role} · covering ${first(s.cover.originalStaffId)}`;
    }
    return {
      id: s.id, title, start: s.start, end: s.end,
      extendedProps: { color: needs ? "#e5484d" : p?.color ?? "#a3a3a3" },
      classNames: [needs ? "needs-cover" : "", s.status === "covered" ? "covered" : ""],
    };
  });
}

function timeOffEvents(list) {
  return list
    .filter((t) => t.status !== "declined")
    .map((t) => ({
      id: `to-${t.id}`, title: `${first(t.staffId)} off${t.status === "pending" ? " (pending)" : ""}`,
      start: t.start, end: t.end, allDay: true,
      extendedProps: { color: "#a3a3a3" }, classNames: ["timeoff"],
    }));
}

const paintEvent = (info) => info.el.style.setProperty("--ev", info.event.extendedProps.color);
const hm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Compact "chip" for week/month grids: time, first name, role.
function chipContent(arg) {
  if (arg.view.type.startsWith("timeGrid") || arg.event.allDay) return true; // default rendering
  const [who, ...rest] = arg.event.title.split(" · ");
  const time = `${hm(arg.event.start)}–${hm(arg.event.end)}`;
  return {
    html: `<div class="chip"><span class="t">${esc(time)}</span><b>${esc(who)}</b><span class="r">${esc(rest.join(" · "))}</span></div>`,
  };
}

// ---------- manager ----------
function renderManager() {
  $("#managerView").hidden = false;
  const now = new Date(state.now);
  $("#weekLabel").textContent = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  $("#aiBadge").innerHTML = state.aiEnabled
    ? `<span class="badge ai">AI cover finder on</span>`
    : `<span class="badge">Rule-based cover finder</span>`;
  if (!calendar) {
    calendar = new FullCalendar.Calendar($("#calendar"), {
      initialView: "dayGridWeek",
      firstDay: 1,
      nowIndicator: true,
      dayMaxEvents: false,
      eventDisplay: "block",
      eventOrder: "start,title",
      displayEventEnd: true,
      eventContent: chipContent,
      slotMinTime: "06:00:00",
      slotMaxTime: "22:00:00",
      allDaySlot: true,
      allDayText: "",
      height: "auto",
      expandRows: true,
      selectable: true,
      editable: true,
      slotEventOverlap: false,
      dayHeaderFormat: { weekday: "short", day: "numeric" },
      locale: "en-gb",
      headerToolbar: { left: "title", center: "", right: "today prev,next dayGridWeek,timeGridDay,dayGridMonth" },
      buttonText: { today: "Today", week: "Week", day: "Day", month: "Month" },
      views: { dayGridWeek: { dayHeaderFormat: { weekday: "short", day: "numeric" } } },
      slotLabelFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventDidMount: paintEvent,
      select: (info) => openNewShift(info.start, info.end, info.allDay),
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
  renderKpis();
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

async function renderKpis() {
  const week = await api("/api/pay?period=week");
  const onShift = week.rows.filter((r) => r.clockedIn).length;
  const needs = state.shifts.filter((s) => s.status === "needs_cover").length;
  $("#kpis").innerHTML = [
    ["Wage bill this week", `<span class="num">${gbp0(week.totals.projected)}</span>`],
    ["Paid so far", `<span class="num">${gbp0(week.totals.earned)}</span>`],
    ["On shift now", `<span class="num">${onShift}</span><small style="display:inline;margin-left:6px">of ${state.staff.length}</small>`],
    ["Shifts needing cover", `<span class="num ${needs ? "" : ""}">${needs}</span>`, needs > 0],
  ]
    .map(([label, val, alert]) => `<div class="kpi"><small>${label}</small><div class="val ${alert ? "alert" : ""}">${val}</div></div>`)
    .join("");
}

function renderAlerts() {
  const needs = state.shifts
    .filter((s) => s.status === "needs_cover")
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  const seen = new Set();
  const warnings = [...state.warnings, ...state.warningsNextWeek].filter((w) => {
    if (seen.has(w.text)) return false;
    seen.add(w.text);
    return true;
  });
  const items = [
    ...needs.map(
      (s) => `<li><div class="txt"><span class="sev cover"></span><span>${esc(first(s.cover.requestedBy))} can't make ${esc(s.role)}
        <small>${esc(fmtRange(s))} · asked ${s.cover.asked.map((id) => esc(first(id))).join(", ") || "nobody yet"}</small></span></div>
        <button class="btn small" data-open="${esc(s.id)}">Find cover</button></li>`,
    ),
    ...warnings.map(
      (w) => `<li><div class="txt"><span class="sev ${esc(w.level)}"></span><span>${esc(w.text)}</span></div></li>`,
    ),
  ];
  $("#attentionCard").hidden = items.length === 0;
  $("#alerts").innerHTML = items.join("");
  $("#alerts").querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openShift(b.dataset.open)));
}

async function renderPay() {
  const report = await api(`/api/pay?period=${payPeriod}`);
  const label =
    payPeriod === "month"
      ? new Date(report.from).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : `Week of ${fmtDay(report.from)}`;
  if (state.user.manager) {
    $("#payTable").innerHTML = `<p class="meta">${esc(label)}</p>
      <table><thead><tr><th>Name</th><th class="num">Hours</th><th class="num">Earned</th><th class="num">Projected</th></tr></thead>
      <tbody>${report.rows
        .map(
          (r) => `<tr><td><span class="dot" style="background:${esc(staffById(r.staffId)?.color)}"></span>${esc(r.name.split(" ")[0])}${r.clockedIn ? '<span class="live">Live</span>' : ""}</td>
        <td class="num">${r.workedHours.toFixed(1)}</td><td class="num">${gbp(r.earned)}</td><td class="num">${gbp(r.projected)}</td></tr>`,
        )
        .join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${report.totals.workedHours.toFixed(1)}</td><td class="num">${gbp(report.totals.earned)}</td><td class="num">${gbp(report.totals.projected)}</td></tr></tfoot></table>`;
    $("#csvLink").onclick = async () => {
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
    $("#myPay").innerHTML = `<p class="meta">${esc(label)} · ${gbp(r.hourlyRate)} an hour</p>
      <div class="pay-big">
        <div><div class="val num">${gbp(r.earned)}</div><small>Earned · ${hrs(r.workedHours)}</small></div>
        <div><div class="val2 num">${gbp(r.projected)}</div><small>On track for · ${hrs(r.scheduledHours)}</small></div>
      </div>`;
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay-toggle] button");
  if (!b) return;
  payPeriod = b.dataset.period;
  document
    .querySelectorAll("[data-pay-toggle] button")
    .forEach((x) => x.classList.toggle("on", x.dataset.period === payPeriod));
  renderPay();
});

function renderTimeOff() {
  const list = [...state.timeOff].sort((a, b) => new Date(a.start) - new Date(b.start));
  $("#timeOffList").innerHTML = list.length
    ? `<ul class="plain">${list
        .map(
          (t) => `<li><span>${esc(nameOf(t.staffId))}<small>${esc(fmtDay(t.start))} – ${esc(fmtDay(new Date(+new Date(t.end) - 1)))} · ${esc(t.reason || "No reason given")}</small></span>
        ${
          t.status === "pending"
            ? `<span style="display:flex;gap:6px"><button class="btn ghost small" data-to="${esc(t.id)}" data-s="declined">Decline</button><button class="btn small" data-to="${esc(t.id)}" data-s="approved">Approve</button></span>`
            : `<span class="badge ${esc(t.status)}">${esc(t.status[0].toUpperCase() + t.status.slice(1))}</span>`
        }</li>`,
        )
        .join("")}</ul>`
    : `<p class="muted" style="margin:0;font-size:14px">No requests.</p>`;
  $("#timeOffList").querySelectorAll("[data-to]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await api(`/api/timeoff/${b.dataset.to}`, { method: "PATCH", body: { status: b.dataset.s } });
          toast(
            r.coverOpenedFor.length
              ? `Approved. Finding cover for ${r.coverOpenedFor.length} shift${r.coverOpenedFor.length > 1 ? "s" : ""}.`
              : `Time off ${b.dataset.s}.`,
          );
          await load();
        } catch (e) {
          toast(e.message, true);
        }
      }),
  );
}

function renderActivity() {
  $("#activity").innerHTML =
    state.log.map((l) => `<li><time class="mono">${esc(fmtTime(l.at))}</time><span>${esc(l.text)}</span></li>`).join("") ||
    `<li><time></time><span class="muted">Nothing yet today.</span></li>`;
}

$("#resetBtn").onclick = async () => {
  if (!confirm("Reset all demo data to the starting rota?")) return;
  await api("/api/reset", { method: "POST" });
  location.reload();
};

// ---------- sheets ----------
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
  return (
    `<option value="">Open shift</option>` +
    state.staff
      .map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`)
      .join("")
  );
}

function openNewShift(start, end, allDay) {
  const day = start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const times = allDay
    ? `<label>Starts <input type="time" name="from" value="09:00" required /></label>
       <label>Ends <input type="time" name="to" value="17:00" required /></label>`
    : "";
  const body = modal(`<h3>New shift</h3><p class="muted">${esc(allDay ? day : fmtRange({ start, end }))}</p>
    <form class="form-grid" id="newShift">${times}
      <label>Role <input name="role" value="Barista" required maxlength="60" /></label>
      <label>Assign to <select name="staffId">${staffOptions("")}</select></label>
      <label class="wide">Skills needed <input name="skills" value="barista" placeholder="comma separated" /></label>
      <div class="modal-actions wide"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn">Add shift</button></div>
    </form>`);
  body.querySelector("#newShift").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    let s0 = start;
    let e0 = end;
    if (allDay) {
      const at = (hhmm) => {
        const d = new Date(start);
        const [h, m] = String(hhmm).split(":").map(Number);
        d.setHours(h, m, 0, 0);
        return d;
      };
      s0 = at(f.get("from"));
      e0 = at(f.get("to"));
      if (e0 <= s0) e0.setDate(e0.getDate() + 1); // overnight shift
    }
    try {
      await api("/api/shifts", {
        method: "POST",
        body: {
          start: s0.toISOString(), end: e0.toISOString(), role: f.get("role"),
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
  const header = `<h3>${esc(s.role)}</h3><p class="muted">${esc(fmtRange(s))}${s.skillsNeeded.length ? ` · ${esc(s.skillsNeeded.join(", "))}` : ""}</p>`;
  if (s.status === "needs_cover") return openCover(s, header);

  const body = modal(`${header}
    ${s.status === "covered" ? `<div class="callout">${esc(nameOf(s.cover.coveredBy))} is covering for ${esc(nameOf(s.cover.originalStaffId))}.</div>` : ""}
    <form class="form-grid" id="editShift">
      <label>Role <input name="role" value="${esc(s.role)}" maxlength="60" /></label>
      <label>Assigned to <select name="staffId">${staffOptions(s.staffId)}</select></label>
      <div class="modal-actions wide">
        <button type="button" class="btn danger" id="delShift">Delete</button>
        <span class="spacer"></span>
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
  if (fc)
    fc.onclick = async () => {
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
  const ordered = [...cands].sort(
    (a, b) => (rank.get(a.staffId)?.i ?? 99) - (rank.get(b.staffId)?.i ?? 99) || b.eligible - a.eligible,
  );
  let n = 0;
  const body = modal(`${header}
    <div class="callout"><strong>${esc(nameOf(s.cover.requestedBy))}</strong> can't make it${s.cover.reason ? ` · “${esc(s.cover.reason)}”` : ""}</div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h2>Who can cover</h2>${aiBadge(s.cover.source)}
    </div>
    ${s.cover.note ? `<p class="meta" style="margin-top:6px">${esc(s.cover.note)}</p>` : ""}
    <ul class="cands">${ordered
      .map((c) => {
        const r = rank.get(c.staffId);
        const asked = s.cover.asked.includes(c.staffId);
        const declined = s.cover.declined.includes(c.staffId);
        const pos = c.eligible ? ++n : 0;
        return `<li class="${pos === 1 ? "top" : ""} ${c.eligible ? "" : "ineligible"}">
        <div>${pos ? `<span class="rank">${pos}</span>` : ""}<strong>${esc(c.name)}</strong><span class="meta-line">${esc(c.role)} · ${c.hoursThisWeek}/${c.maxHours}h · ${gbp(c.hourlyRate)}</span>
          <div class="reason">${esc(c.eligible ? r?.reason ?? "" : `Unavailable: ${c.exclusions.join(", ")}`)}</div></div>
        <div>${
          declined
            ? `<span class="badge bad">Declined</span>`
            : asked
              ? `<span class="badge pending">Asked</span>`
              : c.eligible
                ? `<button class="btn ghost small" data-ask="${esc(c.staffId)}">Ask</button>`
                : ""
        }</div>
      </li>`;
      })
      .join("")}</ul>
    ${s.cover.message ? `<div class="draft"><b>Message sent to top picks</b>${esc(s.cover.message)}</div>` : ""}
    <div class="modal-actions"><button class="btn ghost" id="cancelCover">Cancel request</button><span class="spacer"></span><button class="btn" data-close>Done</button></div>`);
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
  const now = new Date(state.now);
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${part}, ${state.user.name.split(" ")[0]}`;
  $("#greetingSub").textContent = `${state.site.name} · ${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`;
  renderClock();
  renderCoverAsks();
  renderPay();
  renderMyShifts();
  renderMyCalendar();
  renderMyTimeOff();
}

const SIMULATED = {
  site: () => ({ lat: state.site.lat + 0.0002, lng: state.site.lng - 0.0001, source: "site" }),
  away: () => ({ lat: state.site.lat + 0.011, lng: state.site.lng - 0.006, source: "away" }),
};

function ring(fraction, color, center) {
  const r = 84;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  return `<div class="ring-wrap">
    <svg viewBox="0 0 188 188" width="188" height="188" aria-hidden="true">
      <circle class="track" cx="94" cy="94" r="${r}" fill="none" stroke-width="12"/>
      <circle class="bar" cx="94" cy="94" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}"/>
    </svg>
    <div class="ring-center">${center}</div>
  </div>`;
}

function renderClock() {
  const { open, shift } = state.clock;
  const d = distanceInfo;
  const rate = staffById(who)?.hourlyRate ?? 0;
  const mode = localStorage.getItem("locMode");
  let ringHtml;
  let status;
  if (open) {
    const sh = state.shifts.find((x) => x.id === open.shiftId);
    const elapsed = (Date.now() - new Date(open.in)) / 36e5;
    const len = sh ? (new Date(sh.end) - new Date(sh.start)) / 36e5 : 8;
    ringHtml = ring(elapsed / len, "var(--green)", `<div class="val num">${gbp(elapsed * rate)}</div><small>this shift</small>`);
    status = `<strong>Clocked in</strong> since ${fmtTime(open.in)}${sh ? ` · ends ${fmtTime(sh.end)}` : ""}`;
  } else if (d) {
    const dist = d.distanceM < 1000 ? `${d.distanceM}m` : `${(d.distanceM / 1000).toFixed(1)}km`;
    const closeness = d.onSite ? 1 : Math.max(0.04, 1 - Math.log10(d.distanceM / state.site.radiusM) / 2);
    ringHtml = ring(closeness, d.onSite ? "var(--blue)" : "var(--amber)", `<div class="val num">${dist}</div><small>from work</small>`);
    status = shift ? `Next: <strong>${esc(shift.role)}</strong> at ${fmtTime(shift.start)}` : "No shift right now";
  } else {
    ringHtml = ring(0, "var(--faint)", `<div class="val" style="font-size:20px">Location off</div><small>choose below</small>`);
    status = shift ? `Next: <strong>${esc(shift.role)}</strong> at ${fmtTime(shift.start)}` : "No shift right now";
  }
  const canClockIn = !open && shift && d?.onSite;
  $("#clockCard").innerHTML = `
    ${ringHtml}
    <p class="status">${status}</p>
    <button class="btn big ${open ? "" : "go"}" id="clockBtn" ${!open && !canClockIn ? "disabled" : ""}>${open ? "Clock out" : "Clock in"}</button>
    <span class="loc-label">Location</span>
    <div class="seg full" role="group" aria-label="Location">
      <button data-loc="gps" class="${mode === "gps" ? "on" : ""}">My GPS</button>
      <button data-loc="site" class="${mode === "site" ? "on" : ""}">At work</button>
      <button data-loc="away" class="${mode === "away" ? "on" : ""}">At home</button>
    </div>
    <div class="toggle-row">
      <span>Auto clock-in<small class="muted">When you're within ${state.site.radiusM}m of ${esc(state.site.name)}</small></span>
      <label class="switch"><input type="checkbox" id="autoClock" ${autoClock ? "checked" : ""}/><span></span></label>
    </div>`;
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
      (p) => updatePosition({ lat: p.coords.latitude, lng: p.coords.longitude, source: "gps" }),
      (err) => toast(`Location blocked: ${err.message}`, true),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    renderClock();
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
    toast(r.action === "in" ? `${auto ? "Clocked in automatically" : "Clocked in"} · ${r.distanceM}m from work` : "Clocked out. Nice work.");
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
      <p style="margin:6px 0 0;font-size:15px"><strong>${esc(s.role)}</strong></p>
      <p class="muted" style="margin:2px 0 0;font-size:14px">${esc(fmtRange(s))} · for ${esc(first(s.cover.requestedBy))}</p>
      <div class="why">${esc(s.cover.ranking.find((r) => r.staffId === who)?.reason ?? "")}</div>
      <div class="ask-actions"><button class="btn ghost" data-decline="${esc(s.id)}">Not this time</button>
      <button class="btn" data-accept="${esc(s.id)}">I'll cover it</button></div></div>`,
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
  const list = myUpcoming().slice(0, 6);
  $("#myShifts").innerHTML =
    list
      .map((s) => {
        const mineNow = s.staffId === who;
        let right;
        if (s.status === "needs_cover" && s.cover.requestedBy === who) {
          right = `<span class="badge pending">Asked ${s.cover.asked.length}</span>`;
        } else if (s.status === "covered" && s.cover.originalStaffId === who && !mineNow) {
          right = `<span class="badge ok">${esc(first(s.staffId))} is covering</span>`;
        } else if (s.status === "covered" && s.cover.coveredBy === who) {
          right = `<span class="badge ok">Covering</span>`;
        } else if (new Date(s.start) <= new Date() || state.clock.open?.shiftId === s.id) {
          right = `<span class="badge ok">Now</span>`;
        } else {
          right = `<button class="btn ghost small" data-drop="${esc(s.id)}">Can't make it</button>`;
        }
        return `<li><div><div class="when">${esc(fmtDay(s.start))}</div><small class="muted"><span class="mono">${esc(fmtTime(s.start))}–${esc(fmtTime(s.end))}</span> · ${esc(s.role)}</small></div>${right}</li>`;
      })
      .join("") || `<li class="muted">No upcoming shifts.</li>`;
  document.querySelectorAll("[data-drop]").forEach(
    (b) =>
      (b.onclick = () => {
        const s = state.shifts.find((x) => x.id === b.dataset.drop);
        const body = modal(`<h3>Can't make it?</h3><p class="muted">${esc(s.role)} · ${esc(fmtRange(s))}</p>
          <form id="dropForm" class="form-grid"><label class="wide">Reason, shared with your manager <input name="reason" maxlength="200" placeholder="e.g. Uni exam moved" /></label>
          <div class="modal-actions wide"><button type="button" class="btn ghost" data-close>Keep shift</button><button class="btn">Find cover</button></div></form>`);
        body.querySelector("#dropForm").onsubmit = async (e) => {
          e.preventDefault();
          const btn = e.target.querySelector("button:not([data-close])");
          btn.disabled = true;
          btn.textContent = "Finding the best people…";
          try {
            const r = await api(`/api/shifts/${s.id}/cover`, {
              method: "POST", body: { reason: new FormData(e.target).get("reason") },
            });
            const names = r.cover.asked.map(first);
            modal(`<h3>We're on it</h3>
              <p class="muted">${names.length ? `We've asked ${names.map(esc).join(" and ")}. You'll see it here when someone says yes.` : "Nobody is free for this one, so your manager has been told."}</p>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><h2>Best matches</h2>${aiBadge(r.cover.source)}</div>
              <ul class="cands">${r.cover.ranking
                .slice(0, 3)
                .map((x, i) => `<li class="${i === 0 ? "top" : ""}"><div><span class="rank">${i + 1}</span><strong>${esc(nameOf(x.staffId))}</strong><div class="reason">${esc(x.reason)}</div></div></li>`)
                .join("")}</ul>
              <div class="modal-actions"><button class="btn" data-close>Done</button></div>`);
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
      headerToolbar: { left: "title", center: "", right: "prev,next" },
      titleFormat: { day: "numeric", month: "short" },
      eventTimeFormat: { hour: "2-digit", minute: "2-digit", hour12: false },
      eventDidMount: paintEvent,
      noEventsContent: "No shifts this week",
    });
    myCalendar.render();
  }
  myCalendar.removeAllEvents();
  myCalendar.addEventSource(shiftEvents(mine, { mine: true }));
  myCalendar.addEventSource(timeOffEvents(state.timeOff));
}

function renderMyTimeOff() {
  $("#myTimeOff").innerHTML = state.timeOff
    .map(
      (t) => `<li><span>${esc(fmtDay(t.start))} – ${esc(fmtDay(new Date(+new Date(t.end) - 1)))}</span><span class="badge ${esc(t.status)}">${esc(t.status[0].toUpperCase() + t.status.slice(1))}</span></li>`,
    )
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

// Keep two windows (manager + staff) in sync during a demo. Skip refresh while a sheet is open.
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
