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

// Auth middleware — supports session OR Bearer API token
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated()) return next();

  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const storedRaw = await storage.getSetting(`api_token_${token.substring(0, 8)}`);
    if (storedRaw) {
      const { userId, hash } = JSON.parse(storedRaw);
      const valid = await bcrypt.compare(token, hash);
      if (valid) {
        const user = await storage.getUser(userId);
        if (user) {
          req.user = { id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin, isEnabled: user.isEnabled };
          return next();
        }
      }
    }
    return res.status(401).json({ error: "Invalid API token" });
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
        res.json({ id: user.id, username: user.username, email: user.email, isAdmin: user.isAdmin });
      } else {
        res.status(401).json({ error: "User not found" });
      }
    } else {
      res.status(401).json({ error: "Not authenticated" });
    }
  });

  // ========== API TOKEN ==========

  app.get("/api/auth/token", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const prefixKey = `api_token_prefix_${userId}`;
      const prefix = await storage.getSetting(prefixKey);
      res.json({ hasToken: !!prefix, prefix: prefix || null });
    } catch (error) {
      res.status(500).json({ error: "Failed to get token info" });
    }
  });

  app.post("/api/auth/token", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;

      // Revoke old token if exists
      const oldPrefix = await storage.getSetting(`api_token_prefix_${userId}`);
      if (oldPrefix) {
        await storage.setSetting(`api_token_${oldPrefix}`, "");
      }

      // Generate new token
      const token = crypto.randomBytes(32).toString("hex");
      const prefix = token.substring(0, 8);
      const hash = await bcrypt.hash(token, 10);

      await storage.setSetting(`api_token_${prefix}`, JSON.stringify({ userId, hash }));
      await storage.setSetting(`api_token_prefix_${userId}`, prefix);

      res.json({ token, prefix });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate token" });
    }
  });

  app.delete("/api/auth/token", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.id;
      const prefix = await storage.getSetting(`api_token_prefix_${userId}`);
      if (prefix) {
        await storage.setSetting(`api_token_${prefix}`, "");
        await storage.setSetting(`api_token_prefix_${userId}`, "");
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to revoke token" });
    }
  });

  // ========== CHANGE PASSWORD ==========

  app.post("/api/auth/change-password", requireAuth, async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: "currentPassword and newPassword are required" });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters" });
      }

      const user = await storage.getUser(req.user!.id);
      if (!user) return res.status(404).json({ error: "User not found" });

      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(req.user!.id, { password: hashed });

      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Change password error:", error);
      res.status(500).json({ error: "Failed to change password" });
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

  // ========== OUTGOING WEBHOOK CONFIG ==========

  app.get("/api/whatsapp/accounts/:id/whatsapp-webhook", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

      const webhookUrl = await storage.getSetting(`account_${accountId}_out_webhook_url`);
      const hasSecret = !!(await storage.getSetting(`account_${accountId}_out_webhook_secret`));

      res.json({ webhookUrl: webhookUrl || "", hasSecret });
    } catch (error) {
      console.error("[API] Error getting whatsapp webhook config:", error);
      res.status(500).json({ error: "Failed to get config" });
    }
  });

  app.post("/api/whatsapp/accounts/:id/whatsapp-webhook", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

      const { webhookUrl, webhookSecret } = req.body;

      if (webhookUrl !== undefined) {
        if (webhookUrl) {
          await storage.setSetting(`account_${accountId}_out_webhook_url`, webhookUrl);
        } else {
          // empty string = delete
          await storage.setSetting(`account_${accountId}_out_webhook_url`, "");
        }
      }
      if (webhookSecret) {
        await storage.setSetting(`account_${accountId}_out_webhook_secret`, webhookSecret);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[API] Error saving whatsapp webhook config:", error);
      res.status(500).json({ error: "Failed to save config" });
    }
  });

  // ========== BLOCKLIST ROUTES ==========

  app.get("/api/whatsapp/accounts/:id/blocklist", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

      const list = await connectionManager.fetchBlocklist(accountId);
      res.json({ blocklist: list });
    } catch (error: any) {
      console.error("[API] Error fetching blocklist:", error);
      res.status(500).json({ error: error.message || "Failed to fetch blocklist" });
    }
  });

  app.post("/api/whatsapp/accounts/:id/block", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });

      const { phoneNumber, action } = req.body;
      if (!phoneNumber || !["block", "unblock"].includes(action)) {
        return res.status(400).json({ error: "phoneNumber and action (block|unblock) are required" });
      }

      await connectionManager.updateBlockStatus(accountId, phoneNumber, action);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[API] Error updating block status:", error);
      res.status(500).json({ error: error.message || "Failed to update block status" });
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
      const syncAvatar = await storage.getSetting(`account_${accountId}_sync_avatar`);

      res.json({
        logEnabled: logEnabled !== "false",
        retentionMinutes: retentionMinutes ? parseInt(retentionMinutes) : 0,
        syncAvatar: syncAvatar !== "false",
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

      const { logEnabled, retentionMinutes, syncAvatar } = req.body;

      if (typeof logEnabled === "boolean") {
        await storage.setSetting(`account_${accountId}_log_enabled`, logEnabled.toString());
      }
      if (typeof retentionMinutes === "number") {
        await storage.setSetting(`account_${accountId}_log_retention_minutes`, retentionMinutes.toString());
      }
      if (typeof syncAvatar === "boolean") {
        await storage.setSetting(`account_${accountId}_sync_avatar`, syncAvatar.toString());
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

  // ========== WHATSAPP GROUPS ==========

  app.get("/api/whatsapp/accounts/:id/groups", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });
      if (!connectionManager.isConnected(accountId)) return res.status(400).json({ error: "WhatsApp not connected" });
      const groups = await connectionManager.getGroups(accountId);
      const list = Object.values(groups).map((g: any) => ({
        id: g.id,
        subject: g.subject,
        participantCount: g.participants?.length ?? 0,
        creation: g.creation,
        owner: g.owner,
        desc: g.desc,
      }));
      res.json(list);
    } catch (error) {
      console.error("[API] Error getting groups:", error);
      res.status(500).json({ error: "Failed to get groups" });
    }
  });

  app.get("/api/whatsapp/accounts/:id/groups/:jid", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });
      if (!connectionManager.isConnected(accountId)) return res.status(400).json({ error: "WhatsApp not connected" });
      const meta = await connectionManager.getGroupMetadata(accountId, req.params.jid);
      res.json(meta);
    } catch (error) {
      console.error("[API] Error getting group metadata:", error);
      res.status(500).json({ error: "Failed to get group metadata" });
    }
  });

  // ========== CONTACT INFO ==========

  app.get("/api/whatsapp/accounts/:id/contact/:phoneNumber", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) return res.status(403).json({ error: "Access denied" });
      if (!connectionManager.isConnected(accountId)) return res.status(400).json({ error: "WhatsApp not connected" });
      const info = await connectionManager.getContactInfo(accountId, req.params.phoneNumber);
      res.json(info);
    } catch (error) {
      console.error("[API] Error getting contact info:", error);
      res.status(500).json({ error: "Failed to get contact info" });
    }
  });

  // ========== SEND MESSAGE (manual/test) ==========

  app.post("/api/whatsapp/accounts/:id/send", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const { phoneNumber, content } = req.body;

      if (!phoneNumber || !content) {
        return res.status(400).json({ error: "phoneNumber and content are required" });
      }

      const account = await storage.getWhatsappAccount(accountId);
      if (!account) return res.status(404).json({ error: "Account not found" });
      if (account.userId !== req.user!.id && !req.user!.isAdmin) {
        return res.status(403).json({ error: "Access denied" });
      }
      if (!connectionManager.isConnected(accountId)) {
        return res.status(400).json({ error: "WhatsApp not connected" });
      }

      const result = await connectionManager.sendMessage(accountId, phoneNumber, content);
      res.json({ success: true, key: result?.key });
    } catch (error) {
      console.error("[API] Error sending message:", error);
      res.status(500).json({ error: "Failed to send message" });
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

      // Reuse the existing ChatwootService instance so processedMessages dedup works correctly
      const chatwootService = connectionManager.getChatwootService(accountId) ?? new ChatwootService(chatwootConfig, accountId);
      const result = await chatwootService.processWebhook(parseResult.data);
      const chatwootMsgId = parseResult.data.id ? String(parseResult.data.id) : null;

      // Typing presence: forward agent typing state to WhatsApp
      if ((result.shouldTyping || result.shouldTypingOff) && result.phoneNumber) {
        try {
          const presence = result.shouldTyping ? "composing" : "paused";
          await connectionManager.sendPresenceUpdate(accountId, result.phoneNumber, presence);
          console.log(`[Webhook] Account ${accountId} sent presence '${presence}' to ${result.phoneNumber}`);
        } catch (e) {
          console.error(`[Webhook] Failed to send presence:`, e);
        }
      }

      // Delete: agent deleted a message in Chatwoot → delete on WhatsApp
      if (result.shouldDeleteMessage && result.chatwootMessageIdToDelete && result.phoneNumber) {
        try {
          const log = await storage.getMessageByChatwootId(accountId, result.chatwootMessageIdToDelete);
          if (log?.whatsappMessageId) {
            const jid = result.phoneNumber.includes("@") ? result.phoneNumber : `${result.phoneNumber}@s.whatsapp.net`;
            await connectionManager.deleteWhatsAppMessage(accountId, jid, log.whatsappMessageId, log.direction === "outgoing");
            console.log(`[Webhook] Account ${accountId} deleted WA message ${log.whatsappMessageId}`);
          } else {
            console.warn(`[Webhook] No WA message ID found for Chatwoot message ${result.chatwootMessageIdToDelete}`);
          }
        } catch (e) {
          console.error(`[Webhook] Failed to delete WA message:`, e);
        }
      }

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
              "sent",
              chatwootMsgId
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
                  undefined,
                  attachment.name
                );

                await chatwootService.logOutgoingMessage(
                  result.phoneNumber,
                  `[Media: ${attachment.type}] ${attachment.name || "attachment"}`,
                  mediaResult?.key?.id || null,
                  "sent",
                  chatwootMsgId
                );

                console.log(`[Webhook] Account ${accountId} sent media to ${result.phoneNumber}: ${attachment.type}`);
              } catch (mediaError) {
                console.error(`[Webhook] Failed to send media attachment:`, mediaError);

                await chatwootService.logOutgoingMessage(
                  result.phoneNumber,
                  `[Media: ${attachment.type}] Failed to send`,
                  null,
                  "failed",
                  chatwootMsgId
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
              "failed",
              chatwootMsgId
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
