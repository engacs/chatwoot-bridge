# WhatsApp-Chatwoot Bridge

## Overview

This is a bridge application that connects WhatsApp (via QR-based linked device login) to Chatwoot, enabling real-time bidirectional message synchronization for customer support teams. The system allows support agents to manage WhatsApp conversations through Chatwoot's interface.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens defined in CSS variables
- **Build Tool**: Vite with path aliases (`@/` for client src, `@shared/` for shared code)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **HTTP Server**: Express with custom middleware for logging and raw body capture
- **WhatsApp Integration**: @whiskeysockets/baileys library for WhatsApp Web API
- **Real-time Events**: EventEmitter pattern for WhatsApp status and message events

### Data Storage
- **ORM**: Drizzle ORM configured for PostgreSQL
- **Current Implementation**: In-memory storage (MemStorage class) for development
- **Schema Location**: `shared/schema.ts` defines types and database tables
- **Session Persistence**: WhatsApp session stored in `server/session/` directory

### Message Flow Architecture
1. **Incoming (WhatsApp → Chatwoot)**: WhatsApp messages trigger events → Chatwoot API creates/updates conversations
2. **Outgoing (Chatwoot → WhatsApp)**: Chatwoot webhooks → Express endpoint validates → WhatsApp sends via Baileys

### API Structure
- `GET /api/status` - WhatsApp connection status and QR code
- `POST /api/connect` - Initialize WhatsApp connection
- `POST /api/disconnect` - Terminate WhatsApp session
- `GET /api/messages` - Message logs
- `GET /api/webhooks` - Webhook event logs
- `POST /api/webhook/chatwoot` - Inbound webhook from Chatwoot

### Build System
- Development: `tsx` for TypeScript execution with Vite dev server
- Production: esbuild bundles server, Vite builds client to `dist/`

## External Dependencies

### WhatsApp Integration
- **Library**: @whiskeysockets/baileys (unofficial WhatsApp Web API)
- **Authentication**: QR code-based linked device login
- **Session Storage**: Multi-file auth state persisted to filesystem

### Chatwoot Integration
- **Type**: API Channel inbox
- **Authentication**: API access token (Profile Settings > Access Token)
- **Webhooks**: Inbound webhooks for `message_created` events
- **Optional**: HMAC signature verification via `CHATWOOT_WEBHOOK_SECRET`

### Required Environment Variables
| Variable | Purpose |
|----------|---------|
| `CHATWOOT_BASE_URL` | Chatwoot instance URL |
| `CHATWOOT_API_TOKEN` | API authentication token |
| `CHATWOOT_INBOX_ID` | Target inbox for messages |
| `CHATWOOT_ACCOUNT_ID` | Chatwoot account identifier |
| `DATABASE_URL` | PostgreSQL connection string |

### Database
- PostgreSQL (required for production, connection via `DATABASE_URL`)
- Drizzle Kit for migrations (`npm run db:push`)