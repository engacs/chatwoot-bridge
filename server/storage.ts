import { type User, type InsertUser, type WhatsAppSession, type MessageLog, type WebhookEvent, type ConnectionStatus } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  getSession(): Promise<WhatsAppSession>;
  updateSession(updates: Partial<WhatsAppSession>): Promise<WhatsAppSession>;
  
  getMessageLogs(limit?: number): Promise<MessageLog[]>;
  addMessageLog(log: Omit<MessageLog, "id">): Promise<MessageLog>;
  updateMessageLog(id: string, updates: Partial<MessageLog>): Promise<MessageLog | undefined>;
  getMessageByWhatsAppId(whatsappId: string): Promise<MessageLog | undefined>;
  getMessageByChatwootId(chatwootId: string): Promise<MessageLog | undefined>;
  
  getWebhookEvents(limit?: number): Promise<WebhookEvent[]>;
  addWebhookEvent(event: Omit<WebhookEvent, "id">): Promise<WebhookEvent>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private session: WhatsAppSession;
  private messageLogs: MessageLog[];
  private webhookEvents: WebhookEvent[];

  constructor() {
    this.users = new Map();
    this.session = {
      id: "default",
      status: "disconnected",
      qrCode: null,
      phoneNumber: null,
      lastConnectedAt: null,
      connectedSince: null,
    };
    this.messageLogs = [];
    this.webhookEvents = [];
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getSession(): Promise<WhatsAppSession> {
    return { ...this.session };
  }

  async updateSession(updates: Partial<WhatsAppSession>): Promise<WhatsAppSession> {
    this.session = { ...this.session, ...updates };
    return { ...this.session };
  }

  async getMessageLogs(limit: number = 100): Promise<MessageLog[]> {
    return [...this.messageLogs]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  async addMessageLog(log: Omit<MessageLog, "id">): Promise<MessageLog> {
    const messageLog: MessageLog = {
      ...log,
      id: randomUUID(),
    };
    this.messageLogs.push(messageLog);
    if (this.messageLogs.length > 1000) {
      this.messageLogs = this.messageLogs.slice(-500);
    }
    return messageLog;
  }

  async updateMessageLog(id: string, updates: Partial<MessageLog>): Promise<MessageLog | undefined> {
    const index = this.messageLogs.findIndex(log => log.id === id);
    if (index === -1) return undefined;
    this.messageLogs[index] = { ...this.messageLogs[index], ...updates };
    return { ...this.messageLogs[index] };
  }

  async getMessageByWhatsAppId(whatsappId: string): Promise<MessageLog | undefined> {
    return this.messageLogs.find(log => log.whatsappMessageId === whatsappId);
  }

  async getMessageByChatwootId(chatwootId: string): Promise<MessageLog | undefined> {
    return this.messageLogs.find(log => log.chatwootMessageId === chatwootId);
  }

  async getWebhookEvents(limit: number = 50): Promise<WebhookEvent[]> {
    return [...this.webhookEvents]
      .sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime())
      .slice(0, limit);
  }

  async addWebhookEvent(event: Omit<WebhookEvent, "id">): Promise<WebhookEvent> {
    const webhookEvent: WebhookEvent = {
      ...event,
      id: randomUUID(),
    };
    this.webhookEvents.push(webhookEvent);
    if (this.webhookEvents.length > 500) {
      this.webhookEvents = this.webhookEvents.slice(-250);
    }
    return webhookEvent;
  }
}

export const storage = new MemStorage();
