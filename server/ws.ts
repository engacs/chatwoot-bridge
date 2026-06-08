import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { connectionManager } from "./services/connection-manager";

interface WsMessage {
  type: "status" | "qr" | "ping";
  accountId?: number;
  status?: string;
  qrCode?: string;
}

function broadcast(wss: WebSocketServer, msg: WsMessage) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

export function setupWebSocket(httpServer: Server) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
      } catch {}
    });
  });

  connectionManager.on("status", (accountId: number, status: string) => {
    broadcast(wss, { type: "status", accountId, status });
  });

  connectionManager.on("qr", (accountId: number, qrCode: string) => {
    broadcast(wss, { type: "qr", accountId, qrCode });
  });

  return wss;
}
