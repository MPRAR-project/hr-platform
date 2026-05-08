# MPRaR — HR Platform (Legacy Module)

The **MPRaR Workforce Management System**. This module handles employee leave, absence management, and workforce monitoring. It is a legacy system that uses Firebase for real-time data and is integrated into the Central Platform via the SSO Bridge.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Fill in your Firebase Web Config and Central Platform URLs.
```

### 3. Start Development Server
```bash
npm run dev
```
The HR portal will be available at `http://localhost:4028`.

---

## 🏗 Key Features

- **Absence Management**: Real-time tracking of employee leave and sickness.
- **SSO Bridge Integration**: Automatically signs in users coming from the Central Dashboard.
- **Firebase Real-time Sync**: Instant updates across the portal using Firestore listeners.
- **Legacy Compatibility**: Maintains the original data structure while trusting Central Platform for identity.

---

## 🛠 Technology Stack

- **Framework**: React + Vite
- **Database**: Firebase Firestore
- **Authentication**: Firebase Auth (Slave) + MPRaR Central (Master)
- **Styling**: Tailwind CSS
