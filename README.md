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

Run the setup wizard — it installs dependencies, creates `.env`, creates the database, builds, and starts PM2:

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

Edit `.env` with your values:

```env
PORT=5001
SESSION_SECRET=your-long-random-string

# MySQL
DATABASE_URL=mysql://user:password@127.0.0.1:3306/chatwoot_bridge

# PostgreSQL (alternative)
# DATABASE_URL=postgresql://user:password@127.0.0.1:5432/chatwoot_bridge
```

The app auto-detects the database type from the URL prefix (`mysql://` or `postgresql://`).

### 4. Create the database

**MySQL:**

```sql
CREATE DATABASE chatwoot_bridge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'whatsapp'@'%' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON chatwoot_bridge.* TO 'whatsapp'@'%';
FLUSH PRIVILEGES;
```

Then create the tables:

```sql
USE chatwoot_bridge;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  is_admin TINYINT(1) NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE whatsapp_accounts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  label VARCHAR(255) NOT NULL,
  phone_number VARCHAR(50),
  status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
  qr_code TEXT,
  session_path VARCHAR(255) NOT NULL,
  last_connected_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE chatwoot_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_account_id INT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  api_token TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  webhook_secret TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE message_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_account_id INT NOT NULL,
  direction VARCHAR(50) NOT NULL,
  remote_jid TEXT NOT NULL,
  remote_name TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  chatwoot_message_id TEXT,
  whatsapp_message_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_account_id INT,
  direction TEXT NOT NULL DEFAULT 'incoming',
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  headers JSON NOT NULL,
  body JSON NOT NULL,
  status_code INT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  whatsapp_account_id INT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSON NOT NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  error TEXT,
  processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(255) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**PostgreSQL:**

```sql
CREATE DATABASE chatwoot_bridge;
CREATE USER whatsapp WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE chatwoot_bridge TO whatsapp;
```

Then create the tables:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE whatsapp_accounts (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  phone_number TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
  session_path TEXT NOT NULL,
  qr_code TEXT,
  last_connected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE chatwoot_configs (
  id SERIAL PRIMARY KEY,
  whatsapp_account_id INT NOT NULL UNIQUE REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  api_token TEXT NOT NULL,
  inbox_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  webhook_secret TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE message_logs (
  id SERIAL PRIMARY KEY,
  whatsapp_account_id INT NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  remote_jid TEXT NOT NULL,
  remote_name TEXT,
  chatwoot_message_id TEXT,
  whatsapp_message_id TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_events (
  id SERIAL PRIMARY KEY,
  whatsapp_account_id INT NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSON NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_logs (
  id SERIAL PRIMARY KEY,
  whatsapp_account_id INT REFERENCES whatsapp_accounts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL DEFAULT 'incoming',
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  headers JSON NOT NULL,
  body JSON NOT NULL,
  status_code INT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE app_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

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

> If you are self-hosting Chatwoot, the **[engacs/chatwoot Unlocked Edition](https://github.com/engacs/chatwoot)** is recommended. It removes all feature gates so Captain AI, SLA, Custom Roles and more work out of the box — no paid plan required.

### Create an API Inbox

1. Log in to Chatwoot → **Settings → Inboxes → Add Inbox**
2. Choose **API** as the channel type
3. Name it (e.g. "WhatsApp")
4. Note the **Inbox ID** shown after creation

### Add a Webhook

1. Go to **Settings → Integrations → Webhooks → Add new webhook**
2. URL: `https://your-server/api/webhook/chatwoot/<account-id>`  
   *(The exact URL is shown in the app under each account's Chatwoot Integration card)*
3. Enable event: **Message Created**
4. Optionally set a **Webhook Secret** for request signing

---

## Connect a WhatsApp Account

1. Open the app and register/log in
2. Click **Add Account**, give it a label
3. Click **Connect WhatsApp** — a QR code appears
4. On your phone: **WhatsApp → Settings → Linked Devices → Link a Device**
5. Scan the QR code
6. Once connected, open the account and click **Configure Chatwoot** to enter your Chatwoot details

---

## Deploying Updates

After a code change, pull and redeploy with one command:

```bash
bash deploy.sh
```

Or step by step:

```bash
git pull
pnpm install        # pick up any new packages
pnpm run build      # rebuild client + server
pm2 restart chatwoot-bridge
```

> WhatsApp sessions are stored on disk (`server/sessions/`). PM2 restarts do **not** disconnect your WhatsApp accounts — they reconnect automatically on startup.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | ✅ | Port the server listens on (e.g. `5001`) |
| `SESSION_SECRET` | ✅ | Any long random string for session signing |
| `DATABASE_URL` | ✅ | MySQL or PostgreSQL connection string |

---

## Project Structure

```
├── client/          # React frontend (Vite + Tailwind)
├── server/          # Express backend
│   ├── services/
│   │   ├── connection-manager.ts   # Manages Baileys WebSocket connections
│   │   └── chatwoot.ts             # Chatwoot API integration
│   ├── routes.ts    # All API routes
│   ├── storage.ts   # Database layer (Drizzle ORM — MySQL & PostgreSQL)
│   └── ws.ts        # WebSocket server for real-time UI updates
├── shared/
│   ├── schema.ts    # MySQL Drizzle schema
│   └── schema-pg.ts # PostgreSQL Drizzle schema
├── script/
│   └── build.ts     # esbuild + Vite build script
├── ecosystem.config.cjs   # PM2 config
├── setup.sh               # Interactive first-time setup wizard
├── deploy.sh              # One-command deploy (git pull + build + restart)
└── .env                   # Your environment variables (not committed)
```

---

## Troubleshooting

**QR code not appearing**  
Click **Connect WhatsApp** — if it stays on "Connecting", click **Stop** then try again. Old session files are cleared on each fresh connect.

**Messages not reaching Chatwoot**  
Check the **Webhook Debug Logs** page for the account. Look for outgoing API calls and their response codes. A `401` means the API token is wrong; a `404` means the account ID or inbox ID is wrong.

**Database connection refused**  
Use `127.0.0.1` instead of `localhost` in your `DATABASE_URL` to force a TCP connection.

**PM2 process keeps crashing**  
Run `pm2 logs chatwoot-bridge` to see the error. Most common causes: missing `.env`, wrong `DATABASE_URL`, or port already in use.
