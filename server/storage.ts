import { 
  users, type User, type InsertUser, 
  whatsappAccounts, type WhatsappAccount, type InsertWhatsappAccount,
  chatwootConfigs, type ChatwootConfig, type InsertChatwootConfig,
  messageLogs, type MessageLog,
  webhookEvents, type WebhookEvent,
  appSettings, type AppSetting
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  deleteUser(id: number): Promise<boolean>;
  
  // App Settings
  getSetting(key: string): Promise<string | undefined>;
  setSetting(key: string, value: string): Promise<void>;
  
  // WhatsApp Accounts
  getWhatsappAccount(id: number): Promise<WhatsappAccount | undefined>;
  getWhatsappAccountsByUser(userId: number): Promise<WhatsappAccount[]>;
  getAllWhatsappAccounts(): Promise<WhatsappAccount[]>;
  createWhatsappAccount(account: InsertWhatsappAccount & { sessionPath: string }): Promise<WhatsappAccount>;
  updateWhatsappAccount(id: number, updates: Partial<WhatsappAccount>): Promise<WhatsappAccount | undefined>;
  deleteWhatsappAccount(id: number): Promise<boolean>;
  
  // Chatwoot Configs
  getChatwootConfig(whatsappAccountId: number): Promise<ChatwootConfig | undefined>;
  upsertChatwootConfig(config: InsertChatwootConfig): Promise<ChatwootConfig>;
  deleteChatwootConfig(whatsappAccountId: number): Promise<boolean>;
  
  // Message Logs
  getMessageLogs(whatsappAccountId: number, limit?: number): Promise<MessageLog[]>;
  addMessageLog(log: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog>;
  getMessageByWhatsAppId(whatsappAccountId: number, whatsappId: string): Promise<MessageLog | undefined>;
  
  // Webhook Events
  getWebhookEvents(whatsappAccountId: number, limit?: number): Promise<WebhookEvent[]>;
  addWebhookEvent(event: Omit<WebhookEvent, "id" | "processedAt">): Promise<WebhookEvent>;
}

export class DatabaseStorage implements IStorage {
  // Users
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
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  // App Settings
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

  // WhatsApp Accounts
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
    const [created] = await db.insert(whatsappAccounts).values(account).returning();
    return created;
  }

  async updateWhatsappAccount(id: number, updates: Partial<WhatsappAccount>): Promise<WhatsappAccount | undefined> {
    const [updated] = await db
      .update(whatsappAccounts)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(whatsappAccounts.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteWhatsappAccount(id: number): Promise<boolean> {
    const result = await db.delete(whatsappAccounts).where(eq(whatsappAccounts.id, id)).returning();
    return result.length > 0;
  }

  // Chatwoot Configs
  async getChatwootConfig(whatsappAccountId: number): Promise<ChatwootConfig | undefined> {
    const [config] = await db.select().from(chatwootConfigs).where(eq(chatwootConfigs.whatsappAccountId, whatsappAccountId));
    return config || undefined;
  }

  async upsertChatwootConfig(config: InsertChatwootConfig): Promise<ChatwootConfig> {
    const existing = await this.getChatwootConfig(config.whatsappAccountId);
    if (existing) {
      const [updated] = await db
        .update(chatwootConfigs)
        .set({ ...config, updatedAt: new Date() })
        .where(eq(chatwootConfigs.whatsappAccountId, config.whatsappAccountId))
        .returning();
      return updated;
    }
    const [created] = await db.insert(chatwootConfigs).values(config).returning();
    return created;
  }

  async deleteChatwootConfig(whatsappAccountId: number): Promise<boolean> {
    const result = await db.delete(chatwootConfigs).where(eq(chatwootConfigs.whatsappAccountId, whatsappAccountId)).returning();
    return result.length > 0;
  }

  // Message Logs
  async getMessageLogs(whatsappAccountId: number, limit: number = 100): Promise<MessageLog[]> {
    return db
      .select()
      .from(messageLogs)
      .where(eq(messageLogs.whatsappAccountId, whatsappAccountId))
      .orderBy(desc(messageLogs.createdAt))
      .limit(limit);
  }

  async addMessageLog(log: Omit<MessageLog, "id" | "createdAt">): Promise<MessageLog> {
    const [created] = await db.insert(messageLogs).values(log).returning();
    return created;
  }

  async getMessageByWhatsAppId(whatsappAccountId: number, whatsappId: string): Promise<MessageLog | undefined> {
    const [log] = await db
      .select()
      .from(messageLogs)
      .where(and(
        eq(messageLogs.whatsappAccountId, whatsappAccountId),
        eq(messageLogs.whatsappMessageId, whatsappId)
      ));
    return log || undefined;
  }

  // Webhook Events
  async getWebhookEvents(whatsappAccountId: number, limit: number = 50): Promise<WebhookEvent[]> {
    return db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.whatsappAccountId, whatsappAccountId))
      .orderBy(desc(webhookEvents.processedAt))
      .limit(limit);
  }

  async addWebhookEvent(event: Omit<WebhookEvent, "id" | "processedAt">): Promise<WebhookEvent> {
    const [created] = await db.insert(webhookEvents).values(event).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
