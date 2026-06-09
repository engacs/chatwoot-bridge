import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { z } from "zod";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { connectionManager } from "./services/connection-manager";
import { ChatwootService } from "./services/chatwoot";
import { chatwootWebhookPayload, insertChatwootConfigSchema } from "@shared/schema";

// Auth middleware
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: "Not authenticated" });
}

// Admin middleware
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const user = await storage.getUser(req.user!.id);
  if (!user?.isAdmin) {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}

export async function registerRoutes(httpServer: Server, app: Express) {
  // Setup authentication
  setupAuth(app);

  // Initialize all WhatsApp accounts on startup
  connectionManager.initializeAllAccounts().catch((err) => {
    console.error("[Startup] Failed to initialize WhatsApp accounts:", err);
  });

  // ========== AUTH ROUTES ==========
  
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      // Check if signup is disabled
      const signupDisabled = await storage.getSetting("signup_disabled");
      if (signupDisabled === "true") {
        return res.status(403).json({ error: "Registration is currently disabled" });
      }

      const { username, email, password } = req.body;
      
      if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      // Check if user already exists
      const existingUsername = await storage.getUserByUsername(username);
      if (existingUsername) {
        return res.status(400).json({ error: "Username already taken" });
      }

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ error: "Email already registered" });
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        username,
        email,
        password: hashedPassword,
      });

      // Log the user in
      req.login({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, isEnabled: user.isEnabled }, (err) => {
        if (err) {
          return res.status(500).json({ error: "Failed to log in" });
        }
        res.json({ 
          id: user.id, 
          username: user.username, 
          email: user.email 
        });
      });
    } catch (error) {
      console.error("[Auth] Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/auth/login", (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate("local", (err: Error | null, user: Express.User | false, info: { message: string }) => {
      if (err) {
        return res.status(500).json({ error: "Login failed" });
      }
      if (!user) {
        return res.status(401).json({ error: info?.message || "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ error: "Login failed" });
        }
        res.json({ id: user.id, username: user.username, email: user.email });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (req.isAuthenticated()) {
      const user = await storage.getUser(req.user!.id);
      if (user) {
        res.json({ 
          id: user.id, 
          username: user.username, 
          email: user.email,
          isAdmin: user.isAdmin 
        });
      } else {
        res.status(401).json({ error: "User not found" });
      }
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  // ========== ADMIN ROUTES ==========

  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        isAdmin: u.isAdmin,
        isEnabled: u.isEnabled,
        createdAt: u.createdAt,
      })));
    } catch (error) {
      console.error("[Admin] Error getting users:", error);
      res.status(500).json({ error: "Failed to get users" });
    }
  });

  // Create user (admin only)
  app.post("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { username, email, password, isAdmin } = req.body;
      
      if (!username || !email || !password) {
        return res.status(400).json({ error: "Username, email, and password are required" });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) {
        return res.status(400).json({ error: "Email already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, email, password: hashedPassword });
      
      if (isAdmin) {
        await storage.updateUser(user.id, { isAdmin: true });
      }

      res.json({ id: user.id, username: user.username, email: user.email, isAdmin: isAdmin || false });
    } catch (error) {
      console.error("[Admin] Error creating user:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  app.get("/api/admin/accounts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accounts = await storage.getAllWhatsappAccounts();
      const users = await storage.getAllUsers();
      const userMap = new Map(users.map(u => [u.id, u.username]));
      
      const enrichedAccounts = accounts.map(acc => ({
        ...acc,
        ownerUsername: userMap.get(acc.userId) || "Unknown",
        isConnected: connectionManager.isConnected(acc.id),
      }));
      
      res.json(enrichedAccounts);
    } catch (error) {
      console.error("[Admin] Error getting all accounts:", error);
      res.status(500).json({ error: "Failed to get accounts" });
    }
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      const { isAdmin, isEnabled } = req.body;
      
      const updates: { isAdmin?: boolean; isEnabled?: boolean } = {};

      if (typeof isAdmin === "boolean") {
        // Prevent removing own admin status
        if (userId === req.user!.id && !isAdmin) {
          return res.status(400).json({ error: "Cannot remove your own admin status" });
        }
        updates.isAdmin = isAdmin;
      }

      if (typeof isEnabled === "boolean") {
        // Prevent disabling self
        if (userId === req.user!.id && !isEnabled) {
          return res.status(400).json({ error: "Cannot disable your own account" });
        }
        updates.isEnabled = isEnabled;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }

      const updated = await storage.updateUser(userId, updates);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ 
        id: updated.id, 
        username: updated.username, 
        email: updated.email, 
        isAdmin: updated.isAdmin,
        isEnabled: updated.isEnabled
      });
    } catch (error) {
      console.error("[Admin] Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Change user password (admin only)
  app.patch("/api/admin/users/:id/password", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      const { password } = req.body;
      
      if (!password || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const updated = await storage.updateUser(userId, { password: hashedPassword });
      
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error changing password:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.params.id);
      
      if (userId === req.user!.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }

      // Delete all user's WhatsApp accounts first
      const accounts = await storage.getWhatsappAccountsByUser(userId);
      for (const account of accounts) {
        await connectionManager.disconnectAccount(account.id);
        await storage.deleteWhatsappAccount(account.id);
      }

      const deleted = await storage.deleteUser(userId);
      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  app.get("/api/admin/stats", requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      const accounts = await storage.getAllWhatsappAccounts();
      
      const connectedCount = accounts.filter(acc => connectionManager.isConnected(acc.id)).length;
      
      res.json({
        totalUsers: users.length,
        totalAccounts: accounts.length,
        connectedAccounts: connectedCount,
        disconnectedAccounts: accounts.length - connectedCount,
      });
    } catch (error) {
      console.error("[Admin] Error getting stats:", error);
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  // App settings routes (admin only)
  app.get("/api/admin/settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const signupDisabled = await storage.getSetting("signup_disabled");
      res.json({
        signupDisabled: signupDisabled === "true",
      });
    } catch (error) {
      console.error("[Admin] Error getting settings:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.patch("/api/admin/settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { signupDisabled } = req.body;
      
      if (typeof signupDisabled === "boolean") {
        await storage.setSetting("signup_disabled", signupDisabled.toString());
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Admin] Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // ========== WHATSAPP ACCOUNT ROUTES ==========

  app.get("/api/whatsapp/accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const accounts = await storage.getWhatsappAccountsByUser(req.user!.id);
      res.json(accounts);
    } catch (error) {
      console.error("[API] Error getting accounts:", error);
      res.status(500).json({ error: "Failed to get accounts" });
    }
  });

  app.post("/api/whatsapp/accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      const { label } = req.body;
      
      if (!label) {
        return res.status(400).json({ error: "Label is required" });
      }

      // Generate unique session path
      const sessionPath = `user_${req.user!.id}_${Date.now()}`;

      const account = await storage.createWhatsappAccount({
        userId: req.user!.id,
        label,
        sessionPath,
      });

      res.json(account);
    } catch (error) {
      console.error("[API] Error creating account:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.get("/api/whatsapp/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(account);
    } catch (error) {
      console.error("[API] Error getting account:", error);
      res.status(500).json({ error: "Failed to get account" });
    }
  });

  app.patch("/api/whatsapp/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const { label } = req.body;
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!label || typeof label !== "string" || label.trim().length === 0) {
        return res.status(400).json({ error: "Label is required" });
      }

      const updated = await storage.updateWhatsappAccount(accountId, { label: label.trim() });
      res.json(updated);
    } catch (error) {
      console.error("[API] Error updating account:", error);
      res.status(500).json({ error: "Failed to update account" });
    }
  });

  app.delete("/api/whatsapp/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Disconnect if connected and clear session files
      await connectionManager.disconnectAccount(accountId, true);
      
      // Delete from database
      await storage.deleteWhatsappAccount(accountId);

      res.json({ success: true });
    } catch (error) {
      console.error("[API] Error deleting account:", error);
      res.status(500).json({ error: "Failed to delete account" });
    }
  });

  // ========== WHATSAPP CONNECTION ROUTES ==========

  app.post("/api/whatsapp/accounts/:id/connect", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      await connectionManager.initializeAccount(accountId, true);
      res.json({ success: true, status: "connecting" });
    } catch (error) {
      console.error("[API] Error connecting account:", error);
      res.status(500).json({ error: "Failed to connect" });
    }
  });

  app.post("/api/whatsapp/accounts/:id/disconnect", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      await connectionManager.disconnectAccount(accountId, true);
      res.json({ success: true, status: "disconnected" });
    } catch (error) {
      console.error("[API] Error disconnecting account:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  // ========== CHATWOOT CONFIG ROUTES ==========

  app.get("/api/whatsapp/accounts/:id/chatwoot", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const config = await storage.getChatwootConfig(accountId);
      if (!config) {
        return res.json({ configured: false });
      }

      // Don't expose the API token
      res.json({
        configured: true,
        baseUrl: config.baseUrl,
        inboxId: config.inboxId,
        accountId: config.accountId,
        hasWebhookSecret: !!config.webhookSecret,
      });
    } catch (error) {
      console.error("[API] Error getting Chatwoot config:", error);
      res.status(500).json({ error: "Failed to get config" });
    }
  });

  app.post("/api/whatsapp/accounts/:id/chatwoot", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { baseUrl, apiToken, inboxId, accountId: chatwootAccountId, webhookSecret } = req.body;

      const existingConfig = await storage.getChatwootConfig(accountId);

      if (!baseUrl || !inboxId || !chatwootAccountId) {
        return res.status(400).json({ error: "Base URL, inbox ID, and account ID are required" });
      }
      if (!apiToken && !existingConfig) {
        return res.status(400).json({ error: "API token is required for new configurations" });
      }

      const resolvedApiToken = apiToken || existingConfig!.apiToken;

      const config = await storage.upsertChatwootConfig({
        whatsappAccountId: accountId,
        baseUrl,
        apiToken: resolvedApiToken,
        inboxId,
        accountId: chatwootAccountId,
        webhookSecret: webhookSecret || existingConfig?.webhookSecret || null,
      });

      // Update connection manager with new config
      await connectionManager.updateChatwootConfig(accountId, config);

      res.json({ 
        success: true,
        configured: true,
        baseUrl: config.baseUrl,
        inboxId: config.inboxId,
        accountId: config.accountId,
      });
    } catch (error) {
      console.error("[API] Error saving Chatwoot config:", error);
      res.status(500).json({ error: "Failed to save config" });
    }
  });

  // ========== LOG SETTINGS ROUTES ==========

  app.get("/api/whatsapp/accounts/:id/log-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

      const logEnabled = await storage.getSetting(`account_${accountId}_log_enabled`);
      const retentionMinutes = await storage.getSetting(`account_${accountId}_log_retention_minutes`);

      res.json({
        logEnabled: logEnabled !== "false",
        retentionMinutes: retentionMinutes ? parseInt(retentionMinutes) : 0,
      });
    } catch (error) {
      console.error("[API] Error getting log settings:", error);
      res.status(500).json({ error: "Failed to get log settings" });
    }
  });

  app.post("/api/whatsapp/accounts/:id/log-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

      const { logEnabled, retentionMinutes } = req.body;

      if (typeof logEnabled === "boolean") {
        await storage.setSetting(`account_${accountId}_log_enabled`, logEnabled.toString());
      }
      if (typeof retentionMinutes === "number") {
        await storage.setSetting(`account_${accountId}_log_retention_minutes`, retentionMinutes.toString());
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[API] Error saving log settings:", error);
      res.status(500).json({ error: "Failed to save log settings" });
    }
  });

  // ========== MESSAGE LOGS ROUTE ==========

  app.get("/api/whatsapp/accounts/:id/logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const logs = await storage.getMessageLogs(accountId, 100);
      res.json(logs);
    } catch (error) {
      console.error("[API] Error getting logs:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // Export message logs
  app.get("/api/whatsapp/accounts/:id/logs/export", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const formatParam = req.query.format as string;
      const format = formatParam === "csv" ? "csv" : "json";
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const logs = await storage.getMessageLogs(accountId, 10000);
      const filename = `messages_${account.label.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`;

      const escapeCSV = (value: string | null | undefined): string => {
        if (value === null || value === undefined) return '""';
        let str = String(value);
        // Prevent formula injection: prefix cells starting with =, +, @, - with a tab
        if (/^[=+@\-]/.test(str)) {
          str = `\t${str}`;
        }
        const escaped = str.replace(/"/g, '""');
        return `"${escaped}"`;
      };

      if (format === "csv") {
        const csvHeader = "ID,Direction,Phone,Name,Content,Status,Date\n";
        const csvRows = logs.map(log => {
          const phone = log.remoteJid?.replace("@s.whatsapp.net", "") || "";
          const date = new Date(log.createdAt).toISOString();
          return [
            log.id,
            escapeCSV(log.direction),
            escapeCSV(phone),
            escapeCSV(log.remoteName),
            escapeCSV(log.content),
            escapeCSV(log.status),
            escapeCSV(date)
          ].join(",");
        }).join("\n");
        
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
        res.send(csvHeader + csvRows);
      } else {
        res.type("application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
        res.send(JSON.stringify(logs, null, 2));
      }
    } catch (error) {
      console.error("[API] Error exporting logs:", error);
      res.status(500).json({ error: "Failed to export logs" });
    }
  });

  app.get("/api/whatsapp/accounts/:id/webhooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const logs = await storage.getWebhookLogs(accountId, 100);
      res.json(logs);
    } catch (error) {
      console.error("[API] Error getting webhook logs:", error);
      res.status(500).json({ error: "Failed to get webhook logs" });
    }
  });

  app.delete("/api/whatsapp/accounts/:id/webhooks", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      const deleted = await storage.clearWebhookLogs(accountId);
      res.json({ success: true, deleted });
    } catch (error) {
      console.error("[API] Error clearing webhook logs:", error);
      res.status(500).json({ error: "Failed to clear webhook logs" });
    }
  });

  // ========== USER PROFILE ROUTE ==========

  app.get("/api/whatsapp/accounts/:id/profile/:phoneNumber", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const phoneNumber = req.params.phoneNumber;
      
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }

      if (!connectionManager.isConnected(accountId)) {
        return res.status(400).json({ error: "WhatsApp not connected" });
      }

      const profile = await connectionManager.getUserProfile(accountId, phoneNumber);
      res.json(profile);
    } catch (error) {
      console.error("[API] Error getting user profile:", error);
      res.status(500).json({ error: "Failed to get user profile" });
    }
  });

  // ========== WEBHOOK ROUTE ==========

  app.post("/api/webhook/chatwoot/:accountId", async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.accountId);
      if (Number.isNaN(accountId)) {
        return res.status(400).json({ error: "Invalid account ID" });
      }

      const account = await storage.getWhatsappAccount(accountId);
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }

      const chatwootConfig = await storage.getChatwootConfig(accountId);
      if (!chatwootConfig) {
        return res.status(400).json({ error: "Chatwoot not configured for this account" });
      }

      // Validate webhook signature if secret is configured
      const signature = req.headers["x-chatwoot-signature"] as string | undefined;
      if (chatwootConfig.webhookSecret) {
        if (!signature) {
          console.warn(`[Webhook] Missing signature for account ${accountId}`);
          return res.status(401).json({ error: "Missing signature" });
        }
        
        const rawBody = req.rawBody as Buffer;
        const expectedSignature = crypto
          .createHmac("sha256", chatwootConfig.webhookSecret)
          .update(rawBody)
          .digest("hex");
        
        if (signature !== expectedSignature) {
          console.warn(`[Webhook] Invalid signature for account ${accountId}`);
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const parseResult = chatwootWebhookPayload.safeParse(req.body);
      if (!parseResult.success) {
        console.warn("[Webhook] Invalid payload:", JSON.stringify(parseResult.error.errors));
        console.warn("[Webhook] Received body:", JSON.stringify(req.body).substring(0, 500));
        return res.status(400).json({ error: "Invalid webhook payload" });
      }

      console.log(`[Webhook] Account ${accountId} received event: ${parseResult.data.event}`);
      if (parseResult.data.content) {
        console.log(`[Webhook] Content: ${parseResult.data.content.substring(0, 100)}`);
      }

      // Log webhook event
      await storage.addWebhookEvent({
        whatsappAccountId: accountId,
        eventType: parseResult.data.event,
        payload: req.body,
        success: true,
        error: null,
      });

      // Log to debug webhook logs
      await storage.addWebhookLog({
        whatsappAccountId: accountId,
        direction: "incoming",
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        body: req.body,
        statusCode: 200,
      });

      // Process the webhook
      const chatwootService = new ChatwootService(chatwootConfig, accountId);
      const result = await chatwootService.processWebhook(parseResult.data);

      if (result.shouldReply && result.phoneNumber) {
        try {
          // Send text content if present
          if (result.content) {
            const msgResult = await connectionManager.sendMessage(
              accountId,
              result.phoneNumber,
              result.content
            );

            await chatwootService.logOutgoingMessage(
              result.phoneNumber,
              result.content,
              msgResult?.key?.id || null,
              "sent"
            );

            console.log(`[Webhook] Account ${accountId} sent message to ${result.phoneNumber}`);
          }

          // Send media attachments if present
          if (result.attachments && result.attachments.length > 0) {
            for (const attachment of result.attachments) {
              try {
                console.log(`[Webhook] Sending attachment: ${attachment.type} - ${attachment.url}`);
                
                const mediaResult = await connectionManager.sendMediaMessage(
                  accountId,
                  result.phoneNumber,
                  attachment.url,
                  attachment.type,
                  undefined, // caption already sent with text
                  attachment.name
                );

                await chatwootService.logOutgoingMessage(
                  result.phoneNumber,
                  `[Media: ${attachment.type}] ${attachment.name || "attachment"}`,
                  mediaResult?.key?.id || null,
                  "sent"
                );

                console.log(`[Webhook] Account ${accountId} sent media to ${result.phoneNumber}: ${attachment.type}`);
              } catch (mediaError) {
                console.error(`[Webhook] Failed to send media attachment:`, mediaError);
                
                await chatwootService.logOutgoingMessage(
                  result.phoneNumber,
                  `[Media: ${attachment.type}] Failed to send`,
                  null,
                  "failed"
                );
              }
            }
          }
        } catch (error) {
          console.error(`[Webhook] Failed to send message for account ${accountId}:`, error);
          
          if (result.content) {
            await chatwootService.logOutgoingMessage(
              result.phoneNumber,
              result.content,
              null,
              "failed"
            );
          }
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Webhook] Error:", error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });

  // ========== HEALTH CHECK ==========

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });
}
