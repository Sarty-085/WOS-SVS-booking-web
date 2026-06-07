# 🤖 Standalone Discord Reminder Bot (Prep Booking Automation Node)

This is a standalone, robust Discord Bot service designed to synchronize with the **Prep Booking** Postgres database. It polls active event slots, resolves players' Discord handles, and dispenses beautiful reminder notices directly to their Direct Messages (DMs) **30 minutes prior** to event commencement!

---

## 🚀 Key Capabilities
* **Real-time DB Connection**: Fetches registered operators dynamically, matching target battle phase slots.
* **Automatic anti-spam cache**: Maintains a synchronized history record of dispatched notifications in `sent_reminders` to avoid redundancy.
* **Beautiful Rich Embeds**: Generates cyber-aesthetic themed widgets with metadata cards, operator highlights, timing alignments, and status counters.
* **Dynamic Bot Token loading**: Reads credentials dynamically from the Web Dashboard's Admin panel or your hosting space `.env` file automatically!

---

## 🛠️ Standalone Hosting Guide

### 1. Prerequisites
Ensure you have **Node.js v18+** installed.

### 2. Discord Developer Portal Configuration
1. Navigate to the **[Discord Developer Portal](https://discord.com/developers/applications)**.
2. Click **New Application** and enter name e.g., `Prep Booking Bot`.
3. Under the **Bot** tab:
   * Generate/Reset the **Token** (copy this token; you will paste it into the Web Dashboard or `.env`).
   * Enable the following **Privileged Gateway Intents**:
     * **Presence Intent**
     * **Server Members Intent** (Crucial! Required to look up usernames)
     * **Message Content Intent**
4. Under **OAuth2` -> `URL Generator**:
   * Scopes: Select `bot`.
   * Bot Permissions: Select `Send Messages`, `Embed Links`, and `Read Message History`.
   * Open the generated link to invite the bot to your core SVS Discord server.

### 3. Quick Local / VPS Deployment
1. Navigate into the folder:
   ```bash
   cd discord-bot
   ```
2. Create a `.env` configuration file:
   ```env
   DISCORD_BOT_TOKEN=your_discord_bot_token_here
   DATABASE_URL=postgresql://your_db_username:your_password@host/db_name?sslmode=require
   ```
3. Install standard production package dependencies:
   ```bash
   npm install
   ```
4. Start the notification service:
   ```bash
   npm start
   ```

---

## 🔒 Player DM Configurations Reminder
For players to receive DM alerts without issues:
1. They must share at least one Discord server with the bot.
2. They **MUST** enable **"Allow direct messages from server members"** in their **Privacy & Safety** preferences panel. If DMs are closed, the bot will gracefully log a message in terminal logs and preserve high availability.
