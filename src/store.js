// Tiny JSON-file store. Good enough for a single small business demo.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { buildSeed } from "./seed.js";

export function createStore(file, { now = () => new Date() } = {}) {
  let db;
  if (file && existsSync(file)) {
    db = JSON.parse(readFileSync(file, "utf8"));
  } else {
    db = buildSeed(now());
    persist();
  }

  function persist() {
    if (!file) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db, null, 2));
    renameSync(tmp, file);
  }

  let counter = Date.now();
  const newId = (prefix) => `${prefix}${(counter++).toString(36)}`;

  return {
    get db() {
      return db;
    },
    save: persist,
    newId,
    staff: (id) => db.staff.find((s) => s.id === id),
    shift: (id) => db.shifts.find((s) => s.id === id),
    log(type, text, extra = {}) {
      db.log.unshift({ at: now().toISOString(), type, text, ...extra });
      db.log = db.log.slice(0, 50);
    },
    reset() {
      db = buildSeed(now());
      persist();
    },
  };
}
