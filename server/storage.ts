import { db, tables, dbType } from "./db";
import { eq, desc, and, lt } from "drizzle-orm";

// Pull table references — same export names for both MySQL and PostgreSQL schemas
const {
  users, whatsappAccounts, chatwootConfigs,
  messageLogs, webhookEvents, webhookLogs, appSettings,
} = tables;

// Re-export types (always sourced from MySQL schema for TypeScript — shapes are identical)
export type {
  User, InsertUser,
  WhatsappAccount, InsertWhatsappAccount,
  ChatwootConfig, InsertChatwootConfig,
  MessageLog, WebhookEvent, WebhookLog, AppSetting,
} from "@shared/schema";

import type {
  User, InsertUser,
  WhatsappAccount, InsertWhatsappAccount,
  ChatwootConfig, InsertChatwootConfig,
  MessageLog, WebhookEvent, WebhookLog,
} from "@shared/schema";

// Insert a row and return the created record.
// PostgreSQL supports .returning(); MySQL uses insertId + re-select.
async function insertRow<T>(table: any, values: any): Promise<T> {
  if (dbType === "pg") {
    const [row] = await db.insert(table).values(values).returning();
    return row as T;
  }
  const result = await db.insert(table).values(values);
  const [row] = await db.select().from(table).where(eq(table.id, result[0].insertId));
  return row as T;
}

// Run a delete query and return the number of rows removed.
async function deleteCount(deleteQuery: any): Promise<number> {
  if (dbType === "pg") {
    const rows = await deleteQuery.returning({ _id: users.id }).catch(() => []);
    return Array.isArray(rows) ? rows.length : 0;
  }
  const result = await deleteQuery;
  return result[0]?.affectedRows ?? 0;
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;

  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;

  getWhatsappAccount(id: number): Promise<WhatsappAccount | undefined>;
  getWhatsappAccountsByUser(userId: number): Promise<WhatsappAccount[]>;
  getAllWhatsappAccounts(): Promise<WhatsappAccount[]>;
  createWhatsappAccount(account: InsertWhatsappAccount & { sessionPath: string }): Promise<WhatsappAccount>;
  updateWhatsappAccount(id: number, updates: Partial<WhatsappAccount>): Promise<WhatsappAccount | undefined>;
  deleteWhatsappAccount(id: number): Promise<boolean>;

  getChatwootConfig(whatsappAccountId: number): Promise<ChatwootConfig | undefined>;
  upsertChatwootConfig(config: InsertChatwootConfig): Promise<ChatwootConfig>;
  deleteChatwootConfig(whatsappAccountId: number): Promise<boolean>;

  getMessageLogs(whatsappAccountId: number, limit?: number): Promise<MessageLog[]>;
  addMessageLog(log: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog>;
  getMessageByWhatsAppId(whatsappAccountId: number, whatsappId: string): Promise<MessageLog | undefined>;
  deleteOldMessageLogs(olderThanDays: number): Promise<number>;

  getWebhookEvents(whatsappAccountId: number, limit?: number): Promise<WebhookEvent[]>;
  addWebhookEvent(event: Omit<WebhookEvent, "id" | "processedAt">): Promise<WebhookEvent>;
  deleteOldWebhookEvents(olderThanDays: number): Promise<number>;

  getWebhookLogs(whatsappAccountId: number, limit?: number): Promise<WebhookLog[]>;
  addWebhookLog(log: Omit<WebhookLog, "id" | "createdAt">): Promise<WebhookLog>;
  deleteOldWebhookLogs(olderThanDays: number): Promise<number>;
  clearWebhookLogs(whatsappAccountId: number): Promise<number>;
}

class DatabaseStorage implements IStorage {
  // ── Users ──────────────────────────────────────────────────────────────────

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return insertRow<User>(users, insertUser);
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    await db.update(users).set(updates).where(eq(users.id, id));
    return this.getUser(id);
  }

  async deleteUser(id: number): Promise<boolean> {
    const count = await deleteCount(db.delete(users).where(eq(users.id, id)));
    return count > 0;
  }

  // ── App Settings ───────────────────────────────────────────────────────────

  async getSetting(key: string): Promise<string | undefined> {
    const [setting] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return setting?.value;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing !== undefined) {
      await db.update(appSettings).set({ value, updatedAt: new Date() }).where(eq(appSettings.key, key));
    } else {
      await db.insert(appSettings).values({ key, value });
    }
  }

  // ── WhatsApp Accounts ──────────────────────────────────────────────────────

  async getWhatsappAccount(id: number): Promise<WhatsappAccount | undefined> {
    const [account] = await db.select().from(whatsappAccounts).where(eq(whatsappAccounts.id, id));
    return account || undefined;
  }

  async getWhatsappAccountsByUser(userId: number): Promise<WhatsappAccount[]> {
    return db.select().from(whatsappAccounts).where(eq(whatsappAccounts.userId, userId));
  }

  async getAllWhatsappAccounts(): Promise<WhatsappAccount[]> {
    return db.select().from(whatsappAccounts);
  }

  async createWhatsappAccount(account: InsertWhatsappAccount & { sessionPath: string }): Promise<WhatsappAccount> {
    return insertRow<WhatsappAccount>(whatsappAccounts, account);
  }

  async updateWhatsappAccount(id: number, updates: Partial<WhatsappAccount>): Promise<WhatsappAccount | undefined> {
    await db.update(whatsappAccounts).set({ ...updates, updatedAt: new Date() }).where(eq(whatsappAccounts.id, id));
    return this.getWhatsappAccount(id);
  }

  async deleteWhatsappAccount(id: number): Promise<boolean> {
    const count = await deleteCount(db.delete(whatsappAccounts).where(eq(whatsappAccounts.id, id)));
    return count > 0;
  }

  // ── Chatwoot Configs ───────────────────────────────────────────────────────

  async getChatwootConfig(whatsappAccountId: number): Promise<ChatwootConfig | undefined> {
    const [config] = await db.select().from(chatwootConfigs).where(eq(chatwootConfigs.whatsappAccountId, whatsappAccountId));
    return config || undefined;
  }

  async upsertChatwootConfig(config: InsertChatwootConfig): Promise<ChatwootConfig> {
    const existing = await this.getChatwootConfig(config.whatsappAccountId);
    if (existing) {
      await db.update(chatwootConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(chatwootConfigs.whatsappAccountId, config.whatsappAccountId));
      return (await this.getChatwootConfig(config.whatsappAccountId))!;
    }
    return insertRow<ChatwootConfig>(chatwootConfigs, config);
  }

  async deleteChatwootConfig(whatsappAccountId: number): Promise<boolean> {
    const count = await deleteCount(db.delete(chatwootConfigs).where(eq(chatwootConfigs.whatsappAccountId, whatsappAccountId)));
    return count > 0;
  }

  // ── Message Logs ───────────────────────────────────────────────────────────

  async getMessageLogs(whatsappAccountId: number, limit: number = 100): Promise<MessageLog[]> {
    return db.select().from(messageLogs)
      .where(eq(messageLogs.whatsappAccountId, whatsappAccountId))
      .orderBy(desc(messageLogs.createdAt))
      .limit(limit);
  }

  async addMessageLog(log: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog> {
    return insertRow<MessageLog>(messageLogs, log);
  }

  async getMessageByWhatsAppId(whatsappAccountId: number, whatsappId: string): Promise<MessageLog | undefined> {
    const [log] = await db.select().from(messageLogs).where(
      and(eq(messageLogs.whatsappAccountId, whatsappAccountId), eq(messageLogs.whatsappMessageId, whatsappId))
    );
    return log || undefined;
  }

  async updateMessageLogStatus(id: number, status: string): Promise<void> {
    await db.update(messageLogs).set({ status }).where(eq(messageLogs.id, id));
  }

  async getMessageByChatwootId(whatsappAccountId: number, chatwootId: string): Promise<MessageLog | undefined> {
    const [log] = await db.select().from(messageLogs).where(
      and(eq(messageLogs.whatsappAccountId, whatsappAccountId), eq(messageLogs.chatwootMessageId, chatwootId))
    );
    return log || undefined;
  }

  async deleteOldMessageLogs(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return deleteCount(db.delete(messageLogs).where(lt(messageLogs.createdAt, cutoff)));
  }

  // ── Webhook Events ─────────────────────────────────────────────────────────

  async getWebhookEvents(whatsappAccountId: number, limit: number = 50): Promise<WebhookEvent[]> {
    return db.select().from(webhookEvents)
      .where(eq(webhookEvents.whatsappAccountId, whatsappAccountId))
      .orderBy(desc(webhookEvents.processedAt))
      .limit(limit);
  }

  async addWebhookEvent(event: Omit<WebhookEvent, "id" | "processedAt">): Promise<WebhookEvent> {
    return insertRow<WebhookEvent>(webhookEvents, event);
  }

  async deleteOldWebhookEvents(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return deleteCount(db.delete(webhookEvents).where(lt(webhookEvents.processedAt, cutoff)));
  }

  // ── Webhook Logs ───────────────────────────────────────────────────────────

  async getWebhookLogs(whatsappAccountId: number, limit: number = 50): Promise<WebhookLog[]> {
    return db.select().from(webhookLogs)
      .where(eq(webhookLogs.whatsappAccountId, whatsappAccountId))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(limit);
  }

  async addWebhookLog(log: Omit<WebhookLog, "id" | "createdAt">): Promise<WebhookLog> {
    return insertRow<WebhookLog>(webhookLogs, log);
  }

  async deleteOldWebhookLogs(olderThanDays: number): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    return deleteCount(db.delete(webhookLogs).where(lt(webhookLogs.createdAt, cutoff)));
  }

  async clearWebhookLogs(whatsappAccountId: number): Promise<number> {
    return deleteCount(db.delete(webhookLogs).where(eq(webhookLogs.whatsappAccountId, whatsappAccountId)));
  }
}

export const storage = new DatabaseStorage();

// Cleanup job — runs every 10 minutes, applies per-account log retention
export function startCleanupJob() {
  const runCleanup = async () => {
    try {
      const deletedEvents = await storage.deleteOldWebhookEvents(1);

      const accounts = await db.select({ id: whatsappAccounts.id }).from(whatsappAccounts);
      let totalMessages = 0;
      let totalWebhookLogs = 0;

      for (const account of accounts) {
        const retentionSetting = await storage.getSetting(`account_${account.id}_log_retention_minutes`);
        const retentionMinutes = retentionSetting ? parseInt(retentionSetting) : 0;

        if (retentionMinutes > 0) {
          const cutoff = new Date(Date.now() - retentionMinutes * 60 * 1000);
          const [msgCount, whlCount] = await Promise.all([
            deleteCount(db.delete(messageLogs).where(and(eq(messageLogs.whatsappAccountId, account.id), lt(messageLogs.createdAt, cutoff)))),
            deleteCount(db.delete(webhookLogs).where(and(eq(webhookLogs.whatsappAccountId, account.id), lt(webhookLogs.createdAt, cutoff)))),
          ]);
          totalMessages += msgCount;
          totalWebhookLogs += whlCount;
        }
      }

      if (deletedEvents > 0 || totalMessages > 0 || totalWebhookLogs > 0) {
        console.log(`[Cleanup] Deleted ${totalMessages} messages, ${deletedEvents} events, ${totalWebhookLogs} webhook logs`);
      }
    } catch (error) {
      console.error("[Cleanup] Error during cleanup:", error);
    }
  };

  runCleanup();
  setInterval(runCleanup, 10 * 60 * 1000);
}
