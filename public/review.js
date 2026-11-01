// Customer review + tip page. Public, no login. Demo only: no money moves.
import { petSvg } from "./pets.js";

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const choice = { staffId: new URLSearchParams(location.search).get("staff"), stars: 0, tip: 0 };

function refresh() {
  document.querySelectorAll("#team button").forEach((b) => b.classList.toggle("on", b.dataset.id === choice.staffId));
  document.querySelectorAll("#stars button").forEach((b) => b.classList.toggle("on", Number(b.dataset.n) <= choice.stars));
  document.querySelectorAll("#tips button").forEach((b) => b.classList.toggle("on", Number(b.dataset.tip) === choice.tip));
  $("#send").disabled = !(choice.staffId && choice.stars);
}

async function init() {
  const res = await fetch("/api/public/team");
  const { site, team } = await res.json();
  $("#title").textContent = `How was ${site.name}?`;
  $("#team").innerHTML = team
    .map((m) => `<button type="button" data-id="${esc(m.id)}">${petSvg(m.pet, "kid", "happy", 70)}<div>${esc(m.firstName)}</div><small>${esc(m.role)}</small></button>`)
    .join("");
  $("#stars").innerHTML = [1, 2, 3, 4, 5].map((n) => `<button type="button" data-n="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">⭐</button>`).join("");
  $("#tips").innerHTML = [0, 1, 2, 5].map((t) => `<button type="button" data-tip="${t}">${t ? `£${t}` : "No tip"}</button>`).join("");
  $("#team").onclick = (e) => { const b = e.target.closest("button"); if (b) { choice.staffId = b.dataset.id; refresh(); } };
  $("#stars").onclick = (e) => { const b = e.target.closest("button"); if (b) { choice.stars = Number(b.dataset.n); refresh(); } };
  $("#tips").onclick = (e) => { const b = e.target.closest("button"); if (b) { choice.tip = Number(b.dataset.tip); refresh(); } };
  refresh();
}

$("#reviewForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#send").disabled = true;
  const res = await fetch("/api/public/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...choice, comment: new FormData(e.target).get("comment") }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error ?? "Something went wrong");
    $("#send").disabled = false;
    return;
  }
  $("#reviewForm").hidden = true;
  $("#lead").hidden = true;
  $("#title").textContent = "Thank you!";
  $("#thanks").hidden = false;
  $("#thanks").innerHTML = `<div class="card pet-card" style="--pc:${esc(data.pet.color)}">
    <div class="pet-stage">${petSvg(data.pet, "kid", "ecstatic", 170)}</div>
    <div class="pet-name">${esc(data.pet.name)} is doing a happy dance</div>
    <p class="pet-mood">${data.xp ? `You just gave ${esc(data.firstName)} <b>+${data.xp} XP</b>.` : `${esc(data.firstName)} will read your feedback.`}</p>
    <a class="btn ghost" href="/review.html">Leave another</a></div>`;
  burst();
};

function burst() {
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  canvas.width = innerWidth; canvas.height = innerHeight;
  const colors = ["#ff5fa2", "#8b5cf6", "#ffc83d", "#2ed8a3", "#38bdf8"];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.4, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 5, c: colors[(Math.random() * colors.length) | 0], r: Math.random() * 6 + 4 }));
  const t0 = performance.now();
  (function f(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of ps) { p.vy += 0.4; p.x += p.vx; p.y += p.vy; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.r, p.r / 2); }
    if (t - t0 < 2400) requestAnimationFrame(f); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })(t0);
}

init();
