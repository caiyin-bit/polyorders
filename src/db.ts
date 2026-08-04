import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DB_PATH } from "./config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidates (
  address TEXT PRIMARY KEY,
  username TEXT,
  leaderboard_pnl REAL,
  leaderboard_vol REAL,
  rank INTEGER,
  markets_traded INTEGER,
  passed_prefilter INTEGER,
  positions_fetched_at INTEGER,
  fetched_at INTEGER
);

CREATE TABLE IF NOT EXISTS closed_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  condition_id TEXT NOT NULL,
  title TEXT,
  outcome TEXT,
  avg_price REAL,
  total_bought REAL,
  realized_pnl REAL NOT NULL,
  timestamp INTEGER,
  UNIQUE(address, condition_id, outcome, timestamp)
);
CREATE INDEX IF NOT EXISTS idx_cp_addr ON closed_positions(address);
CREATE INDEX IF NOT EXISTS idx_cp_addr_ts ON closed_positions(address, timestamp);

CREATE TABLE IF NOT EXISTS scores (
  address TEXT PRIMARY KEY,
  total_positions INTEGER,
  winning_positions INTEGER,
  win_rate REAL,
  total_realized_pnl REAL,
  avg_pnl REAL,
  score REAL,
  rank INTEGER,
  computed_at INTEGER
);

CREATE TABLE IF NOT EXISTS fetch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  addresses_ok INTEGER,
  addresses_failed INTEGER,
  error TEXT
);

CREATE TABLE IF NOT EXISTS markets (
  condition_id TEXT PRIMARY KEY,
  slug TEXT,
  event_slug TEXT,
  fetched_at INTEGER
);
`;

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (instance) return instance;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  instance = db;
  return db;
}
