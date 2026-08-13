import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

const connectionString =
  process.env.POSTGRES_URL ?? process.env.DATABASE_URL ?? "";

// node-postgres defaults to 10 connections. The add-on also runs five Python
// workers, a Flask auth server and psql calls from the boot script against one
// embedded PostgreSQL, so the default pool alone could exhaust the server and
// every query then failed with "sorry, too many clients already".
export const pool = new pg.Pool({
  connectionString,
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, {
  schema,
  casing: "snake_case",
});
