import "dotenv/config";
import { pool } from "../server/db";

async function checkSessions() {
  try {
    const res = await pool.query("SELECT count(*) FROM user_sessions");
    console.log("Session table exists, count:", res.rows[0].count);
  } catch (e: any) {
    console.error("Session table error:", e.message);
  } finally {
    await pool.end();
  }
}

checkSessions().catch(console.error).finally(() => process.exit());
