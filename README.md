# MPRAR — HR Platform Frontend

> **React/Vite SPA for the MPRAR HR Platform.**  
> Part of the MPRAR multi-product SaaS ecosystem.

---

## Overview

The HR Platform Frontend is a React + Vite single-page application that provides the full HR management experience: employee management, timesheets, absences, documents, certificates, training, and seat management. It communicates exclusively with the **HR Platform Backend** (`:5001`) via REST and WebSocket — there is no Firebase dependency.

**Authentication** flows through the MPRAR Central Platform SSO bridge (JWT).  
**Real-time** updates arrive via WebSocket (`/hr/ws`).  
**Push Notifications** use the Web Push API (VAPID) with a service worker at `public/sw.js`.

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in HR backend URL and Central platform URL
```

### 3. Start Development Server
```bash
npm run dev
```
The HR portal will be available at `http://localhost:4028`.

---

## Architecture

```
Central Platform Frontend (:5173)
        │  SSO Bridge (JWT)
        ▼
HR Platform Frontend (:4028)   ◀──▶   HR Platform Backend (:5001)
  React + Vite                           PostgreSQL + WebSocket
  Tailwind CSS                           Web Push (VAPID)
  WebSocket client
  Service Worker (push)
```

### API Clients

Two Axios instances are configured in `src/services/`:

| Client | Base URL | Used For |
|--------|----------|----------|
| `hrApiClient` | `http://localhost:5001` | All HR data endpoints |
| `apiClient` | `http://localhost:5000` | Central platform (billing checkout, company info) |

> Always use `hrApiClient` for `/hr/...` endpoints. Using `apiClient` for HR endpoints is a common mistake — it points to the wrong service.

---

## Key Features

- **Employee Management**: Add, edit, archive employees with role-based access control
- **Seat Management**: Role-aware seat quota enforcement with purchase and request flows
- **Timesheets**: Weekly timesheet submission, approval, and clock in/out
- **Absences**: Request, approve, and track employee absences
- **Documents & Certificates**: Upload and track employee documents with S3 storage
- **Training**: Assign and track training courses
- **Notifications**: In-app notification centre + Web Push for seat request updates
- **Real-time Updates**: WebSocket connection for live data synchronisation

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18 + Vite |
| Routing | React Router v6 |
| Styling | Tailwind CSS |
| HTTP | Axios (`hrApiClient` / `apiClient`) |
| Real-time | WebSocket (native) |
| Notifications | Web Push API + Service Worker |
| State | React Context + local `useState` |
| Toasts | React Toastify |

---

## Project Structure

```
hr-frontend/
├── public/
│   └── sw.js                    # Service Worker — handles Web Push events
├── src/
│   ├── components/
│   │   ├── layout/              # Header, Sidebar, navigation
│   │   ├── modals/
│   │   │   ├── AddUserModal.jsx           # Create employee (seat-aware)
│   │   │   ├── SeatRequestModal.jsx       # Submit a seat request
│   │   │   ├── SeatRequestDetailsModal.jsx
│   │   │   └── SeatPaymentConfirmationModal.jsx
│   │   ├── seatRequests/
│   │   │   └── SeatRequestsPanel.jsx      # Seat request list for managers
│   │   ├── settings/
│   │   │   └── SeatSettingsTab.jsx        # Settings page seat management
│   │   └── ui/                  # Shared UI components (Button, Badge, Table…)
│   ├── contexts/
│   │   ├── AuthContext.jsx       # JWT auth state
│   │   └── CacheContext.jsx      # In-memory API response cache
│   ├── hooks/
│   │   └── useAuth.js
│   ├── pages/
│   │   ├── users/
│   │   │   ├── UserListPage.jsx           # Main employee list + add user flow
│   │   │   └── SeatManagementPage.jsx     # Self-service seat request page
│   │   └── settings/
│   │       └── SettingsPage.jsx           # Includes SeatSettingsTab for managers
│   └── services/
│       ├── hrApiClient.js               # Axios instance → HR Backend (:5001)
│       ├── apiClient.js                 # Axios instance → Central Platform (:5000)
│       ├── seatRequestService.js        # Seat request CRUD + event helpers
│       ├── pushNotificationService.js   # Web Push subscription management
│       └── billing.js                   # Billing summary + seat top-up
```

---

## Add-User Flow & Seat Management

### Role Groups

| Group | Roles | Can Do |
|-------|-------|--------|
| Seat Purchasers | `superUser`, `siteManager`, `seniorManager` | Buy seats directly via Stripe Checkout |
| Seat Requesters | `adminManager`, `adminAdvisor`, `hrManager`, `hrAdvisor`, `teamManager` | Submit a seat request |

### Flow Diagram

```
User clicks "Add Employee"
        │
        ▼
AddUserModal submits → POST /hr/employees
        │
   ┌────┴────────────────────────────────────┐
   │ 200 OK                                  │ 402 SEAT_LIMIT_EXCEEDED
   ▼                                         ▼
Employee created              Is caller a Seat Purchaser?
                              │
                    YES ──────┴────── NO
                    │                 │
                    ▼                 ▼
          Open payment modal   Open SeatRequestModal
          → Stripe Checkout    → POST /hr/billing/seat-requests
          (Central Platform)           │
                    │                  ▼
                    │         Purchasers notified
                    │         (in-app + WebSocket)
                    │                  │
                    ▼                  ▼
          seatQuota incremented  Purchaser approves
          Retry add employee     │
                                 ▼
                         Requester notified
                         (in-app + Web Push)
```

### Seat Request States

`pending` → `approved` | `rejected` | `cancelled`

---

## Push Notifications Setup

The service worker at `public/sw.js` handles incoming Web Push events and notification clicks.

### Enabling Push Notifications

Push subscriptions are initialised automatically when a user logs in:

```js
import { initPushNotifications } from './services/pushNotificationService';

// In auth context or app initialisation:
await initPushNotifications();
```

This registers the service worker, fetches the VAPID public key from the HR backend, requests browser permission, and POSTs the subscription to `POST /hr/billing/push/subscribe`.

### How Notifications Are Triggered

1. A seat request is approved or rejected by a purchaser.
2. `hr-backend/src/services/push.service.js` calls `webpush.sendNotification()` to the requester's stored subscription.
3. The service worker receives the `push` event and shows a system notification.
4. Clicking the notification navigates to `/seat-management`.

### Service Worker Events

```js
// public/sw.js
self.addEventListener('push', (event) => { /* shows notification */ });
self.addEventListener('notificationclick', (event) => { /* focuses or opens tab */ });
```

---

## Environment Variables

```env
VITE_HR_API_URL=http://localhost:5001
VITE_CENTRAL_API_URL=http://localhost:5000
```

---

## Available Scripts

```bash
npm run dev      # Start development server (port 4028)
npm run build    # Production build
npm run preview  # Preview production build
npm run lint     # ESLint check
```

---

## Key Services

### `seatRequestService.js`
```js
createSeatRequest({ seatCount, reason })           // POST /hr/billing/seat-requests
fetchSeatRequests({ status } = {})                 // GET  /hr/billing/seat-requests
approveSeatRequest(requestId, { notes, skipSeatIncrement })
rejectSeatRequest(requestId, { notes })
cancelSeatRequest(requestId)
calculateSeatRequestPayment(requestId)             // GET  .../payment-calc
updateSeatRequestStatus(requestId, status, meta)   // Compatibility shim
emitSeatRequestEvent()                             // Fires 'seatRequests:updated' DOM event
```

### `pushNotificationService.js`
```js
initPushNotifications()        // Register SW + subscribe + POST to backend
disablePushNotifications()     // Unsubscribe + DELETE from backend
```

### `billing.js`
```js
getBillingSummary()                         // GET /hr/billing/summary
recordSeatTopUp(companyId, seats, reqId)    // POST /hr/billing/seat-topup
```

---

## Related Services

| Service | URL | Description |
|---------|-----|-------------|
| HR Backend | `http://localhost:5001` | All HR data and seat management |
| Central Platform Backend | `http://localhost:5000` | Auth, billing checkout, company info |
| Central Platform Frontend | `http://localhost:5173` | Main MPRAR dashboard |

---

## License

Private — MPRAR Project. All rights reserved.
