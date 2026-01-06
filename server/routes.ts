import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { whatsappService } from "./services/whatsapp";
import { chatwootService } from "./services/chatwoot";
import { chatwootWebhookPayload } from "@shared/schema";
import crypto from "crypto";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  const chatwootBaseUrl = process.env.CHATWOOT_BASE_URL;
  const chatwootApiToken = process.env.CHATWOOT_API_TOKEN;
  const chatwootInboxId = process.env.CHATWOOT_INBOX_ID;
  const chatwootAccountId = process.env.CHATWOOT_ACCOUNT_ID;
  const webhookSecret = process.env.CHATWOOT_WEBHOOK_SECRET;

  if (chatwootBaseUrl && chatwootApiToken && chatwootInboxId && chatwootAccountId) {
    chatwootService.configure(chatwootBaseUrl, chatwootApiToken, chatwootInboxId, chatwootAccountId);
  }

  whatsappService.on("message", async (message) => {
    console.log(`[Routes] Received WhatsApp message from ${message.remoteJid}`);
    
    if (chatwootService.isConfigured()) {
      await chatwootService.sendMessageToChatwoot(
        message.remoteJid,
        message.remoteName,
        message.content,
        message.messageId
      );
    } else {
      await storage.addMessageLog({
        direction: "incoming",
        remoteJid: message.remoteJid,
        remoteName: message.remoteName,
        chatwootMessageId: null,
        whatsappMessageId: message.messageId,
        content: message.content.substring(0, 200),
        status: "pending",
        timestamp: new Date().toISOString(),
      });
    }
  });

  whatsappService.on("status", (status) => {
    console.log(`[Routes] WhatsApp status changed: ${status}`);
  });

  whatsappService.on("error", (error) => {
    console.error(`[Routes] WhatsApp error: ${error}`);
  });

  // Auto-initialize WhatsApp on server startup to restore any existing session
  (async () => {
    try {
      console.log("[Routes] Auto-initializing WhatsApp service...");
      await whatsappService.initialize();
    } catch (error) {
      console.error("[Routes] Failed to auto-initialize WhatsApp:", error);
    }
  })();

  app.get("/api/session", async (_req: Request, res: Response) => {
    try {
      const session = await storage.getSession();
      res.json(session);
    } catch (error) {
      console.error("[API] Error getting session:", error);
      res.status(500).json({ error: "Failed to get session" });
    }
  });

  app.post("/api/session/connect", async (_req: Request, res: Response) => {
    try {
      const session = await storage.getSession();
      
      if (session.status === "connected") {
        return res.json({ message: "Already connected", session });
      }

      if (session.status === "connecting" || session.status === "qr_ready") {
        return res.json({ message: "Connection in progress", session });
      }

      whatsappService.initialize();
      
      res.json({ message: "Connecting...", session: await storage.getSession() });
    } catch (error) {
      console.error("[API] Error connecting:", error);
      res.status(500).json({ error: "Failed to connect" });
    }
  });

  app.post("/api/session/disconnect", async (_req: Request, res: Response) => {
    try {
      await whatsappService.disconnect();
      const session = await storage.getSession();
      res.json({ message: "Disconnected", session });
    } catch (error) {
      console.error("[API] Error disconnecting:", error);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  });

  app.get("/api/logs", async (_req: Request, res: Response) => {
    try {
      const logs = await storage.getMessageLogs(100);
      res.json(logs);
    } catch (error) {
      console.error("[API] Error getting logs:", error);
      res.status(500).json({ error: "Failed to get logs" });
    }
  });

  app.get("/api/webhooks", async (_req: Request, res: Response) => {
    try {
      const events = await storage.getWebhookEvents(50);
      res.json(events);
    } catch (error) {
      console.error("[API] Error getting webhook events:", error);
      res.status(500).json({ error: "Failed to get webhook events" });
    }
  });

  app.get("/api/chatwoot/config", (_req: Request, res: Response) => {
    const config = chatwootService.getConfig();
    res.json(config);
  });

  app.post("/api/webhook/chatwoot", async (req: Request, res: Response) => {
    try {
      const signature = req.headers["x-chatwoot-signature"] as string | undefined;
      
      // If webhook secret is configured, require and validate signature
      if (webhookSecret) {
        if (!signature) {
          console.warn("[Webhook] Missing signature header when secret is configured");
          return res.status(401).json({ error: "Missing signature" });
        }
        
        const expectedSignature = crypto
          .createHmac("sha256", webhookSecret)
          .update(JSON.stringify(req.body))
          .digest("hex");
        
        if (signature !== expectedSignature) {
          console.warn("[Webhook] Invalid signature");
          return res.status(401).json({ error: "Invalid signature" });
        }
      }

      const parseResult = chatwootWebhookPayload.safeParse(req.body);
      
      if (!parseResult.success) {
        console.warn("[Webhook] Invalid payload:", parseResult.error);
        await storage.addWebhookEvent({
          eventType: req.body?.event || "unknown",
          payload: req.body,
          processedAt: new Date().toISOString(),
          success: false,
          error: "Invalid payload format",
        });
        return res.status(400).json({ error: "Invalid payload" });
      }

      const payload = parseResult.data;
      console.log(`[Webhook] Received event: ${payload.event}`);

      await storage.addWebhookEvent({
        eventType: payload.event,
        payload: req.body,
        processedAt: new Date().toISOString(),
        success: true,
        error: null,
      });

      const result = await chatwootService.processWebhook(payload);

      if (result.shouldReply && result.phoneNumber && result.content) {
        console.log(`[Webhook] Sending reply to ${result.phoneNumber}`);
        
        const waResult = await whatsappService.sendMessage(result.phoneNumber, result.content);
        
        await chatwootService.logOutgoingMessage(
          result.phoneNumber,
          result.content,
          waResult?.key?.id || null,
          waResult ? "sent" : "failed"
        );
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[Webhook] Error processing:", error);
      
      await storage.addWebhookEvent({
        eventType: req.body?.event || "error",
        payload: req.body,
        processedAt: new Date().toISOString(),
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      whatsapp: whatsappService.isConnected() ? "connected" : "disconnected",
      chatwoot: chatwootService.isConfigured() ? "configured" : "not_configured",
      timestamp: new Date().toISOString(),
    });
  });

  return httpServer;
}
