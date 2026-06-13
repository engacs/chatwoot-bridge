import { EventEmitter } from "events";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  WASocket,
  proto,
  downloadMediaMessage
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import pino from "pino";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { storage } from "../storage";
import type { WhatsappAccount, ChatwootConfig } from "@shared/schema";
import { ChatwootService } from "./chatwoot";

const logger = pino({ level: "warn" });

interface WhatsAppConnection {
  socket: WASocket | null;
  chatwootService: ChatwootService | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  token: string; // unique per initializeAccount call — used to detect stale close events
}

export class ConnectionManager extends EventEmitter {
  private connections: Map<number, WhatsAppConnection> = new Map();
  private lidToPhone: Map<string, string> = new Map(); // LID JID → phone JID
  private groupNameCache: Map<string, string> = new Map(); // group JID → subject
  private static instance: ConnectionManager;

  private constructor() {
    super();
  }

  static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  async initializeAccount(accountId: number, freshStart: boolean = false, reconnectAttempt: number = 0): Promise<void> {
    const account = await storage.getWhatsappAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Stop existing connection if any
    await this.disconnectAccount(accountId);

    const sessionDir = path.join(process.cwd(), "server", "sessions", account.sessionPath);

    // Clear stale session so Baileys generates a fresh QR code
    if (freshStart) {
      await fs.rm(sessionDir, { recursive: true, force: true });
    }

    await fs.mkdir(sessionDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    await storage.updateWhatsappAccount(accountId, { status: "connecting" });
    this.emit("status", accountId, "connecting");

    const socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: [`WA Bridge - ${account.label} (#${accountId})`, "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      markOnlineOnConnect: true,
    });

    const connectionToken = `${accountId}-${Date.now()}-${Math.random()}`;
    const connection: WhatsAppConnection = {
      socket,
      chatwootService: null,
      reconnectAttempts: reconnectAttempt,
      maxReconnectAttempts: 5,
      token: connectionToken,
    };

    this.connections.set(accountId, connection);

    // Load Chatwoot config if exists
    const chatwootConfig = await storage.getChatwootConfig(accountId);
    if (chatwootConfig) {
      connection.chatwootService = new ChatwootService(chatwootConfig, accountId);
    }

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", async (update) => {
      const { connection: conn, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr);
          await storage.updateWhatsappAccount(accountId, { 
            status: "qr_ready", 
            qrCode: qrDataUrl 
          });
          this.emit("status", accountId, "qr_ready");
          this.emit("qr", accountId, qrDataUrl);
        } catch (err) {
          console.error(`[ConnectionManager] QR error for account ${accountId}:`, err);
        }
      }

      if (conn === "close") {
        const connData = this.connections.get(accountId);
        // If the connection was replaced by a newer initializeAccount call, ignore this stale close event
        if (!connData || connData.token !== connectionToken) return;

        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut &&
          connData.socket !== null;

        console.log(
          `[ConnectionManager] Account ${accountId} closed. Status: ${
            (lastDisconnect?.error as Boom)?.output?.statusCode
          }. Reconnect: ${shouldReconnect}`
        );

        if (shouldReconnect && connData.reconnectAttempts < connData.maxReconnectAttempts) {
          const nextAttempt = connData.reconnectAttempts + 1;
          const delay = Math.min(1000 * Math.pow(2, nextAttempt), 30000);
          console.log(`[ConnectionManager] Account ${accountId} reconnecting... Attempt ${nextAttempt}/${connData.maxReconnectAttempts}`);

          setTimeout(() => this.initializeAccount(accountId, false, nextAttempt), delay);
        } else {
          await storage.updateWhatsappAccount(accountId, { 
            status: "disconnected", 
            qrCode: null 
          });
          this.emit("status", accountId, "disconnected");
          this.connections.delete(accountId);
        }
      } else if (conn === "open") {
        const connData = this.connections.get(accountId);
        if (connData) {
          connData.reconnectAttempts = 0;
        }

        const phoneNumber = socket.user?.id?.split(":")[0] || socket.user?.id?.split("@")[0] || null;
        console.log(`[ConnectionManager] Account ${accountId} connected as ${phoneNumber}`);

        await storage.updateWhatsappAccount(accountId, {
          status: "connected",
          qrCode: null,
          phoneNumber,
          lastConnectedAt: new Date(),
        });

        this.emit("status", accountId, "connected");
      }
    });

    // Build LID → phone map from contacts events
    socket.ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        if (contact.id && (contact as any).lid) {
          this.lidToPhone.set((contact as any).lid, contact.id);
        }
      }
    });

    socket.ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (update.id && (update as any).lid) {
          this.lidToPhone.set((update as any).lid, update.id);
        }
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      const connData = this.connections.get(accountId);
      if (!connData || connData.token !== connectionToken) return;

      for (const msg of messages) {
        if (!msg.message) continue;

        // Unwrap view-once messages so media download and content extraction work normally
        const viewOnceInner = msg.message.viewOnceMessage?.message
          || msg.message.viewOnceMessageV2?.message
          || (msg.message as any).viewOnceMessageV2Extension?.message;
        if (viewOnceInner) {
          msg.message = viewOnceInner;
        }

        const content = this.extractMessageContent(msg);
        if (!content) continue;

        const isFromMe = msg.key.fromMe === true;
        let remoteJid = msg.key.remoteJid || "";
        const isGroup = remoteJid.endsWith("@g.us");

        // For group messages, the sender is in msg.key.participant (not remoteJid).
        // For DMs, senderJid is derived after LID resolution below.
        let senderJid = isGroup
          ? (msg.key.participant || remoteJid)
          : remoteJid;

        let pushName = msg.pushName || null;

        const syncAvatarSetting = await storage.getSetting(`account_${accountId}_sync_avatar`);
        const syncAvatar = syncAvatarSetting !== "false";

        // Fetch group name (always — independent of syncAvatar, uses in-memory cache)
        let groupName: string | null = null;
        if (isGroup) {
          const cacheKey = `${accountId}:${remoteJid}`;
          if (this.groupNameCache.has(cacheKey)) {
            // Cache hit — instant
            groupName = this.groupNameCache.get(cacheKey)!;
          } else {
            // Fast path: groupMetadata with 3s timeout (works for known/cached groups)
            try {
              const metadata = await Promise.race([
                socket.groupMetadata(remoteJid),
                new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
              ]);
              groupName = metadata?.subject || null;
              if (groupName) this.groupNameCache.set(cacheKey, groupName);
            } catch {
              groupName = null;
            }

            // Fallback: check groupFetchAllParticipating — Baileys syncs all groups on connect,
            // so this is usually cached and returns immediately without a network call.
            if (!groupName) {
              try {
                const allGroups = await Promise.race([
                  socket.groupFetchAllParticipating(),
                  new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
                ]);
                const found = allGroups?.[remoteJid];
                groupName = found?.subject || null;
                if (groupName) this.groupNameCache.set(cacheKey, groupName);
              } catch {
                groupName = null;
              }
            }

            // Background fetch: populate cache for next message regardless
            if (!groupName) {
              socket.groupMetadata(remoteJid)
                .then((m) => { if (m?.subject) this.groupNameCache.set(cacheKey, m.subject); })
                .catch(() => {});
            }
          }
        }

        // Fetch contact profile picture URL (2s timeout — slow WA response should not block message delivery)
        let avatarUrl: string | null = null;
        if (!isFromMe && syncAvatar) {
          try {
            avatarUrl = await Promise.race([
              socket.profilePictureUrl(isGroup ? remoteJid : senderJid, "image").then((u) => u ?? null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
            ]);
          } catch {
            avatarUrl = null;
          }
        }

        // Try to resolve LID to real phone JID
        if (remoteJid.endsWith("@lid")) {
          const mapped = this.lidToPhone.get(remoteJid);
          if (mapped) {
            console.log(`[ConnectionManager] Resolved LID ${remoteJid} to ${mapped} (contacts map)`);
            remoteJid = mapped;
            if (!isGroup) senderJid = mapped;
          } else {
            // Fallback: try Baileys internal signal repository
            try {
              const lidMapping = (socket as any).signalRepository?.lidMapping;
              if (lidMapping?.getPNForLID) {
                let phoneNumber = lidMapping.getPNForLID(remoteJid);
                if (phoneNumber && typeof phoneNumber.then === "function") {
                  phoneNumber = await phoneNumber;
                }
                if (phoneNumber && typeof phoneNumber === "string") {
                  console.log(`[ConnectionManager] Resolved LID ${remoteJid} to ${phoneNumber} (signal repo)`);
                  this.lidToPhone.set(remoteJid, phoneNumber);
                  remoteJid = phoneNumber;
                  if (!isGroup) senderJid = phoneNumber;
                } else {
                  console.log(`[ConnectionManager] Could not resolve LID ${remoteJid} - no mapping yet`);
                }
              }
            } catch (err) {
              console.log(`[ConnectionManager] LID resolution not available: ${err}`);
            }
          }
        }

        const direction = isFromMe ? "outgoing" : "incoming";
        console.log(`[ConnectionManager] Account ${accountId} ${direction} ${isGroup ? "group" : ""}: ${remoteJid} - ${content.substring(0, 50)}`);

        const logEnabledSetting = await storage.getSetting(`account_${accountId}_log_enabled`);
        const logEnabled = logEnabledSetting !== "false";
        if (logEnabled) {
          storage.addMessageLog({
            whatsappAccountId: accountId,
            direction,
            remoteJid,
            remoteName: isGroup ? groupName : pushName,
            chatwootMessageId: null,
            chatwootConversationId: null,
            whatsappMessageId: msg.key.id || null,
            content: content.substring(0, 200),
            status: connData.chatwootService ? "pending" : "no_chatwoot",
          }).catch((err) => console.error("[ConnectionManager] Failed to save message log:", err));
        }

        if (!connData.chatwootService) {
          continue;
        }

        // Extract media if present
        let mediaBuffer: Buffer | null = null;
        let mediaType: string | null = null;
        let mimeType: string | null = null;
        let fileName: string | null = null;

        try {
          const message = msg.message;
          if (message?.imageMessage) {
            mediaBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
            mediaType = "image";
            mimeType = message.imageMessage.mimetype || "image/jpeg";
            fileName = `image_${Date.now()}.${mimeType.split("/")[1] || "jpg"}`;
          } else if (message?.audioMessage) {
            mediaBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
            mediaType = "audio";
            mimeType = message.audioMessage.mimetype || "audio/ogg";
            fileName = `audio_${Date.now()}.${message.audioMessage.ptt ? "ogg" : (mimeType.split("/")[1] || "ogg")}`;
          } else if (message?.videoMessage) {
            mediaBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
            mediaType = "video";
            mimeType = message.videoMessage.mimetype || "video/mp4";
            fileName = `video_${Date.now()}.${mimeType.split("/")[1] || "mp4"}`;
          } else if (message?.documentMessage) {
            mediaBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
            mediaType = "document";
            mimeType = message.documentMessage.mimetype || "application/octet-stream";
            fileName = message.documentMessage.fileName || `document_${Date.now()}`;
          } else if (message?.stickerMessage) {
            mediaBuffer = await downloadMediaMessage(msg, "buffer", {}) as Buffer;
            mediaType = "sticker";
            mimeType = message.stickerMessage.mimetype || "image/webp";
            fileName = `sticker_${Date.now()}.webp`;
          }
        } catch (mediaError) {
          console.error(`[ConnectionManager] Failed to download media for account ${accountId}:`, mediaError);
        }

        try {
          await connData.chatwootService.handleIncomingMessage({
            remoteJid,
            senderJid,
            pushName: isGroup ? pushName : pushName,
            groupName,
            avatarUrl,
            isFromMe,
            content,
            messageId: msg.key.id || undefined,
            media: mediaBuffer ? {
              buffer: mediaBuffer,
              type: mediaType!,
              mimeType: mimeType!,
              fileName: fileName!,
            } : undefined,
          });
        } catch (error) {
          console.error(`[ConnectionManager] Failed to forward to Chatwoot for account ${accountId}:`, error);
        }
      }
    });

    // ── Outgoing webhook event listeners ──────────────────────────────────────

    socket.ev.on("messages.update", async (updates) => {
      const connData = this.connections.get(accountId);
      if (!connData || connData.token !== connectionToken) return;

      // Sync delivery/read status back to Chatwoot
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id || update.status === undefined) continue;

        // proto.WebMessageInfo.Status: DELIVERY_ACK=3, READ=4
        const status = update.status === 4 ? "read" : update.status === 3 ? "delivered" : null;
        if (!status) continue;

        try {
          const log = await storage.getMessageByWhatsAppId(accountId, key.id);
          if (!log?.chatwootMessageId) continue;

          await storage.updateMessageLogStatus(log.id, status);

          if (connData.chatwootService && log.chatwootConversationId && log.chatwootMessageId) {
            await connData.chatwootService.updateMessageDeliveryStatus(
              log.chatwootConversationId,
              log.chatwootMessageId,
              status
            );
          }
        } catch (err) {
          console.error(`[ConnectionManager] Failed to sync delivery status for ${key.id}:`, err);
        }
      }

      await this.dispatchWebhook(accountId, { event: "messages.update", accountId, data: updates });
    });

    socket.ev.on("messages.delete" as any, async (item: any) => {
      const connData = this.connections.get(accountId);
      if (!connData || connData.token !== connectionToken) return;
      await this.dispatchWebhook(accountId, { event: "messages.delete", accountId, data: item });
    });

    socket.ev.on("messages.reaction" as any, async (reactions: any) => {
      const connData = this.connections.get(accountId);
      if (!connData || connData.token !== connectionToken) return;
      await this.dispatchWebhook(accountId, { event: "messages.reaction", accountId, data: reactions });
    });

    socket.ev.on("blocklist.update" as any, async (update: any) => {
      const connData = this.connections.get(accountId);
      if (!connData || connData.token !== connectionToken) return;
      await this.dispatchWebhook(accountId, { event: "blocklist.update", accountId, data: update });
    });
  }

  private async dispatchWebhook(accountId: number, payload: object): Promise<void> {
    try {
      const webhookUrl = await storage.getSetting(`account_${accountId}_out_webhook_url`);
      if (!webhookUrl) return;

      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { "Content-Type": "application/json" };

      const secret = await storage.getSetting(`account_${accountId}_out_webhook_secret`);
      if (secret) {
        const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
        headers["x-webhook-signature"] = sig;
      }

      await fetch(webhookUrl, { method: "POST", headers, body });
    } catch (err) {
      console.error(`[ConnectionManager] Outgoing webhook dispatch failed for account ${accountId}:`, err);
    }
  }

  getChatwootService(accountId: number): ChatwootService | null {
    return this.connections.get(accountId)?.chatwootService ?? null;
  }

  async disconnectAccount(accountId: number, clearSession: boolean = false): Promise<void> {
    const connData = this.connections.get(accountId);
    if (connData?.socket) {
      const socket = connData.socket;
      // Clear from connections map first to prevent reconnect logic
      this.connections.delete(accountId);
      socket.end(undefined);
    }

    // Delete session files if requested (user-initiated disconnect)
    if (clearSession) {
      const account = await storage.getWhatsappAccount(accountId);
      if (account?.sessionPath) {
        const sessionDir = path.join(process.cwd(), "server", "sessions", account.sessionPath);
        try {
          await fs.rm(sessionDir, { recursive: true, force: true });
          console.log(`[ConnectionManager] Deleted session files for account ${accountId}: ${sessionDir}`);
        } catch (err) {
          console.error(`[ConnectionManager] Failed to delete session files:`, err);
        }
      }
      // Clear phone number and last connected since session is gone
      await storage.updateWhatsappAccount(accountId, { 
        status: "disconnected", 
        qrCode: null,
        phoneNumber: null,
        lastConnectedAt: null
      });
    } else {
      await storage.updateWhatsappAccount(accountId, { 
        status: "disconnected", 
        qrCode: null 
      });
    }
    
    this.emit("status", accountId, "disconnected");
  }

  async sendMessage(accountId: number, remoteJid: string, content: string): Promise<{ key?: { id?: string | null } } | null> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) {
      throw new Error(`Account ${accountId} not connected`);
    }

    const jid = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
    
    const result = await connData.socket.sendMessage(jid, { text: content });
    console.log(`[ConnectionManager] Account ${accountId} sent to ${jid}: ${content.substring(0, 50)}`);
    return result || null;
  }

  async sendMediaMessage(
    accountId: number, 
    remoteJid: string, 
    mediaUrl: string, 
    mediaType: string,
    caption?: string,
    fileName?: string
  ): Promise<{ key?: { id?: string | null } } | null> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) {
      throw new Error(`Account ${accountId} not connected`);
    }

    const jid = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
    
    try {
      // Download the media from the URL
      console.log(`[ConnectionManager] Downloading media from: ${mediaUrl}`);
      const response = await fetch(mediaUrl);
      if (!response.ok) {
        throw new Error(`Failed to download media: ${response.status}`);
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get("content-type") || "application/octet-stream";
      
      console.log(`[ConnectionManager] Downloaded ${buffer.length} bytes, type: ${contentType}`);

      let messageContent: any;
      
      // Determine WhatsApp message type based on content type or media type
      if (mediaType.includes("image") || contentType.startsWith("image/")) {
        messageContent = {
          image: buffer,
          caption: caption || undefined,
          mimetype: contentType,
        };
      } else if (mediaType.includes("video") || contentType.startsWith("video/")) {
        messageContent = {
          video: buffer,
          caption: caption || undefined,
          mimetype: contentType,
        };
      } else if (mediaType.includes("audio") || contentType.startsWith("audio/")) {
        // Check if it's a voice note (typically ogg/opus)
        const isVoice = contentType.includes("ogg") || contentType.includes("opus") || mediaType.includes("voice");
        messageContent = {
          audio: buffer,
          mimetype: contentType,
          ptt: isVoice, // Push-to-talk for voice messages
        };
      } else {
        // Default to document for all other types
        messageContent = {
          document: buffer,
          mimetype: contentType,
          fileName: fileName || `file_${Date.now()}`,
          caption: caption || undefined,
        };
      }

      const result = await connData.socket.sendMessage(jid, messageContent);
      console.log(`[ConnectionManager] Account ${accountId} sent media to ${jid}: ${mediaType}`);
      return result || null;
    } catch (error) {
      console.error(`[ConnectionManager] Failed to send media for account ${accountId}:`, error);
      throw error;
    }
  }

  async sendPresenceUpdate(accountId: number, jid: string, presence: "composing" | "paused"): Promise<void> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) return;
    const remoteJid = jid.includes("@") ? jid : `${jid}@s.whatsapp.net`;
    await connData.socket.sendPresenceUpdate(presence, remoteJid);
  }

  async deleteWhatsAppMessage(accountId: number, remoteJid: string, whatsappMessageId: string, fromMe: boolean): Promise<void> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) throw new Error(`Account ${accountId} not connected`);
    const jid = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
    await connData.socket.sendMessage(jid, {
      delete: { remoteJid: jid, id: whatsappMessageId, fromMe },
    });
  }

  async getGroups(accountId: number): Promise<Record<string, any>> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) throw new Error(`Account ${accountId} not connected`);
    return (connData.socket as any).groupFetchAllParticipating();
  }

  async getGroupMetadata(accountId: number, groupJid: string): Promise<any> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) throw new Error(`Account ${accountId} not connected`);
    const jid = groupJid.includes("@") ? groupJid : `${groupJid}@g.us`;
    return connData.socket.groupMetadata(jid);
  }

  async getContactInfo(accountId: number, phoneNumber: string): Promise<any> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) throw new Error(`Account ${accountId} not connected`);
    const jid = phoneNumber.includes("@") ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

    const timeout = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

    const ppUrl = await timeout(
      connData.socket.profilePictureUrl(jid, "image").catch(() => null),
      5000
    );

    return {
      jid,
      exists: true,
      profilePicture: ppUrl,
    };
  }

  async fetchBlocklist(accountId: number): Promise<string[]> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) throw new Error(`Account ${accountId} not connected`);
    const list = await (connData.socket as any).fetchBlocklist();
    return Array.isArray(list) ? list : [];
  }

  async updateBlockStatus(accountId: number, phoneNumber: string, action: "block" | "unblock"): Promise<void> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) throw new Error(`Account ${accountId} not connected`);
    const jid = phoneNumber.includes("@") ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
    await (connData.socket as any).updateBlockStatus(jid, action);
  }

  getConnection(accountId: number): WhatsAppConnection | undefined {
    return this.connections.get(accountId);
  }

  isConnected(accountId: number): boolean {
    const connData = this.connections.get(accountId);
    return !!connData?.socket;
  }

  async getUserProfile(accountId: number, phoneNumber: string): Promise<{
    profilePicture?: string;
    status?: string;
    exists: boolean;
  }> {
    const connData = this.connections.get(accountId);
    if (!connData?.socket) {
      throw new Error(`Account ${accountId} not connected`);
    }

    const jid = phoneNumber.includes("@") ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
    const result: { profilePicture?: string; status?: string; exists: boolean } = { exists: false };

    const timeout = <T>(p: Promise<T>, ms: number) =>
      Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

    try {
      result.exists = true;
      const ppUrl = await timeout(
        connData.socket.profilePictureUrl(jid, "image").catch(() => null),
        5000
      );
      if (ppUrl) result.profilePicture = ppUrl as string;
      return result;
    } catch (error) {
      console.error(`[ConnectionManager] Failed to get profile for ${jid}:`, error);
      return result;
    }
  }

  async updateChatwootConfig(accountId: number, config: ChatwootConfig): Promise<void> {
    const connData = this.connections.get(accountId);
    if (connData) {
      connData.chatwootService = new ChatwootService(config, accountId);
    }
  }

  private extractMessageContent(msg: proto.IWebMessageInfo): string | null {
    const message = msg.message;
    if (!message) return null;

    if (message.conversation) {
      return message.conversation;
    }
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text;
    }
    if (message.imageMessage?.caption) {
      return `[Image] ${message.imageMessage.caption}`;
    }
    if (message.imageMessage) {
      return "[Image]";
    }
    if (message.videoMessage?.caption) {
      return `[Video] ${message.videoMessage.caption}`;
    }
    if (message.videoMessage) {
      return "[Video]";
    }
    if (message.documentMessage) {
      return `[Document] ${message.documentMessage.fileName || "file"}`;
    }
    if (message.audioMessage) {
      return (message.audioMessage as any).ptt ? "[Voice Note]" : "[Audio]";
    }
    if (message.stickerMessage) {
      return "[Sticker]";
    }
    if (message.contactMessage) {
      return `[Contact] ${message.contactMessage.displayName}`;
    }
    if (message.locationMessage) {
      return "[Location]";
    }

    return null;
  }

  async initializeAllAccounts(): Promise<void> {
    // Restore all previously connected accounts on server startup
    try {
      const allAccounts = await storage.getAllWhatsappAccounts();
      const connectedAccounts = allAccounts.filter(
        (account: WhatsappAccount) => account.status === "connected" || account.lastConnectedAt
      );

      console.log(`[ConnectionManager] Restoring ${connectedAccounts.length} WhatsApp connections...`);

      for (const account of connectedAccounts) {
        try {
          console.log(`[ConnectionManager] Initializing account ${account.id} (${account.label})`);
          await this.initializeAccount(account.id);
        } catch (error) {
          console.error(`[ConnectionManager] Failed to restore account ${account.id}:`, error);
          // Update status to disconnected if restoration fails
          await storage.updateWhatsappAccount(account.id, { status: "disconnected" });
        }
      }
    } catch (error) {
      console.error("[ConnectionManager] Failed to restore accounts:", error);
    }
  }
}

export const connectionManager = ConnectionManager.getInstance();
