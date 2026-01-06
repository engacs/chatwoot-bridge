import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import crypto from "crypto";
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
      req.login({ id: user.id, username: user.username, email: user.email }, (err) => {
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

  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (req.isAuthenticated()) {
      res.json(req.user);
    } else {
      res.status(401).json({ error: "Not authenticated" });
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
      
      if (account.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      res.json(account);
    } catch (error) {
      console.error("[API] Error getting account:", error);
      res.status(500).json({ error: "Failed to get account" });
    }
  });

  app.delete("/api/whatsapp/accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      // Disconnect if connected
      await connectionManager.disconnectAccount(accountId);
      
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
      
      if (account.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      await connectionManager.initializeAccount(accountId);
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
      
      if (account.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      await connectionManager.disconnectAccount(accountId);
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
      
      if (account.userId !== req.user!.id) {
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
      
      if (account.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const { baseUrl, apiToken, inboxId, accountId: chatwootAccountId, webhookSecret } = req.body;

      if (!baseUrl || !apiToken || !inboxId || !chatwootAccountId) {
        return res.status(400).json({ error: "All Chatwoot fields are required" });
      }

      const config = await storage.upsertChatwootConfig({
        whatsappAccountId: accountId,
        baseUrl,
        apiToken,
        inboxId,
        accountId: chatwootAccountId,
        webhookSecret: webhookSecret || null,
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

  // ========== MESSAGE LOGS ROUTE ==========

  app.get("/api/whatsapp/accounts/:id/logs", requireAuth, async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.id);
      const account = await storage.getWhatsappAccount(accountId);
      
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      if (account.userId !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const logs = await storage.getMessageLogs(accountId, 100);
      res.json(logs);
    } catch (error) {
      console.error("[API] Error getting logs:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  // ========== WEBHOOK ROUTE ==========

  app.post("/api/webhook/chatwoot/:accountId", async (req: Request, res: Response) => {
    try {
      const accountId = parseInt(req.params.accountId);
      
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
        
        const expectedSignature = crypto
          .createHmac("sha256", chatwootConfig.webhookSecret)
          .update(JSON.stringify(req.body))
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
