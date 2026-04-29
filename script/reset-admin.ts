import "dotenv/config";
import { storage } from "../server/storage";
import bcrypt from "bcrypt";

async function resetAdmin() {
  const users = await storage.getAllUsers();
  const admin = users.find(u => u.isAdmin);
  
  if (!admin) {
    console.log("No admin user found.");
    return;
  }
  
  const newPassword = "adminPassword123";
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  await storage.updateUser(admin.id, { password: hashedPassword });
  
  console.log(`Password for admin user "${admin.username}" has been reset to: ${newPassword}`);
}

resetAdmin().catch(console.error).finally(() => process.exit());
