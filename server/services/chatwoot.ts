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

  private async findOrCreateContact(
    phoneNumber: string,
    name?: string,
    avatarUrl?: string | null
  ): Promise<ChatwootContact | null> {
    let cleanPhone = phoneNumber
      .replace("@s.whatsapp.net", "")
      .replace("@g.us", "")
      .replace("@lid", "")
      .replace(/:\d+$/, "");

    const isStandardPhone = /^\d{7,15}$/.test(cleanPhone);

    const searchResult = await this.apiRequest<{ payload: ChatwootContact[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/contacts/search?q=${encodeURIComponent(cleanPhone)}`
    );

    if (searchResult?.payload?.length) {
      const existingContact = searchResult.payload[0];

      if (name && name !== existingContact.name) {
        await this.updateContact(existingContact.id, { name });
      }
      if (avatarUrl) {
        await this.updateContactAvatar(existingContact.id, avatarUrl);
      }

      return existingContact;
    }

    // Do NOT pass inbox_id — Chatwoot would auto-create a contact_inbox with a random
    // UUID source_id, which then conflicts when we create a conversation with our own source_id.
    const contactData: any = {
      name: name || `WhatsApp ${cleanPhone}`,
      identifier: cleanPhone,
    };

    if (isStandardPhone) {
      contactData.phone_number = `+${cleanPhone}`;
    }

    const createResult = await this.apiRequest<any>(
      "POST",
      `/api/v1/accounts/${this.accountId}/contacts`,
      contactData
    );

    // Chatwoot may return { payload: { contact: {...} } } or { payload: {...} } or the contact directly
    const contact: ChatwootContact | null =
      createResult?.payload?.contact ||
      (createResult?.payload?.id ? createResult.payload : null) ||
      (createResult?.id ? createResult : null) ||
      null;

    if (contact && avatarUrl) {
      await this.updateContactAvatar(contact.id, avatarUrl);
    }

    return contact;
  }

  async updateMessageDeliveryStatus(
    conversationId: number,
    chatwootMessageId: string,
    status: "delivered" | "read"
  ): Promise<void> {
    try {
      await this.apiRequest(
        "PATCH",
        `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages/${chatwootMessageId}`,
        { content_attributes: { status } }
      );
      console.log(`[Chatwoot] Updated message ${chatwootMessageId} status → ${status}`);
    } catch (error) {
      console.error(`[Chatwoot] Failed to update message status:`, error);
    }
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
    // Normalize source_id: strip `:N` device suffix (e.g. "252618629126:0@s.whatsapp.net" → "252618629126@s.whatsapp.net")
    const normalizedSourceId = sourceId.replace(/:(\d+)(@)/, "$2");

    // Check cache first
    if (this.conversationCache.has(normalizedSourceId)) {
      const cachedId = this.conversationCache.get(normalizedSourceId)!;
      await this.reopenConversationIfNeeded(cachedId);
      return { id: cachedId, inbox_id: parseInt(this.inboxId, 10), contact: {} as ChatwootContact };
    }

    // Look up existing conversations for this contact directly — avoids phone-matching heuristics
    // and handles LID/phone JID mismatches where source_id changed between messages.
    const contactConvs = await this.apiRequest<{ payload: ChatwootConversation[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/contacts/${contactId}/conversations`
    );

    if (contactConvs?.payload?.length) {
      const inboxId = parseInt(this.inboxId, 10);
      const existing = contactConvs.payload.find((conv) => conv.inbox_id === inboxId);
      if (existing) {
        console.log(`[Chatwoot] Found existing conversation ${existing.id} for contact ${contactId}`);
        this.conversationCache.set(normalizedSourceId, existing.id);
        await this.reopenConversationIfNeeded(existing.id);
        return existing;
      }
    }

    // No existing conversation — create one
    const cleanPhone = normalizedSourceId.replace("@s.whatsapp.net", "").replace("@g.us", "");
    console.log(`[Chatwoot] Creating new conversation for contact ${contactId} (${cleanPhone})`);

    const createResult = await this.apiRequest<ChatwootConversation>(
      "POST",
      `/api/v1/accounts/${this.accountId}/conversations`,
      {
        inbox_id: parseInt(this.inboxId, 10),
        contact_id: contactId,
        source_id: normalizedSourceId,
      }
    );

    if (createResult) {
      this.conversationCache.set(normalizedSourceId, createResult.id);
      return createResult;
    }

    // If creation failed (e.g. source_id conflict from a pre-existing contact_inbox),
    // fall back to whatever conversation the contact already has in this inbox.
    console.warn(`[Chatwoot] Conversation create failed for contact ${contactId}, falling back to contact conversations`);
    const retry = await this.apiRequest<{ payload: ChatwootConversation[] }>(
      "GET",
      `/api/v1/accounts/${this.accountId}/contacts/${contactId}/conversations`
    );
    const inboxId = parseInt(this.inboxId, 10);
    const fallback = retry?.payload?.find((conv) => conv.inbox_id === inboxId) || null;
    if (fallback) {
      this.conversationCache.set(normalizedSourceId, fallback.id);
      await this.reopenConversationIfNeeded(fallback.id);
    }
    return fallback;
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
    senderJid: string;
    pushName: string | null;
    groupName: string | null;
    avatarUrl: string | null;
    isFromMe: boolean;
    content: string;
    messageId?: string;
    media?: {
      buffer: Buffer;
      type: string;
      mimeType: string;
      fileName: string;
    };
  }): Promise<void> {
    const { remoteJid, senderJid, pushName, groupName, avatarUrl, isFromMe, content, messageId, media } = params;

    if (messageId && this.processedMessages.has(messageId)) {
      console.log(`[Chatwoot] Message ${messageId} already processed, skipping`);
      return;
    }

    const isGroup = remoteJid.endsWith("@g.us");

    // For groups: contact = the group itself. For DMs: contact = the person.
    const contactJid = isGroup ? remoteJid : senderJid;
    const contactName = isGroup ? (groupName || remoteJid) : (pushName || undefined);
    const contact = await this.findOrCreateContact(contactJid, contactName, avatarUrl);
    if (!contact) {
      console.error(`[Chatwoot] Failed to create/find contact for ${contactJid}`);
      return;
    }
    console.log(`[Chatwoot] Contact ${contact.id} ready for ${contactJid}`);

    const conversation = await this.findOrCreateConversation(remoteJid, contact.id);
    if (!conversation) {
      console.error(`[Chatwoot] Failed to create/find conversation for contact ${contact.id} (${remoteJid})`);
      return;
    }
    console.log(`[Chatwoot] Conversation ${conversation.id} ready`);

    // For group messages, prefix sender name. For fromMe, prefix "📱 From mobile:" so agents know it was sent from the phone.
    const senderName = pushName || senderJid.replace("@s.whatsapp.net", "");
    let finalContent = content;
    if (isGroup && !isFromMe) {
      finalContent = `*${senderName}:* ${content}`;
    } else if (isFromMe) {
      finalContent = `${content} \n📱 From mobile`;
    }

    // fromMe messages are posted as private notes — this guarantees the webhook's own
    // `private === true` filter blocks re-sending, with no race-condition risk.
    const messageType = isFromMe ? "outgoing" : "incoming";
    const isPrivate = isFromMe;

    let messageResult: { id: number } | null = null;

    if (media && !isFromMe) {
      messageResult = await this.sendMessageWithAttachment(conversation.id, finalContent, media);
    } else {
      messageResult = await this.apiRequest<{ id: number }>(
        "POST",
        `/api/v1/accounts/${this.accountId}/conversations/${conversation.id}/messages`,
        {
          content: finalContent,
          message_type: messageType,
          private: isPrivate,
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
    // Mark the Chatwoot message ID so the outgoing webhook doesn't re-send it to WhatsApp
    this.processedMessages.add(`outgoing_${messageResult.id}`);

    if (this.processedMessages.size > 10000) {
      const entries = Array.from(this.processedMessages);
      this.processedMessages = new Set(entries.slice(-5000));
    }

    storage.addMessageLog({
      whatsappAccountId: this.whatsappAccountId,
      direction: isFromMe ? "outgoing" : "incoming",
      remoteJid,
      remoteName: isGroup ? groupName : pushName,
      chatwootMessageId: String(messageResult.id),
      chatwootConversationId: conversation.id,
      whatsappMessageId: messageId || null,
      content: content.substring(0, 200),
      status: "delivered",
    }).catch((err) => console.error("[Chatwoot] Failed to save message log:", err));

    console.log(`[Chatwoot] Message sent to conversation ${conversation.id}`);
  }

  async processWebhook(payload: ChatwootWebhookPayload): Promise<{
    shouldReply: boolean;
    phoneNumber?: string;
    content?: string;
    conversationId?: number;
    attachments?: Array<{ url: string; type: string; name?: string }>;
    shouldTyping?: boolean;
    shouldTypingOff?: boolean;
    shouldDeleteMessage?: boolean;
    chatwootMessageIdToDelete?: string;
  }> {
    console.log(`[Chatwoot] Processing webhook event: ${payload.event}, type: ${payload.message_type}, private: ${payload.private}`);

    // Typing presence
    if (payload.event === "conversation_typing_on" || payload.event === "conversation_typing_off") {
      const sourceId = (payload as any).conversation?.contact_inbox?.source_id as string | undefined;
      const phone = sourceId?.split(":")[0] || sourceId;
      if (!phone) return { shouldReply: false };
      return {
        shouldReply: false,
        phoneNumber: phone,
        shouldTyping: payload.event === "conversation_typing_on",
        shouldTypingOff: payload.event === "conversation_typing_off",
      };
    }

    // Message deleted in Chatwoot → delete on WhatsApp
    if (payload.event === "message_updated") {
      const contentAttrs = (payload as any).content_attributes as Record<string, any> | undefined;
      if (contentAttrs?.deleted === true) {
        const chatwootMsgId = String(payload.id || "");
        const sourceId = (payload as any).conversation?.contact_inbox?.source_id as string | undefined;
        const phone = sourceId?.split(":")[0] || sourceId;
        return {
          shouldReply: false,
          phoneNumber: phone,
          shouldDeleteMessage: true,
          chatwootMessageIdToDelete: chatwootMsgId,
        };
      }
      return { shouldReply: false };
    }

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
    status: "sent" | "failed",
    chatwootMessageId?: string | null
  ): Promise<void> {
    storage.addMessageLog({
      whatsappAccountId: this.whatsappAccountId,
      direction: "outgoing",
      remoteJid: `${phoneNumber}@s.whatsapp.net`,
      remoteName: null,
      chatwootMessageId: chatwootMessageId || null,
      chatwootConversationId: null,
      whatsappMessageId,
      content: content.substring(0, 200),
      status,
    }).catch((err) => console.error("[Chatwoot] Failed to save outgoing log:", err));
  }
}
