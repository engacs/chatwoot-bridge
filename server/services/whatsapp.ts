import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  BaileysEventMap,
  proto,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import * as QRCode from "qrcode";
import pino from "pino";
import { EventEmitter } from "events";
import { storage } from "../storage";
import type { ConnectionStatus, MessageLog } from "@shared/schema";
import path from "path";
import fs from "fs";

const logger = pino({ level: "warn" });

export interface WhatsAppMessage {
  remoteJid: string;
  remoteName: string | null;
  messageId: string;
  content: string;
  timestamp: Date;
  fromMe: boolean;
}

class WhatsAppService extends EventEmitter {
  private socket: WASocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 3000;
  private isConnecting = false;
  private sessionPath: string;

  constructor() {
    super();
    this.sessionPath = path.join(process.cwd(), "server", "session");
    this.ensureSessionDir();
  }

  private ensureSessionDir() {
    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true });
    }
  }

  async initialize(): Promise<void> {
    if (this.isConnecting) {
      console.log("[WhatsApp] Already connecting...");
      return;
    }

    this.isConnecting = true;

    try {
      await this.connect();
    } catch (error) {
      console.error("[WhatsApp] Failed to initialize:", error);
      this.isConnecting = false;
      await storage.updateSession({
        status: "disconnected",
        qrCode: null,
      });
    }
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

    await storage.updateSession({ status: "connecting" });
    this.emit("status", "connecting");

    this.socket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      browser: ["WhatsApp-Chatwoot Bridge", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: undefined,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: false,
      markOnlineOnConnect: true,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: {
              dark: "#000000",
              light: "#ffffff",
            },
          });
          await storage.updateSession({
            status: "qr_ready",
            qrCode: qrDataUrl,
          });
          this.emit("qr", qrDataUrl);
          this.emit("status", "qr_ready");
          console.log("[WhatsApp] QR code generated");
        } catch (err) {
          console.error("[WhatsApp] Failed to generate QR:", err);
        }
      }

      if (connection === "close") {
        this.isConnecting = false;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[WhatsApp] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          await this.clearSession();
          await storage.updateSession({
            status: "disconnected",
            qrCode: null,
            phoneNumber: null,
            connectedSince: null,
          });
          this.emit("status", "disconnected");
          this.emit("logout");
        } else if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`[WhatsApp] Reconnecting... Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
          
          await storage.updateSession({ status: "connecting" });
          this.emit("status", "connecting");
          
          setTimeout(() => {
            this.connect();
          }, this.reconnectDelay * this.reconnectAttempts);
        } else {
          await storage.updateSession({
            status: "disconnected",
            qrCode: null,
          });
          this.emit("status", "disconnected");
          this.emit("error", "Max reconnection attempts reached");
        }
      } else if (connection === "open") {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        
        const phoneNumber = this.socket?.user?.id?.split(":")[0] || null;
        const now = new Date().toISOString();
        
        await storage.updateSession({
          status: "connected",
          qrCode: null,
          phoneNumber,
          lastConnectedAt: now,
          connectedSince: now,
        });
        
        this.emit("status", "connected");
        this.emit("connected", phoneNumber);
        console.log(`[WhatsApp] Connected as ${phoneNumber}`);
      }
    });

    this.socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (!msg.message) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) continue;

        const content = this.extractMessageContent(msg);
        if (!content) continue;

        const remoteName = msg.pushName || null;
        const messageId = msg.key.id || "";
        const timestamp = new Date((msg.messageTimestamp as number) * 1000);

        const whatsappMessage: WhatsAppMessage = {
          remoteJid,
          remoteName,
          messageId,
          content,
          timestamp,
          fromMe: false,
        };

        console.log(`[WhatsApp] Received message from ${remoteJid}: ${content.substring(0, 50)}...`);
        this.emit("message", whatsappMessage);
      }
    });
  }

  private extractMessageContent(msg: proto.IWebMessageInfo): string | null {
    const message = msg.message;
    if (!message) return null;

    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return `[Image] ${message.imageMessage.caption}`;
    if (message.imageMessage) return "[Image]";
    if (message.videoMessage?.caption) return `[Video] ${message.videoMessage.caption}`;
    if (message.videoMessage) return "[Video]";
    if (message.audioMessage) return "[Audio]";
    if (message.documentMessage?.fileName) return `[Document] ${message.documentMessage.fileName}`;
    if (message.documentMessage) return "[Document]";
    if (message.stickerMessage) return "[Sticker]";
    if (message.contactMessage?.displayName) return `[Contact] ${message.contactMessage.displayName}`;
    if (message.locationMessage) return "[Location]";

    return null;
  }

  async sendMessage(remoteJid: string, content: string): Promise<proto.WebMessageInfo | null> {
    if (!this.socket) {
      console.error("[WhatsApp] Socket not connected");
      return null;
    }

    try {
      const formattedJid = remoteJid.includes("@") ? remoteJid : `${remoteJid}@s.whatsapp.net`;
      
      const result = await this.socket.sendMessage(formattedJid, { text: content });
      console.log(`[WhatsApp] Message sent to ${formattedJid}`);
      return result;
    } catch (error) {
      console.error("[WhatsApp] Failed to send message:", error);
      return null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      await this.socket.logout();
      this.socket = null;
    }
    await this.clearSession();
    await storage.updateSession({
      status: "disconnected",
      qrCode: null,
      phoneNumber: null,
      connectedSince: null,
    });
    this.emit("status", "disconnected");
  }

  private async clearSession(): Promise<void> {
    try {
      if (fs.existsSync(this.sessionPath)) {
        const files = fs.readdirSync(this.sessionPath);
        for (const file of files) {
          fs.unlinkSync(path.join(this.sessionPath, file));
        }
      }
    } catch (error) {
      console.error("[WhatsApp] Failed to clear session:", error);
    }
  }

  getStatus(): ConnectionStatus {
    return this.socket?.user ? "connected" : "disconnected";
  }

  isConnected(): boolean {
    return !!this.socket?.user;
  }
}

export const whatsappService = new WhatsAppService();
