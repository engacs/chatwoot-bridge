# WhatsApp-Chatwoot Integration System - Design Guidelines

## Design Approach
**System Selected:** Utility Dashboard Pattern (inspired by Linear, Vercel, Railway)
**Rationale:** This is a production tool for technical users managing WhatsApp integration. Prioritize clarity, status visibility, and functional efficiency over visual flourish.

---

## Core Design Elements

### Typography
- **Primary Font:** Inter (via Google Fonts CDN)
- **Hierarchy:**
  - Page titles: text-2xl font-semibold
  - Section headers: text-lg font-medium
  - Body text: text-sm
  - Status labels: text-xs font-medium uppercase tracking-wide
  - Code/technical data: font-mono text-sm

### Layout System
**Spacing Units:** Use Tailwind units of 2, 4, 6, and 8 consistently
- Component padding: p-4 or p-6
- Section gaps: space-y-6
- Card spacing: gap-4
- Button padding: px-4 py-2

**Container Strategy:**
- Max width: max-w-4xl mx-auto
- Page padding: px-4 md:px-6
- Vertical rhythm: py-8 for page sections

---

## Component Library

### 1. QR Code Display Card
- Centered card with elevated appearance
- QR code centered with p-8
- Connection status badge positioned top-right
- Instruction text below QR (text-sm, muted)
- Auto-refresh indicator when generating new code

### 2. Status Indicators
**Connection Status Badge:**
- Connected: solid indicator with "Connected" label
- Disconnected: outline indicator with "Disconnected" label  
- Connecting: pulsing animation with "Connecting..." label
- Position: sticky top-4 right-4 or inline with sections

**Status Pills:** Small rounded badges (px-3 py-1 text-xs font-medium rounded-full)

### 3. Configuration Panel
- Form layout with labeled inputs
- Input fields: w-full px-3 py-2 border rounded-md
- Labels: block text-sm font-medium mb-2
- Help text: text-xs muted, mt-1
- Password fields with show/hide toggle
- Save button: primary style, bottom-right alignment

### 4. Information Cards
**Webhook Endpoint Display:**
- Monospace URL display with copy button
- Visual border/background to distinguish from surrounding content
- "Copy to clipboard" button aligned right

**Session Info Card:**
- Grid layout for key-value pairs
- Labels on left, values on right
- Separator lines between rows

### 5. Log/Event Stream
- Scrollable container with max-height
- Each log entry: timestamp + message
- Color-coded by type (success, error, info, warning)
- Newest messages at top
- Auto-scroll toggle button

### 6. Navigation
- Simple top bar with logo/title on left
- Connection status on right
- Minimal tab navigation if multiple views needed

### 7. Empty States
- Centered icon + text for "Not Connected" state
- Clear call-to-action ("Scan QR Code to Connect")

---

## Page Structure

### Main Dashboard View
1. **Header Bar** (fixed/sticky)
   - App title: "WhatsApp-Chatwoot Bridge"
   - Connection status indicator
   
2. **Primary Content Area**
   - If disconnected: Large QR code card (centered)
   - If connected: Session info card + webhook endpoint display
   
3. **Secondary Panel** (below or side-by-side on desktop)
   - Configuration form (collapsible)
   - Recent activity log

4. **Footer** (optional)
   - Version info
   - Documentation link

---

## Visual Treatment Guidelines

**Borders:** Use subtle borders (border-gray-200) for card separation
**Shadows:** Minimal elevation (shadow-sm for cards, shadow-md for modals)
**Radius:** Consistent rounded corners (rounded-lg for cards, rounded-md for inputs)
**Density:** Information-dense but not cramped - prioritize readability

**Interactive States:**
- Buttons implement their own hover/active states
- Focus rings on all interactive elements (ring-2 ring-offset-2)
- Disabled states clearly muted (opacity-50)

---

## Responsive Behavior

- **Mobile (base):** Single column, stacked layout
- **Desktop (md:):** Can use side-by-side layout for config + status
- QR code scales appropriately but remains scannable
- Log panel becomes collapsible on mobile

---

## Critical UX Principles

1. **Status First:** Connection state visible at all times
2. **Error Clarity:** Error messages prominent with actionable guidance
3. **Copy-Friendly:** All technical data (URLs, IDs) easily copyable
4. **Reconnect UX:** Clear path to re-authenticate when disconnected
5. **Minimal Clicks:** Primary actions (connect, disconnect) immediately accessible

---

## Assets

**Icons:** Heroicons (via CDN)
- Use: wifi (connected), wifi-slash (disconnected), cog (settings), clipboard (copy), refresh (reconnect)

**QR Code:** Generated server-side, displayed as image

**No Custom Graphics Needed:** This is a utility interface - prioritize function over decoration