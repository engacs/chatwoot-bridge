import { relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, json, serial, boolean } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: text("password").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const whatsappAccounts = pgTable("whatsapp_accounts", {
  id: serial("id").primaryKey(),
  userId: serial("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  phoneNumber: text("phone_number"),
  status: varchar("status", { length: 50 }).notNull().default("disconnected"),
  sessionPath: text("session_path").notNull(),
  qrCode: text("qr_code"),
  lastConnectedAt: timestamp("last_connected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const chatwootConfigs = pgTable("chatwoot_configs", {
  id: serial("id").primaryKey(),
  whatsappAccountId: serial("whatsapp_account_id").notNull().unique().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  baseUrl: text("base_url").notNull(),
  apiToken: text("api_token").notNull(),
  inboxId: text("inbox_id").notNull(),
  accountId: text("account_id").notNull(),
  webhookSecret: text("webhook_secret"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messageLogs = pgTable("message_logs", {
  id: serial("id").primaryKey(),
  whatsappAccountId: serial("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  remoteJid: text("remote_jid").notNull(),
  remoteName: text("remote_name"),
  chatwootMessageId: text("chatwoot_message_id"),
  whatsappMessageId: text("whatsapp_message_id"),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  whatsappAccountId: serial("whatsapp_account_id").notNull().references(() => whatsappAccounts.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  payload: json("payload").notNull(),
  success: boolean("success").notNull().default(false),
  error: text("error"),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export const webhookLogs = pgTable("webhook_logs", {
  id: serial("id").primaryKey(),
  whatsappAccountId: serial("whatsapp_account_id").references(() => whatsappAccounts.id, { onDelete: "set null" }),
  direction: text("direction").notNull().default("incoming"),
  method: text("method").notNull(),
  url: text("url").notNull(),
  headers: json("headers").notNull(),
  body: json("body").notNull(),
  statusCode: serial("status_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  whatsappAccounts: many(whatsappAccounts),
}));

export const whatsappAccountsRelations = relations(whatsappAccounts, ({ one, many }) => ({
  user: one(users, { fields: [whatsappAccounts.userId], references: [users.id] }),
  chatwootConfig: one(chatwootConfigs),
  messageLogs: many(messageLogs),
  webhookEvents: many(webhookEvents),
}));

export const chatwootConfigsRelations = relations(chatwootConfigs, ({ one }) => ({
  whatsappAccount: one(whatsappAccounts, { fields: [chatwootConfigs.whatsappAccountId], references: [whatsappAccounts.id] }),
}));

export const messageLogsRelations = relations(messageLogs, ({ one }) => ({
  whatsappAccount: one(whatsappAccounts, { fields: [messageLogs.whatsappAccountId], references: [whatsappAccounts.id] }),
}));

export const webhookEventsRelations = relations(webhookEvents, ({ one }) => ({
  whatsappAccount: one(whatsappAccounts, { fields: [webhookEvents.whatsappAccountId], references: [whatsappAccounts.id] }),
}));
