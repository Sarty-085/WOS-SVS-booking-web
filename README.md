# Royal Slots — SVS Booking System

A state event slot booking and scheduling system for alliance gameplay. Built with React, Express, Vite, and Neon PostgreSQL.

## Features

- Priority-based timeslot allocation across Construction, Research & Training Days
- Auto-displacement system with email notifications (SMTP)
- Google Sheets sync via Service Account
- Admin audit logs & alliance management
- Google OAuth integration

---

## 🚀 Deploy to Render

### 1. Push to GitHub
Commit this project to a GitHub repository.

### 2. Create a Render Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**
2. Connect your GitHub repository
3. Render will auto-detect the `render.yaml` blueprint

Or configure manually:
| Setting | Value |
|---|---|
| **Runtime** | Node |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start` |
| **Node Version** | 20+ |

### 3. Set Environment Variables

In the Render dashboard → **Environment**, add these:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | Neon PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | Optional | For Google OAuth / Sheets |
| `SMTP_HOST` | Optional | SMTP server (e.g. `smtp.gmail.com`) |
| `SMTP_PORT` | Optional | `465` (SSL) or `587` (TLS) |
| `SMTP_USER` | Optional | SMTP login email |
| `SMTP_PASS` | Optional | SMTP password / app password |
| `SMTP_FROM` | Optional | From address for emails |
| `GEMINI_API_KEY` | Optional | For AI features |

> **Note:** `PORT` is automatically injected by Render. Do **not** set it manually.

### 4. Deploy

Click **Deploy** — Render will build and launch the app. Your URL will be `https://<service-name>.onrender.com`.

---

## Local Development

```bash
# Install dependencies
npm install

# Copy env file and fill in values
cp .env.example .env

# Run dev server (Vite + Express with HMR)
npm run dev
```

## Production Build (local test)

```bash
npm run build
npm run start
```
