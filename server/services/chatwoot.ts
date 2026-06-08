import { storage } from "../storage";
import type { ChatwootWebhookPayload, ChatwootConfig } from "@shared/schema";

interface ChatwootContact {
  id: number;
  name: string;
  phone_number: string;
  source_id: string;
  identifier?: string;
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

    let statusCode: number | undefined;
    let responseBody: unknown = null;
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      statusCode = response.status;
      const responseText = await response.text();
      try { responseBody = JSON.parse(responseText); } catch { responseBody = responseText; }

      await storage.addWebhookLog({
        whatsappAccountId: this.whatsappAccountId,
        direction: "outgoing",
        method,
        url,
        headers: headers as Record<string, string>,
        body: { request: body || {}, response: responseBody },
        statusCode,
      });

      if (!response.ok) {
        console.error(`[Chatwoot] API error: ${response.status} - ${responseText}`);
        return null;
      }

      return responseBody as T;
    } catch (error) {
      console.error(`[Chatwoot] Request failed:`, error);

      await storage.addWebhookLog({
        whatsappAccountId: this.whatsappAccountId,
        direction: "outgoing",
        method,
        url,
        headers: headers as Record<string, string>,
        body: { request: body || {}, error: String(error) },
        statusCode: statusCode || 0,
      });

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

  private async findOrCreateContact(phoneNumber: string, name?: string, avatarUrl?: string): Promise<ChatwootContact | null> {
    // Remove WhatsApp suffixes and device number (e.g., :0, :1, etc.)
    let cleanPhone = phoneNumber
      .replace("@s.whatsapp.net", "")
      .replace("@g.us", "")
      .replace(/:\d+$/, ""); // Remove device number like :0, :1
    
    // Validate if phoneNumber is likely an LID or non-standard format
    // Chatwoot requires e164 (+123456789)
    // If it's an LID or doesn't look like a phone number, we'll use it as identifier but might need a fallback for phone_number
    const isStandardPhone = /^\d{7,15}$/.test(cleanPhone);

    const searchResult = await this.apiRequest<{ payload: ChatwootContact[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/contacts/search?q=${cleanPhone}`
    );

    if (searchResult?.payload?.length) {
      const existingContact = searchResult.payload[0];
      
      // Update contact name if we have a better name
      if (name && name !== existingContact.name && !existingContact.name.includes(name)) {
        await this.updateContact(existingContact.id, { name });
      }
      
      return existingContact;
    }

    const contactData: any = {
      inbox_id: parseInt(this.inboxId, 10),
      name: name || `WhatsApp ${cleanPhone}`,
      identifier: cleanPhone,
    };

    // Only add phone_number if it looks like a real one to avoid Chatwoot 422 errors
    if (isStandardPhone) {
      contactData.phone_number = `+${cleanPhone}`;
    }

    const createResult = await this.apiRequest<{ payload: { contact: ChatwootContact } }>(
      "POST",
      `/api/v1/accounts/${this.accountId}/contacts`,
      contactData
    );

    return createResult?.payload?.contact || null;
  }

  async updateContact(contactId: number, updates: { name?: string; avatar_url?: string }): Promise<void> {
    try {
      await this.apiRequest(
        "PUT",
        `/api/v1/accounts/${this.accountId}/contacts/${contactId}`,
        updates
      );
      console.log(`[Chatwoot] Updated contact ${contactId} with:`, Object.keys(updates));
    } catch (error) {
      console.error(`[Chatwoot] Failed to update contact ${contactId}:`, error);
    }
  }

  async updateContactAvatar(contactId: number, avatarUrl: string): Promise<void> {
    try {
      // Download the image and upload to Chatwoot
      const response = await fetch(avatarUrl);
      if (!response.ok) {
        console.error(`[Chatwoot] Failed to download avatar: ${response.status}`);
        return;
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "image/jpeg";
      
      // Upload avatar using multipart form
      const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
      const parts: Buffer[] = [];
      
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="avatar.jpg"\r\nContent-Type: ${contentType}\r\n\r\n`));
      parts.push(buffer);
      parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
      
      const body = Buffer.concat(parts);
      
      const uploadResponse = await fetch(
        `${this.baseUrl}/api/v1/accounts/${this.accountId}/contacts/${contactId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "api_access_token": this.apiToken,
          },
          body,
        }
      );
      
      if (uploadResponse.ok) {
        console.log(`[Chatwoot] Updated avatar for contact ${contactId}`);
      } else {
        console.error(`[Chatwoot] Avatar upload failed: ${uploadResponse.status}`);
      }
    } catch (error) {
      console.error(`[Chatwoot] Failed to update avatar:`, error);
    }
  }

  private async findOrCreateConversation(
    sourceId: string,
    contactId: number
  ): Promise<ChatwootConversation | null> {
    const cleanPhone = sourceId.replace("@s.whatsapp.net", "").replace("@g.us", "").replace(/:\d+$/, "");
    
    // Check cache first
    if (this.conversationCache.has(sourceId)) {
      const cachedId = this.conversationCache.get(sourceId)!;
      // Still need to check if conversation needs to be reopened
      await this.reopenConversationIfNeeded(cachedId);
      return { id: cachedId, inbox_id: parseInt(this.inboxId, 10), contact: {} as ChatwootContact };
    }

    // Search for existing conversations with this contact in this inbox (including closed ones)
    const conversations = await this.apiRequest<{ payload: ChatwootConversation[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/conversations?inbox_id=${this.inboxId}&status=all`
    );

    if (conversations?.payload) {
      // Find conversation matching this phone number
      const existing = conversations.payload.find((conv) => {
        // Check by contact phone number
        if (conv.contact?.phone_number?.includes(cleanPhone)) {
          return true;
        }
        // Check by contact identifier
        if (conv.contact?.identifier?.includes(cleanPhone)) {
          return true;
        }
        // Also check contact_inbox source_id if available
        const convSourceId = (conv as any).contact_inbox?.source_id;
        if (convSourceId && convSourceId.includes(cleanPhone)) {
          return true;
        }
        return false;
      });

      if (existing) {
        console.log(`[Chatwoot] Found existing conversation ${existing.id} for ${cleanPhone}`);
        this.conversationCache.set(sourceId, existing.id);
        
        // Reopen the conversation if it's closed/resolved
        await this.reopenConversationIfNeeded(existing.id);
        
        return existing;
      }
    }

    // No existing conversation found - create a new one
    console.log(`[Chatwoot] Creating new conversation for contact ${contactId} (${cleanPhone})`);
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

  private async reopenConversationIfNeeded(conversationId: number): Promise<void> {
    try {
      // Get conversation status
      const conversation = await this.apiRequest<{ status: string }>(
        "GET",
        `/api/v1/accounts/${this.accountId}/conversations/${conversationId}`
      );

      // If conversation is resolved/closed, reopen it
      if (conversation && conversation.status === "resolved") {
        console.log(`[Chatwoot] Reopening conversation ${conversationId}`);
        await this.apiRequest(
          "POST",
          `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/toggle_status`,
          { status: "open" }
        );
      }
    } catch (error) {
      console.error(`[Chatwoot] Failed to check/reopen conversation ${conversationId}:`, error);
    }
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

    const cleanPhone = remoteJid.replace("@s.whatsapp.net", "").replace("@g.us", "").replace(/:\d+$/, "");
    
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
    attachments?: Array<{ url: string; type: string; name?: string }>;
  }> {
    console.log(`[Chatwoot] Processing webhook event: ${payload.event}, type: ${payload.message_type}, private: ${payload.private}`);
    
    if (payload.event !== "message_created") {
      console.log(`[Chatwoot] Ignoring non-message event: ${payload.event}`);
      return { shouldReply: false };
    }

    // Filter out private/secret notes - don't send to WhatsApp
    if (payload.private === true) {
      console.log(`[Chatwoot] Ignoring private note - not sending to WhatsApp`);
      return { shouldReply: false };
    }

    if (payload.message_type !== "outgoing") {
      console.log(`[Chatwoot] Ignoring non-outgoing message: ${payload.message_type}`);
      return { shouldReply: false };
    }

    if (payload.sender?.type !== "user") {
      console.log(`[Chatwoot] Ignoring non-user sender: ${payload.sender?.type}`);
      return { shouldReply: false };
    }

    const conversationId = payload.conversation?.id;
    const inboxId = payload.conversation?.inbox_id;

    if (inboxId !== parseInt(this.inboxId, 10)) {
      console.log(`[Chatwoot] Ignoring wrong inbox: ${inboxId} vs ${this.inboxId}`);
      return { shouldReply: false };
    }

    // Try multiple ways to extract phone number
    const sourceId = payload.conversation?.contact_inbox?.source_id;
    const senderPhone = payload.conversation?.meta?.sender?.phone_number;
    const senderIdentifier = payload.conversation?.meta?.sender?.identifier;
    const phoneNumber = senderPhone || senderIdentifier || sourceId;

    console.log(`[Chatwoot] Phone extraction - sourceId: ${sourceId}, senderPhone: ${senderPhone}, identifier: ${senderIdentifier}`);

    if (!phoneNumber) {
      console.warn(`[Chatwoot] No phone number found in webhook payload`);
      return { shouldReply: false };
    }

    // Check for attachments
    const attachments: Array<{ url: string; type: string; name?: string }> = [];
    if (payload.attachments && Array.isArray(payload.attachments)) {
      for (const att of payload.attachments) {
        if (att.data_url) {
          attachments.push({
            url: att.data_url,
            type: att.file_type || att.content_type || "file",
            name: att.file_name || att.name,
          });
        }
      }
      console.log(`[Chatwoot] Found ${attachments.length} attachments`);
    }

    // Allow messages with content OR attachments
    if (!payload.content && attachments.length === 0) {
      console.log(`[Chatwoot] No content or attachments in message`);
      return { shouldReply: false };
    }

    const chatwootMessageId = String(payload.id);
    if (this.processedMessages.has(`outgoing_${chatwootMessageId}`)) {
      console.log(`[Chatwoot] Outgoing message ${chatwootMessageId} already processed, skipping`);
      return { shouldReply: false };
    }

    this.processedMessages.add(`outgoing_${chatwootMessageId}`);

    // Clean phone number - remove + and any non-numeric characters except @
    const cleanPhone = phoneNumber.replace(/^\+/, "").replace(/@.*$/, "").replace(/[^0-9]/g, "");
    console.log(`[Chatwoot] Will send to: ${cleanPhone}, content: ${payload.content?.substring(0, 50) || "(media only)"}, attachments: ${attachments.length}`);

    return {
      shouldReply: true,
      phoneNumber: cleanPhone,
      content: payload.content || "",
      conversationId,
      attachments: attachments.length > 0 ? attachments : undefined,
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
