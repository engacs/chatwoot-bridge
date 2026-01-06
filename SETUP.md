# WhatsApp-Chatwoot Bridge - Setup Guide

This system connects WhatsApp (via Linked Device / QR-based login) to Chatwoot using an API Channel, enabling real-time message synchronization for customer support.

## Prerequisites

- Node.js 20 or higher
- A Chatwoot account (self-hosted or cloud)
- A smartphone with WhatsApp installed

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `CHATWOOT_BASE_URL` | Your Chatwoot instance URL (e.g., `https://app.chatwoot.com`) |
| `CHATWOOT_API_TOKEN` | API access token from Chatwoot (Profile Settings > Access Token) |
| `CHATWOOT_INBOX_ID` | The inbox ID for the API channel |
| `CHATWOOT_ACCOUNT_ID` | Your Chatwoot account ID |
| `CHATWOOT_WEBHOOK_SECRET` | (Optional) Secret for webhook signature verification |

### 3. Create a Chatwoot API Channel

1. Log in to your Chatwoot dashboard
2. Go to **Settings** > **Inboxes** > **Add Inbox**
3. Select **API** as the channel type
4. Name it "WhatsApp Bridge" or similar
5. Note the **Inbox ID** for your environment variables

### 4. Configure Chatwoot Webhook

1. In your Chatwoot inbox settings, go to **Webhooks**
2. Add a new webhook with URL: `https://your-app-url/api/webhook/chatwoot`
3. Select events: `message_created`
4. If using a secret, set it and add it to `CHATWOOT_WEBHOOK_SECRET`

### 5. Start the Application

```bash
npm run dev
```

### 6. Connect WhatsApp

1. Open the application in your browser (default: `http://localhost:5000`)
2. Wait for the QR code to appear
3. Open WhatsApp on your phone
4. Go to **Settings** > **Linked Devices** > **Link a Device**
5. Scan the QR code

## How It Works

### Message Flow

```
WhatsApp User → WhatsApp → Bridge → Chatwoot → Agent
Agent → Chatwoot → Webhook → Bridge → WhatsApp → User
```

1. **Incoming Messages**: When a WhatsApp user sends a message, it's received by the bridge and forwarded to Chatwoot as an incoming message in the configured inbox.

2. **Outgoing Messages**: When an agent replies in Chatwoot, the webhook triggers the bridge to send the message back to WhatsApp.

### Session Persistence

The WhatsApp session is stored in `server/session/` and will automatically reconnect on server restart. If the session expires or becomes invalid, a new QR code will be generated.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | GET | Get current session status |
| `/api/session/connect` | POST | Start connection (generates QR) |
| `/api/session/disconnect` | POST | Disconnect and clear session |
| `/api/logs` | GET | Get recent message logs |
| `/api/webhooks` | GET | Get recent webhook events |
| `/api/chatwoot/config` | GET | Get Chatwoot configuration status |
| `/api/webhook/chatwoot` | POST | Webhook endpoint for Chatwoot |
| `/api/health` | GET | Health check endpoint |

## Deployment

### Using Docker

```bash
docker build -t whatsapp-chatwoot-bridge .
docker run -p 5000:5000 --env-file .env whatsapp-chatwoot-bridge
```

### On Replit

1. Fork this repl
2. Add your environment variables in the Secrets tab
3. Click Run

### Production Considerations

1. **Session Storage**: For production, consider mounting a persistent volume for `server/session/`
2. **Security**: Always set `CHATWOOT_WEBHOOK_SECRET` and validate signatures
3. **Rate Limiting**: WhatsApp has rate limits; implement queuing for high-volume use
4. **Monitoring**: Use the `/api/health` endpoint for health checks

## Troubleshooting

### QR Code Not Appearing

- Check the server logs for connection errors
- Ensure no other WhatsApp Web sessions are blocking the connection
- Try disconnecting and reconnecting

### Messages Not Syncing to Chatwoot

- Verify `CHATWOOT_API_TOKEN` has the correct permissions
- Check `CHATWOOT_INBOX_ID` matches your API channel
- Review server logs for API errors

### Webhook Not Working

- Verify the webhook URL is publicly accessible
- Check Chatwoot webhook logs for delivery status
- Ensure `message_created` event is selected

### Session Lost on Restart

- Ensure `server/session/` directory has write permissions
- Check that the session files are being created
- For Docker, mount a persistent volume

## Sample Webhook Payloads

### Incoming Message (WhatsApp → Chatwoot)

The bridge receives this from WhatsApp and creates a message in Chatwoot:

```json
{
  "remoteJid": "1234567890@s.whatsapp.net",
  "remoteName": "John Doe",
  "messageId": "3EB0123456789ABCDEF",
  "content": "Hello, I need help!",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "fromMe": false
}
```

### Outgoing Message (Chatwoot → WhatsApp)

The bridge receives this webhook from Chatwoot:

```json
{
  "event": "message_created",
  "id": 12345,
  "content": "Hi! How can I help you today?",
  "content_type": "text",
  "message_type": "outgoing",
  "conversation": {
    "id": 100,
    "inbox_id": 1,
    "contact_inbox": {
      "source_id": "1234567890@s.whatsapp.net"
    },
    "meta": {
      "sender": {
        "id": 5,
        "name": "John Doe",
        "phone_number": "+1234567890"
      }
    }
  },
  "sender": {
    "id": 1,
    "type": "user"
  }
}
```

## License

MIT
