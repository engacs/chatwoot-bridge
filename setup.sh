#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

step() { echo -e "\n${CYAN}==> $1${NC}"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}! $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

echo ""
echo "╔════════════════════════════════════════╗"
echo "║    WhatsApp–Chatwoot Bridge Setup      ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── Check requirements ──────────────────────────────────────────────────────

step "Checking requirements"

command -v node >/dev/null 2>&1 || err "Node.js is not installed. Install v20+ from https://nodejs.org"
NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
[ "$NODE_VER" -ge 20 ] || err "Node.js v20+ required (you have v$NODE_VER)"
ok "Node.js v$(node -v)"

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm not found — installing..."
  npm install -g pnpm
fi
ok "pnpm $(pnpm -v)"

if ! command -v pm2 >/dev/null 2>&1; then
  warn "PM2 not found — installing..."
  npm install -g pm2
fi
ok "PM2 $(pm2 -v)"

# ── .env ────────────────────────────────────────────────────────────────────

step "Configuring .env"

if [ -f .env ]; then
  warn ".env already exists — skipping (delete it to reconfigure)"
else
  echo ""
  echo "Choose database type:"
  echo "  1) MySQL"
  echo "  2) PostgreSQL"
  read -rp "Enter choice [1]: " DB_CHOICE
  DB_CHOICE=${DB_CHOICE:-1}

  read -rp "Database host [127.0.0.1]: " DB_HOST
  DB_HOST=${DB_HOST:-127.0.0.1}

  if [ "$DB_CHOICE" = "2" ]; then
    read -rp "Database port [5432]: " DB_PORT
    DB_PORT=${DB_PORT:-5432}
    DB_PROTO="postgresql"
  else
    read -rp "Database port [3306]: " DB_PORT
    DB_PORT=${DB_PORT:-3306}
    DB_PROTO="mysql"
  fi

  read -rp "Database name [chatwoot_bridge]: " DB_NAME
  DB_NAME=${DB_NAME:-chatwoot_bridge}

  read -rp "Database user [whatsapp]: " DB_USER
  DB_USER=${DB_USER:-whatsapp}

  read -rsp "Database password: " DB_PASS
  echo ""

  read -rp "Port for bridge server [5001]: " APP_PORT
  APP_PORT=${APP_PORT:-5001}

  SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

  cat > .env <<EOF
PORT=${APP_PORT}
SESSION_SECRET=${SESSION_SECRET}
DATABASE_URL=${DB_PROTO}://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}
EOF

  ok ".env created"
fi

source .env

# ── Install dependencies ─────────────────────────────────────────────────────

step "Installing dependencies"
pnpm install
ok "Dependencies installed"

# ── Test database connection ─────────────────────────────────────────────────

step "Testing database connection"

DB_URL="$DATABASE_URL"
DB_PROTO=$(echo "$DB_URL" | cut -d: -f1)

if [[ "$DB_PROTO" == "mysql" ]]; then
  DB_HOST_CLEAN=$(echo "$DB_URL" | sed -E 's|mysql://[^@]+@([^:/]+).*|\1|')
  DB_PORT_CLEAN=$(echo "$DB_URL" | sed -E 's|mysql://[^@]+@[^:]+:([0-9]+)/.*|\1|')
  DB_USER_CLEAN=$(echo "$DB_URL" | sed -E 's|mysql://([^:]+):.*|\1|')
  DB_PASS_CLEAN=$(echo "$DB_URL" | sed -E 's|mysql://[^:]+:([^@]+)@.*|\1|')
  DB_NAME_CLEAN=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')

  if command -v mysql >/dev/null 2>&1; then
    mysql -h "$DB_HOST_CLEAN" -P "$DB_PORT_CLEAN" -u "$DB_USER_CLEAN" -p"$DB_PASS_CLEAN" -e "SELECT 1;" "$DB_NAME_CLEAN" >/dev/null 2>&1 && ok "MySQL connection OK" || warn "Could not connect to MySQL — make sure the database and user exist"
  else
    warn "mysql client not found — skipping connection test"
  fi
elif [[ "$DB_PROTO" == "postgresql" || "$DB_PROTO" == "postgres" ]]; then
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -c "SELECT 1;" >/dev/null 2>&1 && ok "PostgreSQL connection OK" || warn "Could not connect to PostgreSQL — make sure the database and user exist"
  else
    warn "psql not found — skipping connection test"
  fi
fi

# ── Build ────────────────────────────────────────────────────────────────────

step "Building the app"
pnpm run build
ok "Build complete"

# ── PM2 ─────────────────────────────────────────────────────────────────────

step "Starting with PM2"

if pm2 describe chatwoot-bridge >/dev/null 2>&1; then
  pm2 restart chatwoot-bridge
  ok "PM2 process restarted"
else
  pm2 start ecosystem.config.cjs
  pm2 save
  ok "PM2 process started"
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Setup complete! ✓            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "  App running on: ${CYAN}http://localhost:${APP_PORT:-5001}${NC}"
echo ""
echo "  Next steps:"
echo "  1. Open the app and register your account"
echo "  2. Add a WhatsApp account and scan the QR code"
echo "  3. Configure Chatwoot integration in the account settings"
echo ""
echo -e "  Run ${CYAN}pm2 logs chatwoot-bridge${NC} to view live logs"
echo -e "  Run ${CYAN}bash deploy.sh${NC} after future git pulls"
echo ""
