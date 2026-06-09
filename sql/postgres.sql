-- WhatsApp–Chatwoot Bridge — PostgreSQL setup
-- Run this after creating the database and user

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password TEXT NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_accounts (
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

CREATE TABLE IF NOT EXISTS chatwoot_configs (
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

CREATE TABLE IF NOT EXISTS message_logs (
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

CREATE TABLE IF NOT EXISTS webhook_events (
  id SERIAL PRIMARY KEY,
  whatsapp_account_id INT NOT NULL REFERENCES whatsapp_accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSON NOT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  error TEXT,
  processed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_logs (
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

CREATE TABLE IF NOT EXISTS app_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(255) NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
