#!/bin/bash
set -e

echo "==> Pulling latest changes..."
git pull

echo "==> Installing dependencies..."
pnpm install

echo "==> Building app..."
pnpm run build

echo "==> Restarting PM2..."
pm2 restart chatwoot-bridge

echo "==> Done! App is running."
pm2 status chatwoot-bridge
