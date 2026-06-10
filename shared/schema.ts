import { sql, relations } from "drizzle-orm";
import { mysqlTable, text, varchar, timestamp, json, int, boolean } from "drizzle-orm/mysql-core";
// Note: unique() on MySQL requires varchar (not text) — text columns have no length limit and can't be indexed directly
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table - for authentication
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// App settings table - for global configuration
export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// WhatsApp accounts - each user can have multiple
export const whatsappAccounts = mysqlTable("whatsapp_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  phoneNumber: text("phone_number"),
  status: varchar("status", { length: 50 }).notNull().default("disconnected"),
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
export const chatwootConfigs = mysqlTable("chatwoot_configs", {
  id: int("id").autoincrement().primaryKey(),
  whatsappAccountId: int("whatsapp_account_id").notNull().unique().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
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
export const messageLogs = mysqlTable("message_logs", {
  id: int("id").autoincrement().primaryKey(),
  whatsappAccountId: int("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  remoteJid: text("remote_jid").notNull(),
  remoteName: text("remote_name"),
  chatwootMessageId: text("chatwoot_message_id"),
  chatwootConversationId: int("chatwoot_conversation_id"),
  whatsappMessageId: text("whatsapp_message_id"),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MessageLog = typeof messageLogs.$inferSelect;

// Webhook events - per WhatsApp account
export const webhookEvents = mysqlTable("webhook_events", {
  id: int("id").autoincrement().primaryKey(),
  whatsappAccountId: int("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: json("payload").notNull(),
  success: boolean("success").notNull().default(false),
  error: text("error"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;

// Debug Webhook logs - separate from processed events
export const webhookLogs = mysqlTable("webhook_logs", {
  id: int("id").autoincrement().primaryKey(),
  whatsappAccountId: int("whatsapp_account_id").references(() => whatsappAccounts.id, { onDelete: "set null" }),
  direction: text("direction").notNull().default("incoming"),
  method: text("method").notNull(),
  url: text("url").notNull(),
  headers: json("headers").notNull(),
  body: json("body").notNull(),
  statusCode: int("status_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type WebhookLog = typeof webhookLogs.$inferSelect;
export type InsertWebhookLog = typeof webhookLogs.$inferInsert;

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

// Zod schemas for validation - made permissive to accept all Chatwoot webhook events
export const chatwootWebhookPayload = z.object({
  event: z.string(),
  id: z.number().optional(),
  content: z.string().optional().nullable(),
  content_type: z.string().optional(),
  message_type: z.string().optional(),
  private: z.boolean().optional(),
  source_id: z.string().optional().nullable(),
  inbox: z.object({
    id: z.number(),
    name: z.string().optional(),
  }).optional(),
  conversation: z.object({
    id: z.number(),
    inbox_id: z.number().optional(),
    status: z.string().optional(),
    contact_inbox: z.object({
      source_id: z.string().optional().nullable(),
    }).optional().nullable(),
    meta: z.object({
      sender: z.object({
        id: z.number(),
        name: z.string().optional().nullable(),
        phone_number: z.string().optional().nullable(),
        identifier: z.string().optional().nullable(),
      }).optional(),
    }).optional(),
  }).optional(),
  sender: z.object({
    id: z.number().optional(),
    type: z.string().optional(),
    name: z.string().optional(),
  }).optional(),
  account: z.object({
    id: z.number(),
    name: z.string().optional(),
  }).optional(),
  attachments: z.array(z.any()).optional(),
}).passthrough(); // Allow any additional fields

export type ChatwootWebhookPayload = z.infer<typeof chatwootWebhookPayload>;
