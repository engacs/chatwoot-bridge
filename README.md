# WhatsApp–Chatwoot Bridge

Connect WhatsApp (via QR-based linked device) to [Chatwoot](https://www.chatwoot.com) for real-time two-way message sync. Supports multiple WhatsApp accounts, media messages, webhook debug logs, and per-account settings.

> **Recommended:** Pair this bridge with the **[engacs/chatwoot](https://github.com/engacs/chatwoot) Unlocked Edition** — a self-hosted fork of Chatwoot with all Enterprise features (Captain AI, SLA, Custom Roles, Audit Logs) enabled for free.
>
> ```bash
> docker pull engacs/chatwoot:unlocked
> ```

---

## How It Works

```
WhatsApp ──► Bridge Server ──► Chatwoot (incoming)
Chatwoot ──► Bridge Server ──► WhatsApp (outgoing)
```

- Incoming WhatsApp messages are forwarded to Chatwoot as conversations
- Outgoing replies typed in Chatwoot are sent back to WhatsApp
- Uses [Baileys](https://github.com/WhiskeySockets/Baileys) (no WhatsApp Business API required)

---

## Requirements

- **Node.js** 20+
- **pnpm** (`npm i -g pnpm`)
- **MySQL 8+** or **PostgreSQL 14+**
- **PM2** (`npm i -g pm2`) — for production
- A **Chatwoot** instance (self-hosted or cloud)
- A smartphone with WhatsApp installed

---

## Quick Setup (Interactive)

Run the setup wizard — it checks dependencies, creates `.env`, builds the app, and starts PM2:

```bash
bash setup.sh
```

---

## Manual Setup

### 1. Clone the repo

```bash
git clone https://github.com/engacs/chatwoot-bridge
cd chatwoot-bridge
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Create the `.env` file

```bash
cp .env.example .env
```

Edit `.env`:

```env
PORT=5001
SESSION_SECRET=your-long-random-string
DATABASE_URL=mysql://user:password@127.0.0.1:3306/chatwoot_bridge
```

The app auto-detects the database type from the URL (`mysql://` or `postgresql://`).

### 4. Create the database and tables

**MySQL** — create the database and user, then run:

```bash
mysql -u root -p chatwoot_bridge < sql/mysql.sql
```

**PostgreSQL** — create the database and user, then run:

```bash
psql -U whatsapp -d chatwoot_bridge -f sql/postgres.sql
```

> SQL files are in the [`sql/`](sql/) folder.

### 5. Build the app

```bash
pnpm run build
```

### 6. Start with PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

The app will be available at `http://your-server:5001`

---

## Chatwoot Setup

> If you are self-hosting Chatwoot, the **[engacs/chatwoot Unlocked Edition](https://github.com/engacs/chatwoot)** is recommended — all Enterprise features enabled for free.

### Create an API Inbox

1. Log in to Chatwoot → **Settings → Inboxes → Add Inbox**
2. Choose **API** as the channel type
3. Name it (e.g. "WhatsApp")
4. Note the **Inbox ID** shown after creation

### Add a Webhook

1. Go to **Settings → Integrations → Webhooks → Add new webhook**
2. URL: `https://your-server/api/webhook/chatwoot/<account-id>`
   *(shown in the app under each account's Chatwoot Integration card)*
3. Enable event: **Message Created**
4. Optionally set a **Webhook Secret**

---

## Connect a WhatsApp Account

1. Open the app and register/log in
2. Click **Add Account**, give it a label
3. Click **Connect WhatsApp** — a QR code appears
4. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**
5. Scan the QR code
6. Once connected, click **Configure Chatwoot** to enter your Chatwoot details

---

## Deploying Updates

```bash
bash deploy.sh
```

> WhatsApp sessions survive restarts — accounts reconnect automatically on startup.

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Port the server listens on (e.g. `5001`) |
| `SESSION_SECRET` | Any long random string for session signing |
| `DATABASE_URL` | MySQL or PostgreSQL connection string |

---

## Project Structure

```
├── client/          # React frontend (Vite + Tailwind)
├── server/          # Express backend
│   ├── services/
│   │   ├── connection-manager.ts   # Baileys WebSocket connections
│   │   └── chatwoot.ts             # Chatwoot API integration
│   ├── routes.ts    # API routes
│   ├── storage.ts   # Database layer (MySQL & PostgreSQL)
│   └── ws.ts        # WebSocket for real-time UI updates
├── shared/
│   ├── schema.ts    # MySQL Drizzle schema
│   └── schema-pg.ts # PostgreSQL Drizzle schema
├── sql/
│   ├── mysql.sql    # MySQL table setup
│   └── postgres.sql # PostgreSQL table setup
├── ecosystem.config.cjs   # PM2 config
├── setup.sh               # Interactive first-time setup
├── deploy.sh              # One-command deploy
└── .env.example           # Environment variable template
```

---

## Troubleshooting

**QR code not appearing**
Click **Stop** then **Connect WhatsApp** again. Session files are cleared on each fresh connect.

**Messages not reaching Chatwoot**
Check **Webhook Debug Logs** for the account. A `401` means wrong API token; `404` means wrong account or inbox ID.

**Database connection refused**
Use `127.0.0.1` instead of `localhost` in `DATABASE_URL`.

**PM2 keeps crashing**
Run `pm2 logs chatwoot-bridge` to see the error.
