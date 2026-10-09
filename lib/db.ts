import { createClient } from "@libsql/client";
import type { Lead } from "./types.ts";

// libSQL: local SQLite file in dev, Turso (DATABASE_URL=libsql://...) in prod — same code.
export const db = createClient({
  url: process.env.DATABASE_URL || "file:leadgen.db", // `||`: an empty value in .env.local means "use the local file"
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

let ready: Promise<unknown> | undefined;
export function init() {
  ready ??= db.batch(
    [
      `CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        list TEXT NOT NULL,
        name TEXT NOT NULL,
        industry TEXT, domain TEXT, website TEXT, phone TEXT, email TEXT, address TEXT, city TEXT,
        chain INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'new',
        score INTEGER, tier TEXT, reasons TEXT, signals TEXT, opener TEXT, enriched_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE INDEX IF NOT EXISTS leads_list ON leads(list)`,
      `CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at INTEGER NOT NULL)`,
    ],
    "write",
  );
  return ready;
}

export const HOUR = 3600 * 1000;
export const WEEK = 7 * 24 * HOUR;

// Read-through cache for crawls, geocodes and Overpass queries.
export async function cached<T>(key: string, fn: () => Promise<T>, ttl: number | ((value: T) => number) = WEEK): Promise<T> {
  await init();
  const hit = await db.execute({ sql: "SELECT value, fetched_at FROM cache WHERE key = ?", args: [key] });
  if (hit.rows[0]) {
    const value: T = JSON.parse(String(hit.rows[0].value));
    if (Date.now() - Number(hit.rows[0].fetched_at) < (typeof ttl === "function" ? ttl(value) : ttl)) return value;
  }
  const value = await fn();
  await db.execute({
    sql: "INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at",
    args: [key, JSON.stringify(value), Date.now()],
  });
  return value;
}

export function toLead(row: Record<string, unknown>): Lead {
  const json = (v: unknown) => (v ? JSON.parse(String(v)) : null);
  return { ...(row as unknown as Lead), reasons: json(row.reasons), signals: json(row.signals) };
}

export async function getLead(id: number): Promise<Lead | undefined> {
  await init();
  const r = await db.execute({ sql: "SELECT * FROM leads WHERE id = ?", args: [id] });
  return r.rows[0] ? toLead(r.rows[0]) : undefined;
}
