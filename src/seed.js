// Demo data for a fictional café. Every name here is made up.
// Shifts are generated relative to "now" so the demo always shows the current week.
import { startOfWeek, HOUR } from "./time.js";

const allWeek = (from, to) =>
  Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, [[from, to]]]));
const days = (list, from, to) => Object.fromEntries(list.map((d) => [d, [[from, to]]]));

export const SITE = {
  name: "Copper Kettle Café",
  address: "Shoreditch, London (demo location)",
  lat: 51.5246,
  lng: -0.0786,
  radiusM: 100,
};

export const STAFF = [
  {
    id: "s1", name: "Priya Patel", role: "Barista", color: "#2563eb",
    skills: ["barista", "latte-art", "till"], hourlyRate: 13.2, maxHours: 40,
    availability: days(["mon", "tue", "wed", "thu", "fri"], "07:00", "19:00"),
  },
  {
    id: "s2", name: "Tom Okafor", role: "Barista", color: "#16a34a",
    skills: ["barista", "till", "opening"], hourlyRate: 12.9, maxHours: 45,
    availability: days(["mon", "tue", "wed", "thu", "fri", "sat"], "06:00", "15:00"),
  },
  {
    id: "s3", name: "Mei Chen", role: "Supervisor", color: "#9333ea",
    skills: ["supervisor", "barista", "till", "cash-up", "opening", "closing"], hourlyRate: 15.5, maxHours: 45,
    availability: allWeek("07:00", "22:00"),
  },
  {
    id: "s4", name: "Jack Byrne", role: "Kitchen", color: "#ea580c",
    skills: ["kitchen", "food-hygiene", "prep"], hourlyRate: 13.0, maxHours: 40,
    availability: allWeek("07:00", "18:00"),
  },
  {
    id: "s5", name: "Aisha Rahman", role: "Barista", color: "#db2777",
    skills: ["barista", "till", "closing"], hourlyRate: 12.8, maxHours: 25,
    availability: days(["wed", "thu", "fri", "sat", "sun"], "12:00", "22:00"),
  },
  {
    id: "s6", name: "Leo Martins", role: "Kitchen", color: "#0891b2",
    skills: ["kitchen", "barista", "food-hygiene", "opening"], hourlyRate: 13.0, maxHours: 35,
    availability: days(["mon", "tue", "wed", "thu", "fri", "sat"], "06:30", "20:00"),
  },
];

// [weekday index 0=Mon, staffId, startHour, endHour, role, skillsNeeded]
const WEEK_PATTERN = [
  [0, "s2", 7, 15, "Barista (open)", ["barista", "opening"]],
  [1, "s2", 7, 15, "Barista (open)", ["barista", "opening"]],
  [2, "s2", 7, 15, "Barista (open)", ["barista", "opening"]],
  [3, "s2", 7, 15, "Barista (open)", ["barista", "opening"]],
  [4, "s6", 7, 15, "Barista (open)", ["barista", "opening"]],
  [5, "s2", 7, 15, "Barista (open)", ["barista", "opening"]],
  [6, "s3", 7, 15, "Barista (open)", ["barista", "opening"]],

  [0, "s1", 11, 19, "Barista (close)", ["barista", "closing"]],
  [1, "s1", 11, 19, "Barista (close)", ["barista", "closing"]],
  [2, "s5", 12, 19, "Barista (close)", ["barista", "closing"]],
  [3, "s5", 12, 19, "Barista (close)", ["barista", "closing"]],
  [4, "s1", 11, 19, "Barista (close)", ["barista", "closing"]],
  [5, "s5", 12, 19, "Barista (close)", ["barista", "closing"]],
  [6, "s5", 12, 19, "Barista (close)", ["barista", "closing"]],

  [0, "s3", 9, 17, "Supervisor", ["supervisor"]],
  [1, "s3", 9, 17, "Supervisor", ["supervisor"]],
  [2, "s3", 9, 17, "Supervisor", ["supervisor"]],
  [3, "s3", 9, 17, "Supervisor", ["supervisor"]],
  [4, "s3", 9, 17, "Supervisor", ["supervisor"]],
  [5, "s3", 10, 18, "Supervisor", ["supervisor"]],

  [0, "s4", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
  [1, "s4", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
  [2, "s6", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
  [3, "s4", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
  [4, "s4", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
  [5, "s6", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
  [6, "s4", 8, 16, "Kitchen", ["kitchen", "food-hygiene"]],
];

// Deterministic jitter so clock-ins look realistic but tests stay stable.
function jitterMinutes(i) {
  return ((i * 37) % 11) - 5; // -5..+5
}

export function buildSeed(now = new Date()) {
  const week0 = startOfWeek(now);
  const shifts = [];
  const clock = [];
  let n = 0;
  for (let w = 0; w < 2; w++) {
    for (const [dayIdx, staffId, sh, eh, role, skillsNeeded] of WEEK_PATTERN) {
      const start = new Date(week0);
      start.setDate(start.getDate() + w * 7 + dayIdx);
      start.setHours(sh, 0, 0, 0);
      const end = new Date(start);
      end.setHours(eh, 0, 0, 0);
      const id = `sh${++n}`;
      shifts.push({
        id, staffId, role, skillsNeeded,
        start: start.toISOString(), end: end.toISOString(),
        status: "assigned", cover: null,
      });
      // Past shifts get matching clock records so pay has something to show.
      if (end < now) {
        const inAt = new Date(+start + jitterMinutes(n) * 60_000);
        const outAt = new Date(+end + jitterMinutes(n + 3) * 60_000);
        clock.push({
          id: `c${n}`, staffId, shiftId: id,
          in: inAt.toISOString(), out: outAt.toISOString(),
          distanceM: 10 + (n % 40),
        });
      }
    }
  }
  // A live shift for Tom starting within the next 15 minutes, so the proximity
  // clock-in can be demoed at any time of day.
  const demoStart = new Date(now);
  demoStart.setSeconds(0, 0);
  demoStart.setMinutes(Math.floor(demoStart.getMinutes() / 15) * 15 + 15);
  const demoEnd = new Date(+demoStart + 4 * HOUR);
  const tomBusy = shifts.some(
    (s) => s.staffId === "s2" && new Date(s.start) < demoEnd && demoStart < new Date(s.end),
  );
  if (!tomBusy) shifts.push({
    id: "shDemo", staffId: "s2", role: "Barista (busy-day extra)", skillsNeeded: ["barista"],
    start: demoStart.toISOString(), end: demoEnd.toISOString(),
    status: "assigned", cover: null,
  });

  const nextMonday = new Date(+week0 + 7 * 24 * HOUR);
  const timeOff = [
    {
      id: "t1", staffId: "s1",
      start: new Date(+nextMonday + 4 * 24 * HOUR).toISOString(),
      end: new Date(+nextMonday + 5 * 24 * HOUR).toISOString(),
      reason: "Dentist and family visit", status: "pending",
    },
  ];
  return {
    site: SITE,
    staff: STAFF,
    shifts,
    clock,
    timeOff,
    log: [],
    seededAt: now.toISOString(),
  };
}
