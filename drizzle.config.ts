import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const url = new URL(process.env.DATABASE_URL);
const isPg = !url.protocol.startsWith("mysql");

export default defineConfig(
  isPg
    ? {
        out: "./migrations",
        schema: "./shared/schema-pg.ts",
        dialect: "postgresql",
        dbCredentials: {
          host: url.hostname,
          port: Number(url.port) || 5432,
          user: url.username,
          password: url.password,
          database: url.pathname.slice(1),
        },
      }
    : {
        out: "./migrations",
        schema: "./shared/schema.ts",
        dialect: "mysql",
        dbCredentials: {
          host: url.hostname,
          port: Number(url.port) || 3306,
          user: url.username,
          password: url.password,
          database: url.pathname.slice(1),
        },
      }
);
