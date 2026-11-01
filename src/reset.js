// Deletes the local data file so the next start re-seeds fresh demo data for this week.
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
rmSync(process.env.DB_FILE ?? path.join(ROOT, "data", "db.json"), { force: true });
console.log("Demo data reset. Run npm start to re-seed.");
