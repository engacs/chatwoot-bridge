import "dotenv/config";
import { storage } from "../server/storage";

async function listUsers() {
  const users = await storage.getAllUsers();
  console.log(JSON.stringify(users.map(u => ({ id: u.id, username: u.username, isAdmin: u.isAdmin })), null, 2));
}

listUsers().catch(console.error).finally(() => process.exit());
