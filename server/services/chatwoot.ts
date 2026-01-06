import { storage } from "../storage";
import type { ChatwootWebhookPayload, MessageLog } from "@shared/schema";

interface ChatwootContact {
  id: number;
  name: string;
  phone_number: string;
  source_id: string;
}

interface ChatwootConversation {
  id: number;
  inbox_id: number;
  contact: ChatwootContact;
}

class ChatwootService {
  private baseUrl: string | null = null;
  private apiToken: string | null = null;
  private inboxId: string | null = null;
  private accountId: string | null = null;
  private conversationCache: Map<string, number> = new Map();
  private processedMessages: Set<string> = new Set();

  configure(baseUrl: string, apiToken: string, inboxId: string, accountId: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiToken = apiToken;
    this.inboxId = inboxId;
    this.accountId = accountId;
    console.log(`[Chatwoot] Configured with base URL: ${this.baseUrl}, inbox: ${this.inboxId}`);
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.apiToken && this.inboxId && this.accountId);
  }

  getConfig() {
    return {
      baseUrl: this.baseUrl,
      inboxId: this.inboxId,
      accountId: this.accountId,
      isConfigured: this.isConfigured(),
    };
  }

  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T | null> {
    if (!this.baseUrl || !this.apiToken) {
      console.error("[Chatwoot] Not configured");
      return null;
    }

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "api_access_token": this.apiToken,
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Chatwoot] API error: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      console.error(`[Chatwoot] Request failed:`, error);
      return null;
    }
  }

  private async findOrCreateContact(phoneNumber: string, name?: string): Promise<ChatwootContact | null> {
    const cleanPhone = phoneNumber.replace("@s.whatsapp.net", "").replace("@g.us", "");
    
    const searchResult = await this.apiRequest<{ payload: ChatwootContact[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/contacts/search?q=${cleanPhone}`
    );

    if (searchResult?.payload?.length) {
      return searchResult.payload[0];
    }

    const createResult = await this.apiRequest<{ payload: { contact: ChatwootContact } }>(
      "POST",
      `/api/v1/accounts/${this.accountId}/contacts`,
      {
        inbox_id: parseInt(this.inboxId!, 10),
        name: name || `WhatsApp ${cleanPhone}`,
        phone_number: `+${cleanPhone}`,
        identifier: cleanPhone,
      }
    );

    return createResult?.payload?.contact || null;
  }

  private async findOrCreateConversation(
    sourceId: string,
    contactId: number
  ): Promise<ChatwootConversation | null> {
    if (this.conversationCache.has(sourceId)) {
      const cachedId = this.conversationCache.get(sourceId)!;
      return { id: cachedId, inbox_id: parseInt(this.inboxId!, 10), contact: {} as ChatwootContact };
    }

    const conversations = await this.apiRequest<{ payload: ChatwootConversation[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/conversations?inbox_id=${this.inboxId}&status=all`
    );

    if (conversations?.payload) {
      const existing = conversations.payload.find(
        (conv) => conv.contact?.phone_number?.includes(sourceId.replace("@s.whatsapp.net", ""))
      );
      if (existing) {
        this.conversationCache.set(sourceId, existing.id);
        return existing;
      }
    }

    const createResult = await this.apiRequest<ChatwootConversation>(
      "POST",
      `/api/v1/accounts/${this.accountId}/conversations`,
      {
        inbox_id: parseInt(this.inboxId!, 10),
        contact_id: contactId,
        source_id: sourceId,
      }
    );

    if (createResult) {
      this.conversationCache.set(sourceId, createResult.id);
    }

    return createResult;
  }

  async sendMessageToChatwoot(
    remoteJid: string,
    remoteName: string | null,
    content: string,
    whatsappMessageId: string
  ): Promise<MessageLog | null> {
    if (!this.isConfigured()) {
      console.error("[Chatwoot] Not configured, cannot send message");
      return null;
    }

    if (this.processedMessages.has(whatsappMessageId)) {
      console.log(`[Chatwoot] Message ${whatsappMessageId} already processed, skipping`);
      return null;
    }

    const cleanPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    
    const contact = await this.findOrCreateContact(cleanPhone, remoteName || undefined);
    if (!contact) {
      console.error("[Chatwoot] Failed to create/find contact");
      return null;
    }

    const conversation = await this.findOrCreateConversation(remoteJid, contact.id);
    if (!conversation) {
      console.error("[Chatwoot] Failed to create/find conversation");
      return null;
    }

    const messageResult = await this.apiRequest<{ id: number }>(
      "POST",
      `/api/v1/accounts/${this.accountId}/conversations/${conversation.id}/messages`,
      {
        content,
        message_type: "incoming",
        private: false,
      }
    );

    if (!messageResult) {
      console.error("[Chatwoot] Failed to send message");
      return null;
    }

    this.processedMessages.add(whatsappMessageId);

    if (this.processedMessages.size > 10000) {
      const entries = Array.from(this.processedMessages);
      this.processedMessages = new Set(entries.slice(-5000));
    }

    const log = await storage.addMessageLog({
      direction: "incoming",
      remoteJid,
      remoteName,
      chatwootMessageId: String(messageResult.id),
      whatsappMessageId,
      content: content.substring(0, 200),
      status: "delivered",
      timestamp: new Date().toISOString(),
    });

    console.log(`[Chatwoot] Message sent to conversation ${conversation.id}`);
    return log;
  }

  async processWebhook(payload: ChatwootWebhookPayload): Promise<{
    shouldReply: boolean;
    phoneNumber?: string;
    content?: string;
    conversationId?: number;
  }> {
    if (payload.event !== "message_created") {
      return { shouldReply: false };
    }

    if (payload.message_type !== "outgoing") {
      return { shouldReply: false };
    }

    if (payload.sender?.type !== "user") {
      return { shouldReply: false };
    }

    const conversationId = payload.conversation?.id;
    const inboxId = payload.conversation?.inbox_id;

    if (inboxId !== parseInt(this.inboxId!, 10)) {
      return { shouldReply: false };
    }

    const sourceId = payload.conversation?.contact_inbox?.source_id;
    const phoneNumber = payload.conversation?.meta?.sender?.phone_number || sourceId;

    if (!phoneNumber || !payload.content) {
      return { shouldReply: false };
    }

    const chatwootMessageId = String(payload.id);
    if (this.processedMessages.has(`outgoing_${chatwootMessageId}`)) {
      console.log(`[Chatwoot] Outgoing message ${chatwootMessageId} already processed, skipping`);
      return { shouldReply: false };
    }

    this.processedMessages.add(`outgoing_${chatwootMessageId}`);

    return {
      shouldReply: true,
      phoneNumber: phoneNumber.replace("+", ""),
      content: payload.content,
      conversationId,
    };
  }

  async logOutgoingMessage(
    phoneNumber: string,
    content: string,
    whatsappMessageId: string | null,
    status: "sent" | "failed"
  ): Promise<MessageLog> {
    return storage.addMessageLog({
      direction: "outgoing",
      remoteJid: `${phoneNumber}@s.whatsapp.net`,
      remoteName: null,
      chatwootMessageId: null,
      whatsappMessageId,
      content: content.substring(0, 200),
      status,
      timestamp: new Date().toISOString(),
    });
  }
}

export const chatwootService = new ChatwootService();
