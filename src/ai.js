// AI cover ranking via the OpenAI Responses API with Structured Outputs.
// Falls back to the rule-based order when there's no API key, or the call fails or times out.
import { ruleReason } from "./rota.js";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ranked", "message"],
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["staffId", "reason"],
        properties: {
          staffId: { type: "string" },
          reason: { type: "string", description: "One short sentence a manager can skim." },
        },
      },
    },
    message: {
      type: "string",
      description: "A friendly 1-2 sentence message asking the top pick to cover. No emojis.",
    },
  },
};

function describeShift(shift) {
  const s = new Date(shift.start);
  const e = new Date(shift.end);
  const day = s.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
  const t = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${shift.role} on ${day}, ${t(s)}-${t(e)}`;
}

function fallback(shift, eligible, requesterName) {
  const top = eligible[0];
  return {
    source: "rules",
    ranked: eligible.map((c) => ({ staffId: c.staffId, reason: ruleReason(c) })),
    message: top
      ? `Hi ${top.name.split(" ")[0]}, could you cover ${requesterName ? `${requesterName.split(" ")[0]}'s ` : "a "}${describeShift(shift)}? Let me know in the app.`
      : "",
  };
}

export async function rankCovers({ shift, candidates, requesterName, reason, env = process.env, fetchImpl = fetch }) {
  const eligible = candidates.filter((c) => c.eligible).slice(0, 8);
  if (!eligible.length) return { source: "rules", ranked: [], message: "" };
  if (!env.OPENAI_API_KEY) return fallback(shift, eligible, requesterName);

  // Only work-relevant facts go to the model: first names, skills, hours, availability.
  const facts = eligible.map((c) => ({
    staffId: c.staffId,
    firstName: c.name.split(" ")[0],
    role: c.role,
    matchedSkills: c.matchedSkills,
    missingSkills: c.missingSkills,
    usuallyAvailableThen: c.availableUsually,
    hoursThisWeek: c.hoursThisWeek,
    preferredMaxHours: c.maxHours,
    hourlyRate: c.hourlyRate,
    ruleScore: c.score,
  }));

  const prompt = [
    "You help a small business manager find someone to cover a shift.",
    `Shift: ${describeShift(shift)}. Skills needed: ${(shift.skillsNeeded ?? []).join(", ") || "none listed"}.`,
    `${requesterName?.split(" ")[0] ?? "A colleague"} can't make it${reason ? ` (reason: ${reason})` : ""}.`,
    "Rank every candidate below, best first. Prefer people with the needed skills, who are usually available then,",
    "and who have hours to spare under their preferred maximum. Break ties on lower cost. Use only staffIds given.",
    "Write one short, specific reason per person, and a short friendly message to send to your top pick.",
    `Candidates (JSON): ${JSON.stringify(facts)}`,
  ].join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(env.AI_TIMEOUT_MS ?? 15000));
  try {
    const res = await fetchImpl(`${env.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL ?? "gpt-6-astra",
        input: prompt,
        text: { format: { type: "json_schema", name: "cover_ranking", schema: SCHEMA, strict: true } },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenAI API ${res.status}`);
    const body = await res.json();
    const text =
      body.output_text ??
      body.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text;
    const parsed = JSON.parse(text);
    // Never trust ids blindly: keep only known eligible people, then append anyone the model skipped.
    const known = new Map(eligible.map((c) => [c.staffId, c]));
    const seen = new Set();
    const ranked = [];
    for (const r of parsed.ranked ?? []) {
      if (known.has(r.staffId) && !seen.has(r.staffId)) {
        seen.add(r.staffId);
        ranked.push({ staffId: r.staffId, reason: String(r.reason).slice(0, 300) });
      }
    }
    for (const c of eligible) if (!seen.has(c.staffId)) ranked.push({ staffId: c.staffId, reason: ruleReason(c) });
    return { source: "ai", ranked, message: String(parsed.message ?? "").slice(0, 500) };
  } catch (err) {
    const fb = fallback(shift, eligible, requesterName);
    fb.note = `AI unavailable (${err.name === "AbortError" ? "timed out" : err.message}), used rules instead.`;
    return fb;
  } finally {
    clearTimeout(timer);
  }
}
