import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const dataDir = path.resolve(process.env.DATA_DIR || ".e2e-data");
const dbPath = path.resolve(process.env.DB_PATH || path.join(dataDir, "lockedin.db"));

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec(`
  CREATE TABLE users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    google_user_id TEXT UNIQUE NOT NULL,
    email          TEXT,
    created_at     INTEGER
  );
  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data    TEXT NOT NULL DEFAULT '{}'
  );
`);
db.prepare(
  "INSERT INTO users(id, google_user_id, email, created_at) VALUES (?, ?, ?, ?)",
).run(1, "e2e@example.com", "e2e@example.com", Date.now());
db.prepare("INSERT INTO user_settings(user_id, data) VALUES (?, ?)").run(
  1,
  JSON.stringify({
    parser_mode: "rules",
    default_follow_up_days: 7,
    timezone: "UTC",
    notifications_enabled: false,
    llm_provider: "openai",
    llm_base_url: "",
    llm_model: "",
  }),
);
db.close();
console.log(`Seeded ${dbPath}`);
