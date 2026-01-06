import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, jsonb, serial, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table - for authentication
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// WhatsApp accounts - each user can have multiple
export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  phoneNumber: text("phone_number"),
  status: text("status").notNull().default("disconnected"),
  sessionPath: text("session_path").notNull(),
  qrCode: text("qr_code"),
  lastConnectedAt: timestamp("last_connected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWhatsappAccountSchema = createInsertSchema(whatsappAccounts).pick({
  userId: true,
  label: true,
});

export type InsertWhatsappAccount = z.infer<typeof insertWhatsappAccountSchema>;
export type WhatsappAccount = typeof whatsappAccounts.$inferSelect;

// Chatwoot configs - one per WhatsApp account
export const chatwootConfigs = pgTable("chatwoot_configs", {
  id: serial("id").primaryKey(),
  whatsappAccountId: integer("whatsapp_account_id").notNull().unique().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull(),
  apiToken: text("api_token").notNull(),
  inboxId: text("inbox_id").notNull(),
  accountId: text("account_id").notNull(),
  webhookSecret: text("webhook_secret"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertChatwootConfigSchema = createInsertSchema(chatwootConfigs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertChatwootConfig = z.infer<typeof insertChatwootConfigSchema>;
export type ChatwootConfig = typeof chatwootConfigs.$inferSelect;

// Message logs - per WhatsApp account
export const messageLogs = pgTable("message_logs", {
  id: serial("id").primaryKey(),
  whatsappAccountId: integer("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  remoteJid: text("remote_jid").notNull(),
  remoteName: text("remote_name"),
  chatwootMessageId: text("chatwoot_message_id"),
  whatsappMessageId: text("whatsapp_message_id"),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MessageLog = typeof messageLogs.$inferSelect;

// Webhook events - per WhatsApp account
export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  whatsappAccountId: integer("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  success: boolean("success").notNull().default(false),
  error: text("error"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;

// Relations - defined after all tables
export const usersRelations = relations(users, ({ many }) => ({
  whatsappAccounts: many(whatsappAccounts),
}));

export const whatsappAccountsRelations = relations(whatsappAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [whatsappAccounts.userId],
    references: [users.id],
  }),
  chatwootConfig: one(chatwootConfigs),
  messageLogs: many(messageLogs),
  webhookEvents: many(webhookEvents),
}));

export const chatwootConfigsRelations = relations(chatwootConfigs, ({ one }) => ({
  whatsappAccount: one(whatsappAccounts, {
    fields: [chatwootConfigs.whatsappAccountId],
    references: [whatsappAccounts.id],
  }),
}));

export const messageLogsRelations = relations(messageLogs, ({ one }) => ({
  whatsappAccount: one(whatsappAccounts, {
    fields: [messageLogs.whatsappAccountId],
    references: [whatsappAccounts.id],
  }),
}));

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  whatsappAccount: one(whatsappAccounts, {
    fields: [webhookEvents.whatsappAccountId],
    references: [whatsappAccounts.id],
  }),
}));

// Connection status type
export type ConnectionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

// Zod schemas for validation
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
