import dotenv from "dotenv";
dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const url = new URL(process.env.DATABASE_URL);
export const dbType: "mysql" | "pg" = url.protocol.startsWith("mysql") ? "mysql" : "pg";

let _db: any;
let _tables: any;

if (dbType === "mysql") {
  const { drizzle } = await import("drizzle-orm/mysql2");
  const mysql = await import("mysql2/promise");
  const schema = await import("@shared/schema");

  const pool = mysql.default.createPool({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
  });

  _db = drizzle(pool, { schema, mode: "default" });
  _tables = schema;
} else {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const schema = await import("@shared/schema-pg");

  const pool = new Pool({
    host: url.hostname,
    port: Number(url.port) || 5432,
    user: url.username,
    password: url.password,
    database: url.pathname.slice(1),
    ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : false,
  });

  _db = drizzle(pool, { schema });
  _tables = schema;
}

export const db = _db;
// Schema tables — same names for both MySQL and PostgreSQL
export const tables = _tables as typeof import("@shared/schema");
