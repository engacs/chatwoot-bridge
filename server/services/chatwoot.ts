import { storage } from "../storage";
import type { ChatwootWebhookPayload, ChatwootConfig } from "@shared/schema";

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

export class ChatwootService {
  private baseUrl: string;
  private apiToken: string;
  private inboxId: string;
  private accountId: string;
  private whatsappAccountId: number;
  private conversationCache: Map<string, number> = new Map();
  private processedMessages: Set<string> = new Set();

  constructor(config: ChatwootConfig, whatsappAccountId: number) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.apiToken = config.apiToken;
    this.inboxId = config.inboxId;
    this.accountId = config.accountId;
    this.whatsappAccountId = whatsappAccountId;
    console.log(`[Chatwoot] Service created for account ${whatsappAccountId}: ${this.baseUrl}, inbox: ${this.inboxId}`);
  }

  private async apiRequest<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T | null> {
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

  private async sendMessageWithAttachment(
    conversationId: number,
    content: string,
    media: { buffer: Buffer; type: string; mimeType: string; fileName: string }
  ): Promise<{ id: number } | null> {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;
    
    try {
      // Create form data manually for Node.js
      const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
      const parts: Buffer[] = [];

      // Add content field
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\n${content}\r\n`));
      
      // Add message_type field
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="message_type"\r\n\r\nincoming\r\n`));
      
      // Add private field
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="private"\r\n\r\nfalse\r\n`));
      
      // Add attachment
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="attachments[]"; filename="${media.fileName}"\r\nContent-Type: ${media.mimeType}\r\n\r\n`));
      parts.push(media.buffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

      const body = Buffer.concat(parts);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "api_access_token": this.apiToken,
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Chatwoot] Media upload error: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json() as { id: number };
      console.log(`[Chatwoot] Media message sent successfully: ${media.type} (${media.fileName})`);
      return data;
    } catch (error) {
      console.error("[Chatwoot] Media upload failed:", error);
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
        inbox_id: parseInt(this.inboxId, 10),
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
      return { id: cachedId, inbox_id: parseInt(this.inboxId, 10), contact: {} as ChatwootContact };
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
        inbox_id: parseInt(this.inboxId, 10),
        contact_id: contactId,
        source_id: sourceId,
      }
    );

    if (createResult) {
      this.conversationCache.set(sourceId, createResult.id);
    }

    return createResult;
  }

  async handleIncomingMessage(params: {
    remoteJid: string;
    pushName: string | null;
    content: string;
    messageId?: string;
    media?: {
      buffer: Buffer;
      type: string;
      mimeType: string;
      fileName: string;
    };
  }): Promise<void> {
    const { remoteJid, pushName, content, messageId, media } = params;

    if (messageId && this.processedMessages.has(messageId)) {
      console.log(`[Chatwoot] Message ${messageId} already processed, skipping`);
      return;
    }

    const cleanPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "");
    
    const contact = await this.findOrCreateContact(cleanPhone, pushName || undefined);
    if (!contact) {
      console.error("[Chatwoot] Failed to create/find contact");
      return;
    }

    const conversation = await this.findOrCreateConversation(remoteJid, contact.id);
    if (!conversation) {
      console.error("[Chatwoot] Failed to create/find conversation");
      return;
    }

    let messageResult: { id: number } | null = null;

    if (media) {
      // Use multipart form data for media messages
      messageResult = await this.sendMessageWithAttachment(
        conversation.id,
        content,
        media
      );
    } else {
      messageResult = await this.apiRequest<{ id: number }>(
        "POST",
        `/api/v1/accounts/${this.accountId}/conversations/${conversation.id}/messages`,
        {
          content,
          message_type: "incoming",
          private: false,
        }
      );
    }

    if (!messageResult) {
      console.error("[Chatwoot] Failed to send message");
      return;
    }

    if (messageId) {
      this.processedMessages.add(messageId);
    }

    if (this.processedMessages.size > 10000) {
      const entries = Array.from(this.processedMessages);
      this.processedMessages = new Set(entries.slice(-5000));
    }

    await storage.addMessageLog({
      whatsappAccountId: this.whatsappAccountId,
      direction: "incoming",
      remoteJid,
      remoteName: pushName,
      chatwootMessageId: String(messageResult.id),
      whatsappMessageId: messageId || null,
      content: content.substring(0, 200),
      status: "delivered",
    });

    console.log(`[Chatwoot] Message sent to conversation ${conversation.id}`);
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

    if (inboxId !== parseInt(this.inboxId, 10)) {
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
  ): Promise<void> {
    await storage.addMessageLog({
      whatsappAccountId: this.whatsappAccountId,
      direction: "outgoing",
      remoteJid: `${phoneNumber}@s.whatsapp.net`,
      remoteName: null,
      chatwootMessageId: null,
      whatsappMessageId,
      content: content.substring(0, 200),
      status,
    });
  }
}
