import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { createStore } from "./store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbFile = process.env.DB_FILE ?? path.join(ROOT, "data", "db.json");
const store = createStore(dbFile);
const port = Number(process.env.PORT ?? 3000);

createApp({ store }).listen(port, () => {
  console.log(`RotaBuddy running at http://localhost:${port}`);
  console.log(process.env.OPENAI_API_KEY ? "AI cover ranking: on" : "AI cover ranking: off (set OPENAI_API_KEY), using rules");
});
