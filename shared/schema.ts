import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type ConnectionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

export interface WhatsAppSession {
  id: string;
  status: ConnectionStatus;
  qrCode: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  connectedSince: string | null;
}

export interface MessageLog {
  id: string;
  direction: "incoming" | "outgoing";
  remoteJid: string;
  remoteName: string | null;
  chatwootMessageId: string | null;
  whatsappMessageId: string | null;
  content: string;
  status: "pending" | "sent" | "delivered" | "failed";
  timestamp: string;
}

export interface WebhookEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  processedAt: string;
  success: boolean;
  error: string | null;
}

export interface ChatwootConfig {
  baseUrl: string;
  apiToken: string;
  inboxId: string;
  accountId: string;
}

export interface SystemStatus {
  whatsapp: ConnectionStatus;
  chatwoot: "connected" | "disconnected" | "error";
  lastError: string | null;
}

export const messageLogSchema = z.object({
  id: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  remoteJid: z.string(),
  remoteName: z.string().nullable(),
  chatwootMessageId: z.string().nullable(),
  whatsappMessageId: z.string().nullable(),
  content: z.string(),
  status: z.enum(["pending", "sent", "delivered", "failed"]),
  timestamp: z.string(),
});

export const webhookEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  processedAt: z.string(),
  success: z.boolean(),
  error: z.string().nullable(),
});

export const chatwootWebhookPayload = z.object({
  event: z.string(),
  id: z.number().optional(),
  content: z.string().optional(),
  content_type: z.string().optional(),
  message_type: z.string().optional(),
  conversation: z.object({
    id: z.number(),
    inbox_id: z.number(),
    contact_inbox: z.object({
      source_id: z.string(),
    }).optional(),
    meta: z.object({
      sender: z.object({
        id: z.number(),
        name: z.string().optional(),
        phone_number: z.string().optional(),
      }).optional(),
    }).optional(),
  }).optional(),
  sender: z.object({
    id: z.number(),
    type: z.string(),
  }).optional(),
});

export type ChatwootWebhookPayload = z.infer<typeof chatwootWebhookPayload>;
