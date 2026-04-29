import "dotenv/config";
import { pool } from "../server/db";

async function createSessionTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    )
    WITH (OIDS=FALSE);

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_sessions_pkey') THEN
        ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
      END IF;
    END
    $$;

    CREATE INDEX IF NOT EXISTS "IX_session_expire" ON "user_sessions" ("expire");
  `;

  try {
    await pool.query(sql);
    console.log("Session table created successfully or already exists.");
  } catch (e: any) {
    console.error("Error creating session table:", e.message);
  } finally {
    await pool.end();
  }
}

createSessionTable().catch(console.error).finally(() => process.exit());
