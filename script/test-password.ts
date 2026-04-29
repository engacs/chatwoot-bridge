import "dotenv/config";
import { storage } from "../server/storage";
import bcrypt from "bcrypt";

async function testPassword() {
  const users = await storage.getAllUsers();
  const admin = users.find(u => u.username === "admin");
  
  if (!admin) {
    console.log("No admin user found.");
    return;
  }
  
  const passwordToTest = "adminPassword123";
  const isValid = await bcrypt.compare(passwordToTest, admin.password);
  
  console.log(`Testing password for user: ${admin.username}`);
  console.log(`Stored hash: ${admin.password}`);
  console.log(`Password to test: ${passwordToTest}`);
  console.log(`Is valid? ${isValid}`);
}

testPassword().catch(console.error).finally(() => process.exit());
