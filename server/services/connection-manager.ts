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
import { storage } from "../storage";
import type { WhatsappAccount, ChatwootConfig } from "@shared/schema";
import { ChatwootService } from "./chatwoot";

const logger = pino({ level: "warn" });

interface WhatsAppConnection {
  socket: WASocket | null;
  chatwootService: ChatwootService | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
}

export class ConnectionManager extends EventEmitter {
  private connections: Map<number, WhatsAppConnection> = new Map();
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

  async initializeAccount(accountId: number): Promise<void> {
    const account = await storage.getWhatsappAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Stop existing connection if any
    await this.disconnectAccount(accountId);

    const sessionDir = path.join(process.cwd(), "server", "sessions", account.sessionPath);
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
      browser: ["WhatsApp-Chatwoot Bridge", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      markOnlineOnConnect: true,
    });

    const connection: WhatsAppConnection = {
      socket,
      chatwootService: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 5,
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
        if (!connData) return;

        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut &&
          connData.socket !== null;

        console.log(
          `[ConnectionManager] Account ${accountId} closed. Status: ${
            (lastDisconnect?.error as Boom)?.output?.statusCode
          }. Reconnect: ${shouldReconnect}`
        );

        if (shouldReconnect && connData.reconnectAttempts < connData.maxReconnectAttempts) {
          connData.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, connData.reconnectAttempts), 30000);
          console.log(`[ConnectionManager] Account ${accountId} reconnecting... Attempt ${connData.reconnectAttempts}/${connData.maxReconnectAttempts}`);
          
          setTimeout(() => this.initializeAccount(accountId), delay);
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

    // Listen for LID to phone number mappings
    socket.ev.on("lid-mapping.update" as any, (mapping: Array<{ lid: string; pn: string }>) => {
      console.log(`[ConnectionManager] Account ${accountId} received LID mappings:`, mapping.length);
      for (const { lid, pn } of mapping) {
        console.log(`[ConnectionManager] LID mapping: ${lid} -> ${pn}`);
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      const connData = this.connections.get(accountId);
      if (!connData?.chatwootService) return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;

        const content = this.extractMessageContent(msg);
        if (!content) continue;

        let remoteJid = msg.key.remoteJid || "";
        const pushName = msg.pushName || null;

        // Try to resolve LID to phone number
        if (remoteJid.endsWith("@lid")) {
          try {
            const lidMapping = (socket as any).signalRepository?.lidMapping;
            if (lidMapping?.getPNForLID) {
              const phoneNumber = lidMapping.getPNForLID(remoteJid);
              if (phoneNumber) {
                console.log(`[ConnectionManager] Resolved LID ${remoteJid} to ${phoneNumber}`);
                remoteJid = phoneNumber;
              } else {
                console.log(`[ConnectionManager] Could not resolve LID ${remoteJid} - no mapping available yet`);
              }
            }
          } catch (err) {
            console.log(`[ConnectionManager] LID resolution not available: ${err}`);
          }
        }

        console.log(`[ConnectionManager] Account ${accountId} incoming: ${remoteJid} - ${content.substring(0, 50)}`);

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
            pushName,
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
  }

  async disconnectAccount(accountId: number): Promise<void> {
    const connData = this.connections.get(accountId);
    if (connData?.socket) {
      const socket = connData.socket;
      // Clear from connections map first to prevent reconnect logic
      this.connections.delete(accountId);
      socket.end(undefined);
    }
    await storage.updateWhatsappAccount(accountId, { 
      status: "disconnected", 
      qrCode: null 
    });
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

    try {
      // Check if user exists on WhatsApp
      const existsResult = await connData.socket.onWhatsApp(jid);
      if (!existsResult || !existsResult.length || !existsResult[0]?.exists) {
        return result;
      }
      result.exists = true;

      // Get profile picture
      try {
        const ppUrl = await connData.socket.profilePictureUrl(jid, "image");
        result.profilePicture = ppUrl;
      } catch (e) {
        // User may not have a profile picture
      }

      // Get status/about - fetchStatus returns array format in newer Baileys
      try {
        const statusResult = await connData.socket.fetchStatus(jid) as any;
        if (statusResult && Array.isArray(statusResult) && statusResult[0]?.status) {
          result.status = statusResult[0].status;
        } else if (statusResult?.status) {
          result.status = statusResult.status;
        }
      } catch (e) {
        // Status may not be available
      }

      console.log(`[ConnectionManager] Got profile for ${jid}: pic=${!!result.profilePicture}, status=${!!result.status}`);
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
      return "[Audio]";
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
