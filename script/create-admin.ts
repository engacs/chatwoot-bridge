import "dotenv/config";
import { storage } from "../server/storage";
import bcrypt from "bcrypt";

async function createAdmin() {
  const username = "admin";
  const email = "admin@example.com";
  const password = "adminPassword123";
  
  const hashedPassword = await bcrypt.hash(password, 10);
  
  const user = await storage.createUser({
    username,
    email,
    password: hashedPassword,
  });
  
  await storage.updateUser(user.id, { isAdmin: true });
  
  console.log(`Admin user created:`);
  console.log(`Username: ${username}`);
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
}

createAdmin().catch(console.error).finally(() => process.exit());
