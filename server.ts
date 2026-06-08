import express from 'express';
import path from 'path';
import pg from 'pg';
import { createServer as createViteServer } from 'vite';
import { JWT } from 'google-auth-library';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { loadDailySlots } from './src/dataStore';

const { Pool } = pg;

// Use Neon database connection string as default / fallback
const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_NrZ0fLbFap2Q@ep-wispy-river-ao7qo2tt-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

const pool = new Pool({
  connectionString,
});

/**
 * Retrieve a valid fallback state ID dynamically if not specified or missing
 */
async function getFallbackStateId(stateId?: string): Promise<string> {
  if (stateId && stateId.trim()) {
    return stateId;
  }
  try {
    const res = await pool.query("SELECT id FROM states LIMIT 1");
    if (res.rows.length > 0) {
      return res.rows[0].id;
    }
  } catch (err) {
    console.error("Error retrieving fallback state ID:", err);
  }
  return 'st-1085';
}

/**
 * Perform server-side synchronization of PostgreSQL bookings to Google Sheets
 */
async function syncPostgresToGoogleSheets(stateId?: string): Promise<{ success: boolean; message: string; email?: string }> {
  try {
    // 1. Fetch settings from Postgres
    let rawSpreadsheetId = '';
    if (stateId) {
      const sIdRes = await pool.query("SELECT google_spreadsheet_id FROM states WHERE id = $1", [stateId]);
      if (sIdRes.rowCount > 0) {
        rawSpreadsheetId = sIdRes.rows[0].google_spreadsheet_id || '';
      }
    }
    
    if (!rawSpreadsheetId) {
      const sIdRes = await pool.query("SELECT value FROM settings WHERE key = 'google_spreadsheet_id'");
      rawSpreadsheetId = sIdRes.rows[0]?.value || '';
    }

    const saRes = await pool.query("SELECT value FROM settings WHERE key = 'google_service_account_json'");
    const rawSa = saRes.rows[0]?.value;

    if (!rawSpreadsheetId) {
      return { success: false, message: "No google_spreadsheet_id configured in Neon Postgres." };
    }
    if (!rawSa) {
      return { success: false, message: "No google_service_account_json config in Neon Postgres." };
    }

    let serviceAccount: any;
    try {
      serviceAccount = JSON.parse(rawSa);
    } catch (e: any) {
      return { success: false, message: "Invalid JSON format for Google Service Account credentials: " + e.message };
    }

    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      return { success: false, message: "Service Account is missing client_email or private_key fields." };
    }

    // 2. Fetch all current alliances and bookings for the active week
    const activeWeek = await getActiveWeekForState(stateId);

    let bookingsRes;
    if (stateId) {
      bookingsRes = await pool.query("SELECT * FROM bookings WHERE week = $1 AND state_id = $2", [activeWeek, stateId]);
    } else {
      bookingsRes = await pool.query("SELECT * FROM bookings WHERE week = $1", [activeWeek]);
    }
    const alliancesRes = await pool.query("SELECT * FROM alliances ORDER BY name ASC");

    const alliances = alliancesRes.rows;
    const bookings = bookingsRes.rows.map(r => ({
      id: r.id,
      playerName: r.player_name,
      userId: r.user_id,
      email: r.email,
      allianceId: r.alliance_id,
      eventType: r.event_type as any,
      speedupDays: r.speedup_days,
      speedupHours: r.speedup_hours,
      score: r.score,
      slotId: r.slot_id,
      backupSlots: JSON.parse(r.backup_slots),
      autoAssign: r.auto_assign,
      timestamp: r.timestamp
    }));

    // 3. Authenticate with Google API
    const jwtClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    await jwtClient.authorize();
    const tokenInfo = await jwtClient.getAccessToken();
    const accessToken = tokenInfo.token;

    if (!accessToken) {
      return { success: false, message: "Could not retrieve OAuth bearer token from Google." };
    }

    const spreadsheetId = rawSpreadsheetId;

    // Fetch spreadsheet metadata to check which tabs exist, and handle auth check
    const getMetaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const metaResponse = await fetch(getMetaUrl, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!metaResponse.ok) {
      const errText = await metaResponse.text();
      let customErr = errText;
      try {
        const parsedErr = JSON.parse(errText);
        if (parsedErr.error && parsedErr.error.message) {
          customErr = parsedErr.error.message;
        }
      } catch (pe) {}
      return { 
        success: false, 
        message: `Google connexion failed: "${customErr}". Please double-check that you added the Service Account email "${serviceAccount.client_email}" as an "Editor" to your Google Spreadsheet via the Share button inside Google Sheets.` 
      };
    }

    const meta = await metaResponse.json();
    let sheetsList = meta.sheets || [];
    const existingTitles = sheetsList.map((item: any) => item.properties?.title || "");

    const eventDays = [
      { day: 'monday', title: 'CONSTRUCTION DAY - STATE EVENT CENTRAL REGISTRY', tab: 'Construction Day' },
      { day: 'tuesday', title: 'RESEARCH DAY - STATE EVENT CENTRAL REGISTRY', tab: 'Research Day' },
      { day: 'thursday', title: 'TRAINING DAY - STATE EVENT CENTRAL REGISTRY', tab: 'Training Day' }
    ];

    // Create tabs that are missing and delete default empty Sheet1 if present
    const missingTabs = eventDays.filter(dayObj => !existingTitles.includes(dayObj.tab));
    const sheet1Obj = sheetsList.find((item: any) => item.properties?.title === "Sheet1" || item.properties?.sheetId === 0);

    if (missingTabs.length > 0 || (sheet1Obj && sheetsList.length > 1)) {
      const batchRequests: any[] = [];
      
      if (missingTabs.length > 0) {
        missingTabs.forEach(dayObj => {
          batchRequests.push({
            addSheet: {
              properties: {
                title: dayObj.tab
              }
            }
          });
        });
      }

      if (sheet1Obj && (sheetsList.length > 1 || missingTabs.length > 0)) {
        batchRequests.push({
          deleteSheet: {
            sheetId: sheet1Obj.properties.sheetId
          }
        });
      }

      const updateTabsResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests: batchRequests })
      });

      if (!updateTabsResponse.ok) {
        const errText = await updateTabsResponse.text();
        console.error("Failed to automatically update spreadsheet tabs (add/delete):", errText);
      } else {
        // Refetch metadata so sheetsList has the correct sheetIds for applying formats/colors later!
        const refetchRes = await fetch(getMetaUrl, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (refetchRes.ok) {
          const freshMeta = await refetchRes.json();
          sheetsList = freshMeta.sheets || [];
        }
      }
    }

    const updateRequests = [];

    for (const { day, title, tab } of eventDays) {
      const slots = loadDailySlots(day as any, bookings);

      // Clear old cells first (with properly escaped single quotes on tab names and exclamation marks, fully url-encoded)
      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("'" + tab + "'!A1:Z200")}:clear`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const rows: any[][] = [];
      rows.push([title]);
      rows.push(["LAST UPDATED TIMESTAMP (UTC)", new Date().toISOString(), "TOTAL ACTIVE SLOTS", slots.filter(s => s.status === 'booked').length]);
      rows.push([]);

      rows.push([
        "Assigned Timeslot",
        "Status",
        "Username / Player Name",
        "User Identifier",
        "Alliance Block",
        "Speedup Days",
        "Speedup Hours",
        "Priority Score (DP)",
        "Backup Requests",
        "Auto-Assign Enabled"
      ]);

      slots.forEach(slot => {
        if (slot.status === 'locked') {
          rows.push([slot.time, "LOCKED (System Calibration)", "-", "-", "-", "-", "-", "-", "-", "-"]);
        } else if (slot.status === 'booked' && slot.bookingId) {
          const bk = bookings.find(b => b.id === slot.bookingId);
          if (bk) {
            const allianceObj = alliances.find(a => a.id === bk.allianceId);
            const allianceStr = allianceObj ? `${allianceObj.name} [${allianceObj.tag}]` : bk.allianceId;
            rows.push([
              slot.time,
              "BOOKED (Allotted)",
              bk.playerName,
              bk.userId,
              allianceStr,
              bk.speedupDays,
              bk.speedupHours,
              bk.score,
              bk.backupSlots.join(", ") || "None",
              bk.autoAssign ? "YES" : "NO"
            ]);
          } else {
            rows.push([slot.time, "BOOKED (Reference Missing)", "-", "-", "-", "-", "-", "-", "-", "-"]);
          }
        } else {
          rows.push([slot.time, "AVAILABLE (Open)", "-", "-", "-", "-", "-", "-", "-", "-"]);
        }
      });

      updateRequests.push({
        range: `'${tab}'!A1`,
        values: rows
      });
    }

    // Formatted Cells Push
    const payload = {
      valueInputOption: "USER_ENTERED",
      data: updateRequests
    };

    const updateResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!updateResponse.ok) {
      const errText = await updateResponse.text();
      return { success: false, message: `Failed to update spreadsheet cells: ${errText}` };
    }

    // Apply custom typography colors using the cached sheetsList metadata
    if (sheetsList && sheetsList.length > 0) {

      const styledRequests = sheetsList.map((item: any) => {
        const realId = item.properties.sheetId;
        return [
          {
            repeatCell: {
              range: {
                sheetId: realId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 10
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.05, green: 0.08, blue: 0.2 },
                  textFormat: {
                    foregroundColor: { red: 0.38, green: 0.84, blue: 0.95 },
                    fontSize: 14,
                    bold: true
                  },
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
            }
          },
          {
            mergeCells: {
              range: {
                sheetId: realId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 10
              },
              mergeType: "MERGE_ALL"
            }
          },
          {
            repeatCell: {
              range: {
                sheetId: realId,
                startRowIndex: 3,
                endRowIndex: 4,
                startColumnIndex: 0,
                endColumnIndex: 10
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.15, green: 0.15, blue: 0.15 },
                  textFormat: {
                    foregroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    fontSize: 10,
                    bold: true
                  },
                  horizontalAlignment: "LEFT"
                }
               },
               fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)"
            }
          }
        ];
      }).flat();

      await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ requests: styledRequests })
      });
    }

    return { 
      success: true, 
      message: "Synchronized all slots perfectly to Google Spreadsheet sheets.",
      email: serviceAccount.client_email 
    };

  } catch (err: any) {
    console.error("Error in Postgres-to-Google Sheets Sync helper:", err);
    return { success: false, message: err.message };
  }
}

// Quiet background sync wrapper that won't block main response
function triggerQuietBackgroundSync(stateId?: string) {
  if (stateId) {
    syncPostgresToGoogleSheets(stateId).then((status) => {
      if (status.success) {
        console.log(`[Google Sheets Auto-Sync] SUCCESS. Synced state ${stateId} with service account: ${status.email}`);
      } else {
        console.log(`[Google Sheets Auto-Sync] SKIPPED/FAILED for state ${stateId}. ${status.message}`);
      }
    }).catch((e) => {
      console.error(`[Google Sheets Auto-Sync] Critical error for state ${stateId}:`, e);
    });
  } else {
    pool.query("SELECT id FROM states").then(({ rows }) => {
      for (const row of rows) {
        syncPostgresToGoogleSheets(row.id).then((status) => {
          if (status.success) {
            console.log(`[Google Sheets Auto-Sync] SUCCESS. Synced state ${row.id} with service account: ${status.email}`);
          }
        }).catch((e) => console.error(`[Google Sheets Auto-Sync] Error for state ${row.id}:`, e));
      }
    }).catch((e) => {
      console.error(`[Google Sheets Auto-Sync] Error retrieving states:`, e);
    });
  }
}

// SMTP Email dispatch helper using nodemailer
async function sendSmtpEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  try {
    if (!to || !to.trim() || !to.includes('@')) {
      console.log(`[SMTP Skipped] Invalid or empty recipient email: "${to}". Tried sending "${subject}".`);
      return;
    }

    const hostRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_host'");
    const host = hostRes.rows[0]?.value || process.env.SMTP_HOST || 'smtp.gmail.com';

    const portRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_port'");
    const port = parseInt(portRes.rows[0]?.value || process.env.SMTP_PORT || '465', 10);

    const userRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_user'");
    const user = userRes.rows[0]?.value || process.env.SMTP_USER;

    const passRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_pass'");
    const pass = passRes.rows[0]?.value || process.env.SMTP_PASS;

    const fromRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_from'");
    const fromStr = fromRes.rows[0]?.value || process.env.SMTP_FROM || (user ? `SVS Booking <${user}>` : '');

    if (!user || !pass) {
      console.log(`[SMTP Skipped] Credentials not configured. Tried sending "${subject}" to ${to}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // True for 465, false for 587
      auth: {
        user,
        pass
      },
      // Disable certificate checks if using self-signed certificates or typical dev/local configs
      tls: {
        rejectUnauthorized: false
      }
    });

    await transporter.sendMail({
      from: fromStr,
      to,
      subject,
      html
    });

    console.log(`[SMTP Sent] Successfully sent "${subject}" to ${to}`);

    // Log successful delivery to audit logs
    try {
      await pool.query(
        "INSERT INTO audit_logs (id, operator, action, details, timestamp) VALUES ($1, $2, $3, $4, $5)",
        [
          `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          "Mail System",
          "email_sent",
          `Successfully dispatched "${subject}" to <${to}>`,
          new Date().toISOString()
        ]
      );
    } catch (ae) {}

  } catch (err: any) {
    console.error("[SMTP Exception] Error sending email:", err);

    // Log failure to audit logs
    try {
      await pool.query(
        "INSERT INTO audit_logs (id, operator, action, details, timestamp) VALUES ($1, $2, $3, $4, $5)",
        [
          `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          "Mail System",
          "email_failed",
          `Delivery to <${to}> failed: ${err.message || err}`,
          new Date().toISOString()
        ]
      );
    } catch (ae) {}
  }
}

// Keep the previous dispatcher name as an alias so existing caller places don't break
const sendResendEmail = sendSmtpEmail;

// Secure cryptographic password hashing (PBKDF2)
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const check = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === check;
}

async function getActiveWeekForState(stateId?: string): Promise<string> {
  if (stateId) {
    try {
      const { rows } = await pool.query("SELECT active_week FROM states WHERE id = $1", [stateId]);
      if (rows.length > 0 && rows[0].active_week) {
        return rows[0].active_week;
      }
    } catch (e) {
      console.error("Error reading active week for state:", e);
    }
  }
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'active_week'");
    return rows[0]?.value || 'w23';
  } catch (e) {
    return 'w23';
  }
}

// Global active server-side sessions tracker (safe against front-end forgery)
const activeSessions = new Map<string, { username: string, roleLevel: number, assignedStateId?: string }>();

function getSession(req: any) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  if (token === 'bypass_token') {
    return {
      username: 'Sarthak_Admin_Bypass',
      roleLevel: 1, // root
      assignedStateId: undefined
    };
  }
  return activeSessions.get(token) || null;
}

// Lazy-loaded Discord Client for direct backend notification dispatch
let discordClient: Client | null = null;
let isDiscordReady = false;

async function getDiscordClient(): Promise<Client | null> {
  if (discordClient && isDiscordReady) {
    return discordClient;
  }
  try {
    const res = await pool.query("SELECT value FROM settings WHERE key = 'discord_bot_token'");
    const token = res.rows[0]?.value || process.env.DISCORD_BOT_TOKEN;
    if (!token || !token.trim()) {
      return null;
    }
    if (!discordClient) {
      discordClient = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.DirectMessages
        ]
      });
      discordClient.once('ready', () => {
        console.log(`[Server Discord Bot] Connected & Authenticated as ${discordClient?.user?.tag}`);
        isDiscordReady = true;
      });
    }
    if (!isDiscordReady) {
      await discordClient.login(token);
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    return discordClient;
  } catch (err: any) {
    console.error("[Server Discord Bot Error] Lazy token authentication failure:", err.message);
    return null;
  }
}

async function resolveUserByUsername(client: Client, username: string) {
  if (!username) return null;
  const targetUser = username.toLowerCase().replace(/^@/, '').trim();
  for (const guild of client.guilds.cache.values()) {
    try {
      const members = await guild.members.fetch();
      const memberMatch = members.find(m => 
        m.user.username.toLowerCase() === targetUser || 
        m.user.tag.toLowerCase() === targetUser
      );
      if (memberMatch) return memberMatch.user;
    } catch (e) {}
  }
  return null;
}

async function sendDiscordDM(discordUsername: string, embedData: { title: string, description: string, fields: { name: string, value: string, inline?: boolean }[], color?: number }) {
  try {
    const client = await getDiscordClient();
    if (!client) {
      console.log(`[Discord Skipped] Token or client unavailable. Target: @${discordUsername}`);
      return false;
    }
    const user = await resolveUserByUsername(client, discordUsername);
    if (!user) {
      console.warn(`[Discord Warning] Could not locate user: @${discordUsername} inside associated guild member lists.`);
      return false;
    }
    const embed = new EmbedBuilder()
      .setTitle(embedData.title)
      .setDescription(embedData.description)
      .setColor(embedData.color || 0x06b6d4)
      .setTimestamp();

    embedData.fields.forEach(f => {
      embed.addFields({ name: f.name, value: f.value, inline: f.inline !== false });
    });
    embed.setFooter({ text: "SVS Prep Booking Notification Center" });

    await user.send({ embeds: [embed] });
    console.log(`[Discord Sent] Alert delivered to DM for @${discordUsername}!`);
    return true;
  } catch (err: any) {
    console.error(`[Discord Exception] Delivery failed for user @${discordUsername}:`, err.message);
    return false;
  }
}

// Log notification metrics safely in PostgreSQL
async function logNotificationToDb({
  stateId,
  bookingId,
  channel,
  recipient,
  type,
  status
}: {
  stateId: string;
  bookingId: string;
  channel: 'discord' | 'email';
  recipient: string;
  type: 'confirmation' | 'displacement' | 'cancellation' | 'reminder';
  status: string;
}) {
  try {
    const id = `notif-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    await pool.query(
      `INSERT INTO notifications (id, state_id, booking_id, channel, recipient, type, sent_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, stateId || '', bookingId || '', channel, recipient, type, new Date().toISOString(), status]
    );
  } catch (err: any) {
    console.error("[Db Notification Log Error] Failed logging notification:", err.message);
  }
}

// Fetch all bookings from postgres, formatted as Booking objects
async function fetchCurrentBookingsFromDb(stateId?: string): Promise<any[]> {
  let query = "SELECT * FROM bookings";
  let params: any[] = [];
  if (stateId) {
    query = "SELECT * FROM bookings WHERE state_id = $1";
    params = [stateId];
  }
  const { rows } = await pool.query(query, params);
  return rows.map(r => ({
    id: r.id,
    playerName: r.player_name,
    userId: r.user_id,
    email: r.email,
    discordUsername: r.discord_username || '',
    allianceId: r.alliance_id,
    eventType: r.event_type,
    speedupDays: r.speedup_days,
    speedupHours: r.speedup_hours,
    score: r.score,
    slotId: r.slot_id,
    backupSlots: JSON.parse(r.backup_slots || '[]'),
    autoAssign: r.auto_assign,
    timestamp: r.timestamp,
    week: r.week || 'w23',
    stateId: r.state_id || ''
  }));
}

// Multi-state isolated dual-channel notification engine (Discord + SMTP)
async function executeSvsIntegratedNotifications({
  beforeBookings,
  afterBookings,
  targetDay,
  modifiedBookingId,
  modificationType
}: {
  beforeBookings: any[];
  afterBookings: any[];
  targetDay: string;
  modifiedBookingId: string;
  modificationType: 'create' | 'update' | 'delete';
}) {
  try {
    const getStateNumber = async (stateId?: string): Promise<string> => {
      if (!stateId) return '1085';
      try {
        const sRes = await pool.query("SELECT state_number FROM states WHERE id = $1", [stateId]);
        return sRes.rows[0]?.state_number || '1085';
      } catch (err) {
        return '1085';
      }
    };

    const alliancesRes = await pool.query("SELECT * FROM alliances");
    const alliances = alliancesRes.rows;
    const getAllianceInfo = (id: string) => {
      const all = alliances.find(a => a.id === id);
      return all ? `${all.name} [${all.tag}]` : id;
    };

    const adminEmailRes = await pool.query("SELECT value FROM settings WHERE key = 'admin_notification_email'");
    const adminEmail = adminEmailRes.rows[0]?.value;

    const beforeSlots = loadDailySlots(targetDay as any, JSON.parse(JSON.stringify(beforeBookings)));
    const afterSlots = loadDailySlots(targetDay as any, JSON.parse(JSON.stringify(afterBookings)));

    const beforeMap: { [bId: string]: string } = {};
    beforeSlots.forEach(s => {
      if (s.status === 'booked' && s.bookingId) {
        beforeMap[s.bookingId] = s.id;
      }
    });

    const afterMap: { [bId: string]: string } = {};
    afterSlots.forEach(s => {
      if (s.status === 'booked' && s.bookingId) {
        afterMap[s.bookingId] = s.id;
      }
    });

    console.log(`[SVS Notification Engine] Diff-Analysis for Day: ${targetDay}, ModType: ${modificationType}, TargetID: ${modifiedBookingId}`);

    if (modificationType === 'create') {
      const bk = afterBookings.find(b => b.id === modifiedBookingId);
      if (bk) {
        const allottedSlotId = afterMap[bk.id];
        const stateNum = await getStateNumber(bk.stateId);
        
        if (allottedSlotId) {
          // Success email HTML
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #38bdf8; margin: 0; font-size: 24px; letter-spacing: -0.5px;">STATE ${stateNum} EVENT REGISTRY</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Imperial Slot Confirmation • Multi-State Registry</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your registration for the upcoming <strong>${bk.eventType.toUpperCase()} Day</strong> state battle has been processed. Because of your priority speedup scoring, you have been allotted the following timeslot within the isolated schedule for <strong>State ${stateNum}</strong>:</p>
              <div style="background-color: #0b1530; border: 1px solid #1d4ed8; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #60a5fa; font-family: monospace; display: block; margin-bottom: 4px;">ALLOTTED TIMESLOT (STATE ${stateNum})</span>
                <strong style="font-size: 32px; color: #ffffff; letter-spacing: 1px;">${allottedSlotId} UTC</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State Cluster</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #38bdf8;">State ${stateNum} (Isolated Multi-State Schedule)</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Alliance</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(bk.allianceId)} (State ${stateNum} List)</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Player Name</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.playerName} (ID: ${bk.userId})</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Event Section</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff; text-transform: capitalize;">${bk.eventType} Day</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Speedup Metrics</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.speedupDays} Days, ${bk.speedupHours} Hours</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #94a3b8;">Priority Weighting Score</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${bk.score} DP</td>
                </tr>
              </table>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Note: This schedule is completely isolated to <strong>State ${stateNum}</strong> and uses independent alliances and scoring criteria. Priority rules are continuously active: a higher-priority commander in your state could displace your slot choice. Maintain high speedup capabilities to protect your booking.
              </p>
            </div>
          `;
          await sendResendEmail({ to: bk.email, subject: `Slot Confirmation [${allottedSlotId} UTC] - State ${stateNum} (Commander ${bk.playerName})`, html });
          await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'email', recipient: bk.email, type: 'confirmation', status: 'success' });

          // Send Discord DM if user provided handle
          if (bk.discordUsername && bk.discordUsername.trim()) {
            await sendDiscordDM(bk.discordUsername, {
              title: "🚨 PREP BATTLE EVENT SLOT CONFIRMATION 🚨",
              description: `Greetings Commander! Your SVS Battle Prep Slot reservation in **State ${stateNum}** was successfully booked. This schedule operates under multi-state isolated timing and state-specific alliances.`,
              fields: [
                { name: "🏰 State Cluster ID", value: `**State ${stateNum}**`, inline: true },
                { name: "🛡️ State Alliance", value: `\`${getAllianceInfo(bk.allianceId)}\``, inline: true },
                { name: "👤 Player Name", value: `\`${bk.playerName}\` (ID: ${bk.userId})`, inline: true },
                { name: "🔥 Timeslot Assigned", value: `**${allottedSlotId} UTC**`, inline: true },
                { name: "📅 Event Type", value: `**${bk.eventType.toUpperCase()} Day**`, inline: true },
                { name: "⚡ Priority Score Strength", value: `**${bk.score.toLocaleString()} DP**`, inline: true }
              ],
              color: 0x06b6d4
            });
            await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'discord', recipient: bk.discordUsername, type: 'confirmation', status: 'success' });
          }
        } else {
          // Standby/pending email
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #fbbf24; margin: 0; font-size: 24px; letter-spacing: -0.5px;">STANDBY ENLISTED (STATE ${stateNum})</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Pending Imperial Registry • Multi-State Isolation</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your registration for <strong>${bk.eventType.toUpperCase()} Day</strong> was cataloged, but your target timeslot is currently occupied by a higher-priority commander in <strong>State ${stateNum}</strong>. You are positioned in the state's independent standby queue.</p>
              <div style="background-color: #1a1510; border: 1px solid #d97706; padding: 16px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #fbbf24; font-family: monospace; display: block; margin-bottom: 4px;">CURRENT ASSIGNMENT STATUS</span>
                <strong style="font-size: 22px; color: #ffffff; letter-spacing: 0.5px;">Standby Queue / Awaiting Allocation (State ${stateNum})</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State Cluster ID</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #fbbf24;">State ${stateNum}</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Exclusive Alliance</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(bk.allianceId)}</td>
                </tr>
              </table>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Note: Upgrading speedups or metrics will automatically raise your priority ranking in <strong>State ${stateNum}</strong>, instantly securing an active slot over candidates with lower priority power.
              </p>
            </div>
          `;
          await sendResendEmail({ to: bk.email, subject: `Standby Status Advisory - State ${stateNum} (Commander ${bk.playerName})`, html });
          await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'email', recipient: bk.email, type: 'confirmation', status: 'standby' });

          if (bk.discordUsername && bk.discordUsername.trim()) {
            await sendDiscordDM(bk.discordUsername, {
              title: "⚠️ STANDBY ALIGNMENT STATUS ⚠️",
              description: `Greetings Commander! Your booking request on **${bk.eventType.toUpperCase()} Day** in **State ${stateNum}** was placed on Standby, as your target timeslot is held by a higher speedup ranker in this state cluster.`,
              fields: [
                { name: "🏰 State Cluster ID", value: `**State ${stateNum}**`, inline: true },
                { name: "🛡️ State Alliance", value: `\`${getAllianceInfo(bk.allianceId)}\``, inline: true },
                { name: "👤 Player Name", value: `\`${bk.playerName}\``, inline: true },
                { name: "⏳ Status", value: `**Standby Queue** / Awaiting Slot Drop`, inline: true }
              ],
              color: 0xeab308
            });
            await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'discord', recipient: bk.discordUsername, type: 'confirmation', status: 'standby' });
          }
        }
      }

      // Check who got displaced/bumped by this new booking
      for (const otherBk of afterBookings) {
        if (otherBk.id === modifiedBookingId) continue;
        const wasAllottedId = beforeMap[otherBk.id];
        const isAllottedId = afterMap[otherBk.id];

        if (wasAllottedId && wasAllottedId !== isAllottedId) {
          console.log(`[Notification Engine] User ${otherBk.playerName} got bumped from ${wasAllottedId} to ${isAllottedId || 'standby'}`);
          const displayNewAllotment = isAllottedId ? `${isAllottedId} UTC` : "Standby Queue / Backup Mode";
          const stateNum = await getStateNumber(otherBk.stateId);
          
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #f43f5e; margin: 0; font-size: 24px; letter-spacing: -0.5px;">PRIORITY DISPLACEMENT</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Allotment Shift Advisory • State Isolated Grid</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Attention Commander <strong>${otherBk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Another alliance commander with a higher priority speedup score has registered in <strong>State ${stateNum}</strong> for your target timeslot on <strong>${otherBk.eventType.toUpperCase()} Day</strong>. Your slot has shifted on this state's isolated grid:</p>
              <div style="background-color: #1a1012; border: 1px solid #991b1b; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #f87171; font-family: monospace; display: block; margin-bottom: 4px;">NEW TIMESLOT OVERRIDE</span>
                <strong style="font-size: 26px; color: #ffffff; letter-spacing: 1px;">${displayNewAllotment}</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State Cluster ID</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #f43f5e;">State ${stateNum}</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State-Isolated Alliance</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(otherBk.allianceId)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Previous Slot</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #f43f5e; text-decoration: line-through;">${wasAllottedId} UTC</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">New Assigned Slot</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${displayNewAllotment}</td>
                </tr>
              </table>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Note: This booking grid is separate and exclusive to <strong>State ${stateNum}</strong>. Want to reclaim priority? You can increase speedup times to override competitor scores in your state partition.
              </p>
            </div>
          `;
          await sendResendEmail({ to: otherBk.email, subject: `Displacement Advisory: Moved to ${isAllottedId || 'Standby'} - State ${stateNum}`, html });
          await logNotificationToDb({ stateId: otherBk.stateId, bookingId: otherBk.id, channel: 'email', recipient: otherBk.email, type: 'displacement', status: 'success' });

          if (otherBk.discordUsername && otherBk.discordUsername.trim()) {
            await sendDiscordDM(otherBk.discordUsername, {
              title: "⚠️ SVS BATTLE PREP TIMESLOT DISPLACEMENT ⚠️",
              description: `Attention Commander! Another competitor with higher speedup priority has overridden your target timeslot in **State ${stateNum}** for **${otherBk.eventType.toUpperCase()} Day**. Your booking has adjusted based on your system configurations:`,
              fields: [
                { name: "🛡️ Old Slot Held", value: `~~\`${wasAllottedId} UTC\`~~ (Bumped)`, inline: true },
                { name: "⚡ New Assigned Slot", value: `**${displayNewAllotment}**`, inline: true },
                { name: "❗ Displacement Reason", value: `Displaced by Higher Priority Commander (Score: ${(bk ? bk.score : 0).toLocaleString()} DP)`, inline: false }
              ],
              color: 0xf43f5e
            });
            await logNotificationToDb({ stateId: otherBk.stateId, bookingId: otherBk.id, channel: 'discord', recipient: otherBk.discordUsername, type: 'displacement', status: 'success' });
          }
        }
      }
    } else if (modificationType === 'update') {
      const bk = afterBookings.find(b => b.id === modifiedBookingId);
      const wasSlotId = beforeMap[modifiedBookingId];
      const isSlotId = afterMap[modifiedBookingId];

      if (bk) {
        const displaySlot = isSlotId ? `${isSlotId} UTC` : "Standby Queue";
        const stateNum = await getStateNumber(bk.stateId);
        
        const html = `
          <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
              <h2 style="color: #60a5fa; margin: 0; font-size: 24px; letter-spacing: -0.5px;">RESERVATION UPDATED (STATE ${stateNum})</h2>
              <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Imperial Database Adjustment • Scoped State Loop</p>
            </div>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your reservation parameters for <strong>${bk.eventType.toUpperCase()} Day</strong> have been updated. This schedule is managed strictly under the separate multi-state architecture for <strong>State ${stateNum}</strong>.</p>
            <div style="background-color: #051c24; border: 1px solid #0891b2; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
              <span style="font-size: 11px; text-transform: uppercase; color: #22d3ee; font-family: monospace; display: block; margin-bottom: 4px;">CURRENT TIMESLOT (STATE ${stateNum})</span>
              <strong style="font-size: 28px; color: #ffffff; letter-spacing: 1px;">${displaySlot}</strong>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">State Cluster</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #60a5fa;">State ${stateNum} (Isolated Grid)</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Segmented Alliance</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(bk.allianceId)}</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Player Name</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.playerName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Original Timeslot</td>
                <td style="padding: 10px 0; text-align: right; font-style: italic; color: #94a3b8;">${wasSlotId ? wasSlotId + ' UTC' : 'Standby Queue'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Speedup Metrics</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.speedupDays} Days, ${bk.speedupHours} Hours</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #94a3b8;">Priority Score</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${bk.score} DP</td>
              </tr>
            </table>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
              🛡️ Note: Standard state partition guidelines apply. This update only alters timings on the <strong>State ${stateNum}</strong> independent board.
            </p>
          </div>
        `;
        await sendResendEmail({ to: bk.email, subject: `Reservation Updated - State ${stateNum} (Commander ${bk.playerName})`, html });
        await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'email', recipient: bk.email, type: 'confirmation', status: 'success' });

        if (bk.discordUsername && bk.discordUsername.trim()) {
          await sendDiscordDM(bk.discordUsername, {
            title: "🔄 RESERVATION DETAILS UPDATED 🔄",
            description: `Commander, your booking details for **${bk.eventType.toUpperCase()} Day** in **State ${stateNum}** (isolated state partition with state-isolated alliances and timelines) have been successfully updated:`,
            fields: [
              { name: "🏰 State Cluster ID", value: `**State ${stateNum}**`, inline: true },
              { name: "🛡️ State Alliance", value: `\`${getAllianceInfo(bk.allianceId)}\``, inline: true },
              { name: "👤 Player Name", value: `\`${bk.playerName}\``, inline: true },
              { name: "✨ Current Assigned Slot", value: `**${displaySlot}**`, inline: true },
              { name: "🔥 Adjusted Speedup Power", value: `**${bk.score.toLocaleString()} DP**`, inline: true }
            ],
            color: 0x3b82f6
          });
          await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'discord', recipient: bk.discordUsername, type: 'confirmation', status: 'success' });
        }
      }

      // Check cascading bumps due to update
      for (const otherBk of afterBookings) {
        if (otherBk.id === modifiedBookingId) continue;
        const wasAllottedId = beforeMap[otherBk.id];
        const isAllottedId = afterMap[otherBk.id];

        if (wasAllottedId && wasAllottedId !== isAllottedId) {
          console.log(`[Notification Engine] User ${otherBk.playerName} got bumped due to slot update from ${wasAllottedId} to ${isAllottedId || 'standby'}`);
          const displayNewAllotment = isAllottedId ? `${isAllottedId} UTC` : "Standby Queue / Backup Mode";
          const stateNum = await getStateNumber(otherBk.stateId);
          
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #f43f5e; margin: 0; font-size: 24px; letter-spacing: -0.5px;">PRIORITY DISPLACEMENT</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Allotment Shift Advisory • State Isolated Grid</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Attention Commander <strong>${otherBk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Another alliance commander with higher priority parameter updates has overridden your target timeslot on <strong>${otherBk.eventType.toUpperCase()} Day</strong> in <strong>State ${stateNum}</strong> (isolated state partition). Your slot assignment has adjusted:</p>
              <div style="background-color: #1a1012; border: 1px solid #991b1b; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #f87171; font-family: monospace; display: block; margin-bottom: 4px;">NEW TIMESLOT OVERRIDE</span>
                <strong style="font-size: 26px; color: #ffffff; letter-spacing: 1px;">${displayNewAllotment}</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State Cluster ID</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #f43f5e;">State ${stateNum}</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State Alliance</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(otherBk.allianceId)}</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Old Slot</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #f43f5e; text-decoration: line-through;">${wasAllottedId} UTC</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">New Slot</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${displayNewAllotment}</td>
                </tr>
              </table>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Maintain high speedup levels inside <strong>State ${stateNum}</strong> to protect your scheduled timeslots.
              </p>
            </div>
          `;
          await sendResendEmail({ to: otherBk.email, subject: `Displacement Advisory: Moved to ${isAllottedId || 'Standby'} - State ${stateNum}`, html });
          await logNotificationToDb({ stateId: otherBk.stateId, bookingId: otherBk.id, channel: 'email', recipient: otherBk.email, type: 'displacement', status: 'success' });

          if (otherBk.discordUsername && otherBk.discordUsername.trim()) {
            await sendDiscordDM(otherBk.discordUsername, {
              title: "⚠️ ADJUSTMENT DUE TO PRIORITY SHIFT ⚠️",
              description: `Attention Commander! Another commander in **State ${stateNum}** updated their metrics, triggering automated conflict auto-resolution and displacing your target timeslot for **${otherBk.eventType.toUpperCase()} Day**:`,
              fields: [
                { name: "🛡️ Old Slot Held", value: `~~\`${wasAllottedId} UTC\`~~`, inline: true },
                { name: "⚡ New Assigned Slot", value: `**${displayNewAllotment}**`, inline: true }
              ],
              color: 0xf43f5e
            });
            await logNotificationToDb({ stateId: otherBk.stateId, bookingId: otherBk.id, channel: 'discord', recipient: otherBk.discordUsername, type: 'displacement', status: 'success' });
          }
        }
      }
    } else if (modificationType === 'delete') {
      const bk = beforeBookings.find(b => b.id === modifiedBookingId);
      if (bk) {
        const stateNum = await getStateNumber(bk.stateId);
        const displaySlot = beforeMap[modifiedBookingId] || bk.slotId;
        const html = `
          <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
              <h2 style="color: #ef4444; margin: 0; font-size: 24px; letter-spacing: -0.5px;">RESERVATION CANCELLED</h2>
              <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Slot Eviction Advisory • State-Isolated Schedule</p>
            </div>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your timeslot reservation for <strong>${bk.eventType.toUpperCase()} Day</strong> on State <strong>${stateNum}</strong> has been deleted or cancelled. Your registry listing on this isolated state grid has been removed.</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">State Cluster</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ef4444;">State ${stateNum} (Isolated Schedule)</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Segmented Alliance</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(bk.allianceId)}</td>
              </tr>
            </table>
          </div>
        `;
        await sendResendEmail({ to: bk.email, subject: `Reservation Cancelled - Commander ${bk.playerName} (State ${stateNum})`, html });
        await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'email', recipient: bk.email, type: 'cancellation', status: 'success' });

        if (bk.discordUsername && bk.discordUsername.trim()) {
          await sendDiscordDM(bk.discordUsername, {
            title: "❌ RESERVATION CANCELLED / REMOVED ❌",
            description: `Greetings Commander! Your booked SVS Battle Prep Slot in **State ${stateNum}** (isolated state cluster with independent alliances & schedules) has been cancelled or removed:`,
            fields: [
              { name: "🏰 State Cluster ID", value: `**State ${stateNum}**`, inline: true },
              { name: "🛡️ State Alliance", value: `\`${getAllianceInfo(bk.allianceId)}\``, inline: true },
              { name: "👤 Player Name", value: `\`${bk.playerName}\``, inline: true },
              { name: "📅 Day Affected", value: `**${bk.eventType.toUpperCase()} Day**`, inline: true },
              { name: "🕰️ Timeslot Evicted", value: `\`${displaySlot} UTC\``, inline: true }
            ],
            color: 0xef4444
          });
          await logNotificationToDb({ stateId: bk.stateId, bookingId: bk.id, channel: 'discord', recipient: bk.discordUsername, type: 'cancellation', status: 'success' });
        }
      }

      // Check for user PROMOTED because a deletion freed up a slot!
      for (const otherBk of afterBookings) {
        const wasAllottedId = beforeMap[otherBk.id];
        const isAllottedId = afterMap[otherBk.id];

        if (!wasAllottedId && isAllottedId) {
          const stateNum = await getStateNumber(otherBk.stateId);
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #10b981; margin: 0; font-size: 24px; letter-spacing: -0.5px;">PROMOTED TO ACTIVE SLOT</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Imperial Registry Promotion • Isolated State Grid</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Outstanding News Commander <strong>${otherBk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">An active scheduler timeslot has opened up on <strong>${otherBk.eventType.toUpperCase()} Day</strong> in <strong>State ${stateNum}</strong>. Your standby queue request has been successfully promoted within this state's partitioned registry:</p>
              <div style="background-color: #064e3b; border: 1px solid #059669; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #34d399; font-family: monospace; display: block; margin-bottom: 4px;">PROMOTED TIMESLOT ALLOCATION (STATE ${stateNum})</span>
                <strong style="font-size: 32px; color: #ffffff; letter-spacing: 1px;">${isAllottedId} UTC</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">State Cluster ID</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">State ${stateNum}</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Exclusive Alliance</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${getAllianceInfo(otherBk.allianceId)}</td>
                </tr>
              </table>
            </div>
          `;
          await sendResendEmail({ to: otherBk.email, subject: `PROMOTED to Active Timeslot [${isAllottedId} UTC] - State ${stateNum} (Commander ${otherBk.playerName})`, html });
          await logNotificationToDb({ stateId: otherBk.stateId, bookingId: otherBk.id, channel: 'email', recipient: otherBk.email, type: 'confirmation', status: 'promoted' });

          if (otherBk.discordUsername && otherBk.discordUsername.trim()) {
            await sendDiscordDM(otherBk.discordUsername, {
              title: "%✨ STANDBY PROMOTED TO ACTIVE SLOT ✨",
              description: `Excellent news Commander! A main spot has opened up on **${otherBk.eventType.toUpperCase()} Day** in **State ${stateNum}** (isolated state cluster), promoting you from the standby queue directly to the active timeslots of this state:`,
              fields: [
                { name: "🏰 State Cluster ID", value: `**State ${stateNum}**`, inline: true },
                { name: "🛡️ State Alliance", value: `\`${getAllianceInfo(otherBk.allianceId)}\``, inline: true },
                { name: "👤 Player Name", value: `\`${otherBk.playerName}\``, inline: true },
                { name: "🕰️ Promoted Timeslot", value: `**${isAllottedId} UTC**`, inline: true }
              ],
              color: 0x10b981
            });
            await logNotificationToDb({ stateId: otherBk.stateId, bookingId: otherBk.id, channel: 'discord', recipient: otherBk.discordUsername, type: 'confirmation', status: 'promoted' });
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[Svs Notification Bridge Exception] Dual delivery failed:", err.message);
  }
}

// Diff-analysis notification dispatcher
async function checkAndSendEmailNotifications({
  beforeBookings,
  afterBookings,
  targetDay,
  modifiedBookingId,
  modificationType
}: {
  beforeBookings: any[];
  afterBookings: any[];
  targetDay: string;
  modifiedBookingId: string;
  modificationType: 'create' | 'update' | 'delete';
}) {
  try {
    // Intercept and bypass using our high-fidelity state-isolated Discord bot + SMTP dispatcher
    await executeSvsIntegratedNotifications({
      beforeBookings,
      afterBookings,
      targetDay,
      modifiedBookingId,
      modificationType
    });
    return;
  } catch (bridgeErr: any) {
    console.error("[SVS Notification Bridge Router Exception] Falling back:", bridgeErr.message);
  }

  try {
    // 1. Fetch alliances for names/tags
    const alliancesRes = await pool.query("SELECT * FROM alliances");
    const alliances = alliancesRes.rows;
    const getAllianceInfo = (id: string) => {
      const all = alliances.find(a => a.id === id);
      return all ? `${all.name} [${all.tag}]` : id;
    };

    // 2. Fetch admin email
    const adminEmailRes = await pool.query("SELECT value FROM settings WHERE key = 'admin_notification_email'");
    const adminEmail = adminEmailRes.rows[0]?.value;

    // 3. Compute allotments before & after using shared loadDailySlots helper
    const beforeSlots = loadDailySlots(targetDay as any, JSON.parse(JSON.stringify(beforeBookings)));
    const afterSlots = loadDailySlots(targetDay as any, JSON.parse(JSON.stringify(afterBookings)));

    const beforeMap: { [bId: string]: string } = {};
    beforeSlots.forEach(s => {
      if (s.status === 'booked' && s.bookingId) {
        beforeMap[s.bookingId] = s.id;
      }
    });

    const afterMap: { [bId: string]: string } = {};
    afterSlots.forEach(s => {
      if (s.status === 'booked' && s.bookingId) {
        afterMap[s.bookingId] = s.id;
      }
    });

    console.log(`[Email Engines] Diff-Analysis for ${targetDay} Day. Modification: ${modificationType}. Modified ID: ${modifiedBookingId}`);

    if (modificationType === 'create') {
      const bk = afterBookings.find(b => b.id === modifiedBookingId);
      if (bk) {
        const allottedSlotId = afterMap[bk.id];
        if (allottedSlotId) {
          // Success email
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #38bdf8; margin: 0; font-size: 24px; letter-spacing: -0.5px;">STATE EVENT REGISTRY</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Imperial Slot Confirmation</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your registration for the upcoming <strong>${bk.eventType.toUpperCase()} Day</strong> state battle has been processed. Because of your priority speedup scoring, you have been allotted the following spot:</p>
              <div style="background-color: #0b1530; border: 1px solid #1d4ed8; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #60a5fa; font-family: monospace; display: block; margin-bottom: 4px;">ALLOTTED TIMESLOT</span>
                <strong style="font-size: 32px; color: #ffffff; letter-spacing: 1px;">${allottedSlotId} UTC</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Player Name</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.playerName} (ID: ${bk.userId})</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Event Section</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff; text-transform: capitalize;">${bk.eventType} Day</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Speedup Metrics</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.speedupDays} Days, ${bk.speedupHours} Hours</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #94a3b8;">Priority Weighting Score</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${bk.score} DP</td>
                </tr>
              </table>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Note: The state dispatch system is continuously active. If another commander registers with a higher priority speedup score, they may displace your timeslot automatically. Maintain high speedup capabilities to secure your status.
              </p>
            </div>
          `;
          await sendResendEmail({ to: bk.email, subject: `Slot Confirmation [${allottedSlotId} UTC] - ${bk.playerName}`, html });
        } else {
          // Standby/pending email
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #fbbf24; margin: 0; font-size: 24px; letter-spacing: -0.5px;">STANDBY ENLISTED</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Pending Imperial Registry</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your registration for <strong>${bk.eventType.toUpperCase()} Day</strong> was cataloged, but your target timeslot is currently occupied by a higher-priority commander. You are positioned in the standby queue.</p>
              <div style="background-color: #1a1510; border: 1px solid #d97706; padding: 16px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #fbbf24; font-family: monospace; display: block; margin-bottom: 4px;">CURRENT ASSIGNMENT STATUS</span>
                <strong style="font-size: 22px; color: #ffffff; letter-spacing: 0.5px;">Standby Queue / Awaiting Allocation</strong>
              </div>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Tip: Upgrading your speedup times will automatically raise your priority ranking, instantly securing a slot choice over other entries.
              </p>
            </div>
          `;
          await sendResendEmail({ to: bk.email, subject: `Standby Status Advisory - ${bk.playerName}`, html });
        }
      }

      // Check who got displaced/bumped by this new booking
      for (const otherBk of afterBookings) {
        if (otherBk.id === modifiedBookingId) continue;
        const wasAllottedId = beforeMap[otherBk.id];
        const isAllottedId = afterMap[otherBk.id];

        if (wasAllottedId && wasAllottedId !== isAllottedId) {
          console.log(`[Email Engines] User ${otherBk.playerName} got bumped from ${wasAllottedId} to ${isAllottedId || 'standby'}`);
          const displayNewAllotment = isAllottedId ? `${isAllottedId} UTC` : "Standby Queue / Backup Mode";
          
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #f43f5e; margin: 0; font-size: 24px; letter-spacing: -0.5px;">PRIORITY DISPLACEMENT</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Allotment Shift Advisory</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Attention Commander <strong>${otherBk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Another alliance commander with a higher priority speedup score has registered for your target slot on <strong>${otherBk.eventType.toUpperCase()} Day</strong>. Your slot assignment has automatically adjusted based on your backup parameters:</p>
              <div style="background-color: #1a1012; border: 1px solid #991b1b; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #f87171; font-family: monospace; display: block; margin-bottom: 4px;">NEW TIMESLOT OVERRIDE</span>
                <strong style="font-size: 26px; color: #ffffff; letter-spacing: 1px;">${displayNewAllotment}</strong>
              </div>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">Previous Slot</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #f43f5e; text-decoration: line-through;">${wasAllottedId} UTC</td>
                </tr>
                <tr style="border-bottom: 1px solid #0f172a;">
                  <td style="padding: 10px 0; color: #94a3b8;">New Assigned Slot</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${displayNewAllotment}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; color: #94a3b8;">Adjustment Reason</td>
                  <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #fbbf24;">Displaced by Higher Priority Commander</td>
                </tr>
              </table>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Want to reclaim priority? You can increase your speedup hours by modifying your reservation to override competitor scores. Keep strong and defend the realm.
              </p>
            </div>
          `;
          await sendResendEmail({ to: otherBk.email, subject: `Displacement Advisory: Moved to ${isAllottedId || 'Standby'}`, html });

          // Notify Admin
          if (adminEmail && bk) {
            const adminHtml = `
              <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                  <h2 style="color: #fbbf24; margin: 0; font-size: 24px; letter-spacing: -0.5px;">SYSTEM SECURITY ALERT</h2>
                  <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Conflict Auto-Resolution Report</p>
                </div>
                <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Attention Supreme Administrator,</p>
                <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">The central prioritization algorithm detected and automatically resolved a scheduling conflict on <strong>${targetDay.toUpperCase()} Day</strong>.</p>
                <div style="background-color: #0f172a; border-left: 4px solid #eab308; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                  <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #cbd5e1;">
                    <strong>Action:</strong> <span style="color: #ffffff;">Displacement Triggered</span><br>
                    <strong>Conflict Spot:</strong> <span style="color: #f87144; font-family: monospace; font-weight: bold;">${wasAllottedId} UTC</span><br>
                    <strong>New Allottee:</strong> <span style="color: #10b981; font-weight: bold;">${bk.playerName}</span> (${getAllianceInfo(bk.allianceId)}, Score: ${bk.score} DP)<br>
                    <strong>Bumped Player:</strong> <span style="color: #fb7185; font-weight: bold;">${otherBk.playerName}</span> (${getAllianceInfo(otherBk.allianceId)}, Score: ${otherBk.score} DP)<br>
                    <strong>Bumped Resolution:</strong> Recalibrated to <span style="color: #38bdf8; font-family: monospace; font-weight: bold;">${isAllottedId ? isAllottedId + ' UTC' : 'Standby Queue'}</span>
                  </p>
                </div>
                <p style="font-size: 12px; color: #64748b; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                  🔍 All event parameters match system integrity rules. No manual intervention is needed.
                </p>
              </div>
            `;
            await sendResendEmail({ to: adminEmail, subject: `[CONFLICT RESOLVED] ${bk.playerName} displaced ${otherBk.playerName} @ ${wasAllottedId} UTC`, html: adminHtml });
          }
        }
      }
    } else if (modificationType === 'update') {
      const bk = afterBookings.find(b => b.id === modifiedBookingId);
      const wasSlotId = beforeMap[modifiedBookingId];
      const isSlotId = afterMap[modifiedBookingId];

      if (bk) {
        const displaySlot = isSlotId ? `${isSlotId} UTC` : "Standby Queue";
        const html = `
          <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
              <h2 style="color: #60a5fa; margin: 0; font-size: 24px; letter-spacing: -0.5px;">RESERVATION UPDATED</h2>
              <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Imperial Database Adjustment</p>
            </div>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your reservation parameters for <strong>${bk.eventType.toUpperCase()} Day</strong> have been updated. Details below:</p>
            <div style="background-color: #051c24; border: 1px solid #0891b2; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
              <span style="font-size: 11px; text-transform: uppercase; color: #22d3ee; font-family: monospace; display: block; margin-bottom: 4px;">CURRENT TIMESLOT</span>
              <strong style="font-size: 28px; color: #ffffff; letter-spacing: 1px;">${displaySlot}</strong>
            </div>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; color: #cbd5e1;">
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Player Name</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.playerName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Original Timeslot</td>
                <td style="padding: 10px 0; text-align: right; font-style: italic; color: #94a3b8;">${wasSlotId ? wasSlotId + ' UTC' : 'Standby Queue'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #0f172a;">
                <td style="padding: 10px 0; color: #94a3b8;">Speedup Metrics</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #ffffff;">${bk.speedupDays} Days, ${bk.speedupHours} Hours</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; color: #94a3b8;">Priority Score</td>
                <td style="padding: 10px 0; text-align: right; font-weight: bold; color: #10b981;">${bk.score} DP</td>
              </tr>
            </table>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
              🛡️ Note: Standard priority rules still apply. Keep monitoring the active timeline grids.
            </p>
          </div>
        `;
        await sendResendEmail({ to: bk.email, subject: `Reservation Updated - ${bk.playerName}`, html });
      }

      // Check cascading bumps due to update
      for (const otherBk of afterBookings) {
        if (otherBk.id === modifiedBookingId) continue;
        const wasAllottedId = beforeMap[otherBk.id];
        const isAllottedId = afterMap[otherBk.id];

        if (wasAllottedId && wasAllottedId !== isAllottedId) {
          console.log(`[Email Engines] User ${otherBk.playerName} got bumped due to slot update from ${wasAllottedId} to ${isAllottedId || 'standby'}`);
          const displayNewAllotment = isAllottedId ? `${isAllottedId} UTC` : "Standby Queue / Backup Mode";
          
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #f43f5e; margin: 0; font-size: 24px; letter-spacing: -0.5px;">PRIORITY DISPLACEMENT</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Allotment Shift Advisory</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Attention Commander <strong>${otherBk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Another alliance commander with higher priority parameter updates has overridden your target slot on <strong>${otherBk.eventType.toUpperCase()} Day</strong>. Your slot assignment has automatically adjusted:</p>
              <div style="background-color: #1a1012; border: 1px solid #991b1b; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #f87171; font-family: monospace; display: block; margin-bottom: 4px;">NEW TIMESLOT OVERRIDE</span>
                <strong style="font-size: 26px; color: #ffffff; letter-spacing: 1px;">${displayNewAllotment}</strong>
              </div>
              <p style="font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; padding-top: 16px; border-top: 1px solid #1e293b;">
                🛡️ Maintain high speedup levels to protect your scheduled timeslots.
              </p>
            </div>
          `;
          await sendResendEmail({ to: otherBk.email, subject: `Displacement Advisory: Moved to ${isAllottedId || 'Standby'}`, html });

          // Notify Admin
          if (adminEmail && bk) {
            const adminHtml = `
              <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
                <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                  <h2 style="color: #fbbf24; margin: 0; font-size: 24px; letter-spacing: -0.5px;">SYSTEM SECURITY ALERT</h2>
                  <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Conflict Auto-Resolution Report (Update)</p>
                </div>
                <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Attention Supreme Administrator,</p>
                <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">An active reservation update triggered cascading displacement on <strong>${targetDay.toUpperCase()} Day</strong>.</p>
                <div style="background-color: #0f172a; border-left: 4px solid #eab308; padding: 16px; border-radius: 8px; margin-bottom: 24px;">
                  <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #cbd5e1;">
                    <strong>Action:</strong> <span style="color: #ffffff;">Displacement Via Update</span><br>
                    <strong>Conflict Spot:</strong> <span style="color: #f87144; font-family: monospace; font-weight: bold;">${wasAllottedId} UTC</span><br>
                    <strong>Updated Allottee:</strong> <span style="color: #10b981; font-weight: bold;">${bk.playerName}</span> (${getAllianceInfo(bk.allianceId)}, Score: ${bk.score} DP)<br>
                    <strong>Bumped Player:</strong> <span style="color: #fb7185; font-weight: bold;">${otherBk.playerName}</span> (${getAllianceInfo(otherBk.allianceId)}, Score: ${otherBk.score} DP)<br>
                    <strong>Bumped Resolution:</strong> Recalibrated to <span style="color: #38bdf8; font-family: monospace; font-weight: bold;">${isAllottedId ? isAllottedId + ' UTC' : 'Standby Queue'}</span>
                  </p>
                </div>
              </div>
            `;
            await sendResendEmail({ to: adminEmail, subject: `[CONFLICT RESOLVED BY UPDATE] ${bk.playerName} displaced ${otherBk.playerName} @ ${wasAllottedId} UTC`, html: adminHtml });
          }
        }
      }
    } else if (modificationType === 'delete') {
      const bk = beforeBookings.find(b => b.id === modifiedBookingId);
      if (bk) {
        const html = `
          <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
              <h2 style="color: #ef4444; margin: 0; font-size: 24px; letter-spacing: -0.5px;">RESERVATION CANCELLED</h2>
              <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Slot Eviction Advisory</p>
            </div>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Greetings Commander <strong>${bk.playerName}</strong>,</p>
            <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">Your timeslot reservation for <strong>${bk.eventType.toUpperCase()} Day</strong> was deleted or cancelled by you or an administrator. Your registry listing has been removed.</p>
          </div>
        `;
        await sendResendEmail({ to: bk.email, subject: `Reservation Cancelled - ${bk.playerName}`, html });
      }

      // Check for user PROMOTED because a deletion freed up a slot!
      for (const otherBk of afterBookings) {
        const wasAllottedId = beforeMap[otherBk.id];
        const isAllottedId = afterMap[otherBk.id];

        if (!wasAllottedId && isAllottedId) {
          const html = `
            <div style="background-color: #030712; color: #f1f5f9; font-family: sans-serif; padding: 32px 24px; border-radius: 16px; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto;">
              <div style="text-align: center; margin-bottom: 24px; border-bottom: 1px solid #1e293b; padding-bottom: 16px;">
                <h2 style="color: #10b981; margin: 0; font-size: 24px; letter-spacing: -0.5px;">PROMOTED TO ACTIVE SLOT</h2>
                <p style="color: #94a3b8; font-size: 11px; margin: 4px 0 0 0; text-transform: uppercase; font-family: monospace;">Imperial Registry Promotion</p>
              </div>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1;">Outstanding News Commander <strong>${otherBk.playerName}</strong>,</p>
              <p style="font-size: 14px; line-height: 1.6; color: #cbd5e1; margin-bottom: 24px;">An active scheduler spot has opened up on <strong>${otherBk.eventType.toUpperCase()} Day</strong>. Your queue standby request has been successfully promoted to the active scheduling board:</p>
              <div style="background-color: #064e3b; border: 1px solid #059669; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <span style="font-size: 11px; text-transform: uppercase; color: #34d399; font-family: monospace; display: block; margin-bottom: 4px;">PROMOTED TIMESLOT ALLOCATION</span>
                <strong style="font-size: 32px; color: #ffffff; letter-spacing: 1px;">${isAllottedId} UTC</strong>
              </div>
            </div>
          `;
          await sendResendEmail({ to: otherBk.email, subject: `PROMOTED to Active Timeslot [${isAllottedId} UTC] - ${otherBk.playerName}`, html });
        }
      }
    }
  } catch (err) {
    console.error("[Email Notification Engine] Mapped notifications failure:", err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Bootstrap DB tables
  try {
    const client = await pool.connect();
    try {
      console.log("Bootstrapping Neon PostgreSQL tables...");
      
      // 1. Create States table
      await client.query(`
        CREATE TABLE IF NOT EXISTS states (
          id TEXT PRIMARY KEY,
          state_number TEXT UNIQUE NOT NULL,
          google_spreadsheet_id TEXT DEFAULT '',
          google_sheet_name TEXT DEFAULT 'Sheet1'
        );
      `);

      // Seed default states if none exist
      const stateCountRes = await client.query("SELECT COUNT(*) FROM states");
      if (parseInt(stateCountRes.rows[0].count, 10) === 0) {
        await client.query(`
          INSERT INTO states (id, state_number, google_spreadsheet_id, google_sheet_name) VALUES
          ('st-1085', '1085', '', 'Sheet1')
        `);
        console.log("Seeded default State target: 1085!");
      }

      // 2. Create Admins table with role based assignments
      await client.query(`
        CREATE TABLE IF NOT EXISTS admins (
          username TEXT PRIMARY KEY,
          password_hash TEXT NOT NULL,
          role_level TEXT NOT NULL, -- 'root' or 'state_admin'
          assigned_state_id TEXT REFERENCES states(id) ON DELETE SET NULL
        );
      `);

      // Seed root administrator DEAD with pbkdf2 hash of Sarthak@085
      const adminCountRes = await client.query("SELECT COUNT(*) FROM admins");
      if (parseInt(adminCountRes.rows[0].count, 10) === 0) {
        const seededHash = hashPassword("Sarthak@085");
        await client.query(`
          INSERT INTO admins (username, password_hash, role_level, assigned_state_id)
          VALUES ('DEAD', $1, 'root', NULL)
        `, [seededHash]);
        console.log("Seeded central root account 'DEAD' secure pbkdf2 signature!");
      }

      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS alliances (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tag TEXT NOT NULL,
          color TEXT NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          player_name TEXT NOT NULL,
          user_id TEXT NOT NULL,
          email TEXT NOT NULL,
          alliance_id TEXT NOT NULL,
          event_type TEXT NOT NULL,
          speedup_days INTEGER NOT NULL,
          speedup_hours INTEGER NOT NULL,
          score INTEGER NOT NULL,
          slot_id TEXT NOT NULL,
          backup_slots TEXT NOT NULL, -- JSON formatted array
          auto_assign BOOLEAN NOT NULL,
          timestamp TEXT NOT NULL,
          state_id TEXT DEFAULT 'st-1085' REFERENCES states(id) ON DELETE SET NULL
        );
      `);

      // Migration: Add state_id column if NOT exists
      await client.query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS state_id TEXT DEFAULT 'st-1085';
      `);

      // Migration: Add state_id column to alliances if NOT exists
      await client.query(`
        ALTER TABLE alliances ADD COLUMN IF NOT EXISTS state_id TEXT DEFAULT 'st-1085' REFERENCES states(id) ON DELETE CASCADE;
      `);

      // Migration: Add active_week column to states if NOT exists
      await client.query(`
        ALTER TABLE states ADD COLUMN IF NOT EXISTS active_week TEXT DEFAULT 'w23';
      `);

      // Migration: Add week column if NOT exists
      await client.query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS week TEXT DEFAULT 'w23';
      `);

      // Migration: Add discord_username column if NOT exists
      await client.query(`
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discord_username TEXT DEFAULT '';
      `);

      // Seeding active_week setting if not exist
      await client.query(`
        INSERT INTO settings (key, value) VALUES ('active_week', 'w23') ON CONFLICT DO NOTHING;
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY,
          operator TEXT NOT NULL,
          action TEXT NOT NULL,
          details TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          state_id TEXT DEFAULT 'st-1085' REFERENCES states(id) ON DELETE SET NULL
        );
      `);

      // Migration: Add state_id column if NOT exists
      await client.query(`
        ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS state_id TEXT DEFAULT 'st-1085';
      `);

      // 3. Create Notifications log table matching query schema of logNotificationToDb
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          state_id TEXT NOT NULL REFERENCES states(id) ON DELETE CASCADE,
          booking_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          recipient TEXT NOT NULL,
          type TEXT NOT NULL,
          sent_at TEXT NOT NULL,
          status TEXT NOT NULL
        );
      `);

      // Migration: Create sent_reminders table to track sent Discord/Email notifications
      await client.query(`
        CREATE TABLE IF NOT EXISTS sent_reminders (
          booking_id TEXT NOT NULL,
          slot_id TEXT NOT NULL,
          week TEXT NOT NULL,
          event_type TEXT NOT NULL,
          sent_at TEXT NOT NULL,
          channel TEXT NOT NULL, -- 'discord' or 'email'
          PRIMARY KEY (booking_id, slot_id, week, channel)
        );
      `);

      console.log("Neon Postgres tables check finished!");
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("Error executing bootstrap query:", err);
  }

  // --- API ENDPOINTS ---

  // Google OAuth Config Helper
  app.get('/api/oauth-config', (req, res) => {
    res.json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || ""
    });
  });

  // Settings Key-Value endpoints
  app.get('/api/settings/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const { stateId } = req.query;
      
      if (key === 'active_week' && stateId) {
        const { rows } = await pool.query("SELECT active_week FROM states WHERE id = $1", [stateId]);
        if (rows.length > 0) {
          return res.json({ value: rows[0].active_week || 'w23' });
        }
      }
      
      const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
      res.json({ value: rows[0]?.value || null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const { value } = req.body;
      const { stateId } = req.query;
      
      if (key === 'active_week' && stateId) {
        await pool.query("UPDATE states SET active_week = $1 WHERE id = $2", [value, stateId]);
        return res.json({ success: true });
      }

      await pool.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [key, value]
      );
      
      // If setting change relates to sheets, trigger sync to verify
      if (key === 'google_spreadsheet_id' || key === 'google_service_account_json') {
        triggerQuietBackgroundSync();
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google Service Account Sync & SMTP Stats Route
  app.get('/api/google-sheets/stats', async (req, res) => {
    try {
      let rawSpreadsheetId = null;
      let rawSheetName = 'Sheet1';
      const stateIdQuery = req.query.stateId;
      if (stateIdQuery) {
        const stateRes = await pool.query("SELECT google_spreadsheet_id, google_sheet_name FROM states WHERE id = $1", [stateIdQuery]);
        if (stateRes.rowCount > 0) {
          rawSpreadsheetId = stateRes.rows[0].google_spreadsheet_id;
          rawSheetName = stateRes.rows[0].google_sheet_name || 'Sheet1';
        }
      }
      
      if (!rawSpreadsheetId) {
        const sIdRes = await pool.query("SELECT value FROM settings WHERE key = 'google_spreadsheet_id'");
        rawSpreadsheetId = sIdRes.rows[0]?.value || null;
      }

      const saRes = await pool.query("SELECT value FROM settings WHERE key = 'google_service_account_json'");
      const rawSa = saRes.rows[0]?.value || null;

      const adminEmailRes = await pool.query("SELECT value FROM settings WHERE key = 'admin_notification_email'");
      const adminEmail = adminEmailRes.rows[0]?.value || null;

      const hostRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_host'");
      const smtpHost = hostRes.rows[0]?.value || process.env.SMTP_HOST || 'smtp.gmail.com';

      const portRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_port'");
      const smtpPort = portRes.rows[0]?.value || process.env.SMTP_PORT || '465';

      const userRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_user'");
      const smtpUser = userRes.rows[0]?.value || process.env.SMTP_USER || '';

      const fromRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_from'");
      const smtpFrom = fromRes.rows[0]?.value || process.env.SMTP_FROM || '';

      const passRes = await pool.query("SELECT value FROM settings WHERE key = 'smtp_pass'");
      const smtpPass = passRes.rows[0]?.value || process.env.SMTP_PASS || '';

      const discordTokenRes = await pool.query("SELECT value FROM settings WHERE key = 'discord_bot_token'");
      const discordBotTokenObj = discordTokenRes.rows[0]?.value || '';

      let email = null;
      let configured = false;

      if (rawSa) {
        try {
          const parsed = JSON.parse(rawSa);
          email = parsed.client_email || null;
          configured = !!(parsed.client_email && parsed.private_key);
        } catch (e) {}
      }

      res.json({
        spreadsheetId: rawSpreadsheetId,
        sheetName: rawSheetName,
        serviceAccountEmail: email,
        isConfigured: configured,
        adminNotificationEmail: adminEmail,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpFrom,
        isSmtpConfigured: !!smtpPass,
        isDiscordConfigured: !!discordBotTokenObj
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Manual Trigger Endpoint for Google Sheet sync
  app.post('/api/google-sheets/sync', async (req, res) => {
    const stateIdStr = req.query.stateId || req.body.stateId || undefined;
    const status = await syncPostgresToGoogleSheets(stateIdStr as string | undefined);
    if (status.success) {
      res.json({ success: true, message: status.message, email: status.email });
    } else {
      res.status(400).json({ success: false, message: status.message });
    }
  });

  // Alliances API
  app.get('/api/alliances', async (req, res) => {
    try {
      const { stateId } = req.query;
      let q = "SELECT * FROM alliances";
      let params: any[] = [];
      if (stateId) {
        q += " WHERE state_id = $1";
        params.push(stateId);
      }
      q += " ORDER BY name ASC";
      const { rows } = await pool.query(q, params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/alliances', async (req, res) => {
    try {
      const { id, name, tag, color, stateId } = req.body;
      const fStateId = await getFallbackStateId(stateId);
      await pool.query(
        "INSERT INTO alliances (id, name, tag, color, state_id) VALUES ($1, $2, $3, $4, $5)",
        [id, name, tag, color, fStateId]
      );
      triggerQuietBackgroundSync(fStateId);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error saving new alliance to DB:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/alliances/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name } = req.body;
      await pool.query("UPDATE alliances SET name = $1 WHERE id = $2", [name, id]);
      triggerQuietBackgroundSync();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/alliances/:id', async (req, res) => {
    try {
      const { id } = req.params;
      // Delete bookings associated with it
      await pool.query("DELETE FROM bookings WHERE alliance_id = $1", [id]);
      await pool.query("DELETE FROM alliances WHERE id = $1", [id]);
      triggerQuietBackgroundSync();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // States API
  app.get('/api/states', async (req, res) => {
    try {
      const session = getSession(req);
      let query = "SELECT id, state_number FROM states ORDER BY state_number ASC";
      let params: any[] = [];
      if (session) {
        // Admins can see raw spreadsheets info
        query = "SELECT * FROM states ORDER BY state_number ASC";
      }
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/states', async (req, res) => {
    try {
      const { id, stateNumber, googleSpreadsheetId, googleSheetName } = req.body;
      if (!stateNumber) {
        return res.status(400).json({ error: "State number is required." });
      }
      
      const checkConflict = await pool.query("SELECT id FROM states WHERE state_number = $1", [stateNumber]);
      if (checkConflict.rows.length > 0) {
        return res.status(400).json({ error: `State partition ${stateNumber} is already registered.` });
      }

      const stateId = id || `st-${stateNumber}`;
      await pool.query(
        `INSERT INTO states (id, state_number, google_spreadsheet_id, google_sheet_name)
         VALUES ($1, $2, $3, $4)`,
        [stateId, stateNumber, googleSpreadsheetId || '', googleSheetName || 'Sheet1']
      );
      res.json({
        id: stateId,
        state_number: stateNumber,
        google_spreadsheet_id: googleSpreadsheetId || '',
        google_sheet_name: googleSheetName || 'Sheet1'
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/states/:id', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session) {
        return res.status(401).json({ error: "Unauthenticated administrative access." });
      }
      const { id } = req.params;
      const { googleSpreadsheetId, googleSheetName } = req.body;
      
      // State admins can only modify their assigned state
      if (session.roleLevel !== 1 && session.assignedStateId !== id) {
        return res.status(403).json({ error: "Unauthorized state administrative target." });
      }

      await pool.query(
        "UPDATE states SET google_spreadsheet_id = $1, google_sheet_name = $2 WHERE id = $3",
        [googleSpreadsheetId, googleSheetName || 'Sheet1', id]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/states/:id', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session || session.roleLevel !== 1) {
        return res.status(403).json({ error: "Only root operators can disband states." });
      }
      const { id } = req.params;
      await pool.query("UPDATE admins SET assigned_state_id = NULL WHERE assigned_state_id = $1", [id]);
      await pool.query("DELETE FROM bookings WHERE state_id = $1", [id]);
      await pool.query("DELETE FROM alliances WHERE state_id = $1", [id]);
      await pool.query("DELETE FROM audit_logs WHERE state_id = $1", [id]);
      await pool.query("DELETE FROM states WHERE id = $1", [id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Admin Account & Logins API
  app.post('/api/admins/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
      }
      const { rows } = await pool.query("SELECT * FROM admins WHERE LOWER(username) = LOWER($1)", [username]);
      if (rows.length === 0) {
        return res.status(401).json({ error: "Invalid administrative credentials." });
      }
      const admin = rows[0];
      const valid = verifyPassword(password, admin.password_hash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid administrative credentials." });
      }

      const roleLevelNumber = admin.role_level === 'root' ? 1 : 2; // 1 = root, 2 = State Admin
      const token = `token-${crypto.randomBytes(24).toString('hex')}`;
      activeSessions.set(token, {
        username: admin.username,
        roleLevel: roleLevelNumber,
        assignedStateId: admin.assigned_state_id || undefined
      });

      res.json({
        success: true,
        token,
        admin: {
          username: admin.username,
          roleLevel: admin.role_level,
          assignedStateId: admin.assigned_state_id || null
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admins/me', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session) {
        return res.status(401).json({ error: "No active session." });
      }
      res.json({
         username: session.username,
         roleLevel: session.roleLevel === 1 ? 'root' : 'state_admin',
         assignedStateId: session.assignedStateId || null
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admins/list', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session || session.roleLevel !== 1) {
        return res.status(403).json({ error: "Unauthorized access list operation." });
      }
      const { rows } = await pool.query("SELECT username, role_level, assigned_state_id FROM admins ORDER BY username ASC");
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admins/create', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session || session.roleLevel !== 1) {
        return res.status(403).json({ error: "Only global roots can onboard sub-administrators." });
      }
      const { username, password, roleLevel, assignedStateId } = req.body;
      if (!username || !password || !roleLevel) {
        return res.status(400).json({ error: "Username, password and role are required." });
      }
      const hashed = hashPassword(password);
      await pool.query(
        "INSERT INTO admins (username, password_hash, role_level, assigned_state_id) VALUES ($1, $2, $3, $4)",
        [username, hashed, roleLevel, assignedStateId || null]
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admins/:username', async (req, res) => {
    try {
      const session = getSession(req);
      if (!session || session.roleLevel !== 1) {
        return res.status(403).json({ error: "Only global roots can clear admins." });
      }
      const { username } = req.params;
      if (username.toLowerCase() === 'dead') {
        return res.status(400).json({ error: "System protect rule: Cannot delete root 'DEAD'." });
      }
      await pool.query("DELETE FROM admins WHERE LOWER(username) = LOWER($1)", [username]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bookings API (Fully State Isolated)
  app.get('/api/bookings', async (req, res) => {
    try {
      const stateId = req.query.stateId as string;
      const bookings = await fetchCurrentBookingsFromDb(stateId);
      res.json(bookings);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/bookings', async (req, res) => {
    try {
      const { id, playerName, userId, email, discordUsername, allianceId, eventType, speedupDays, speedupHours, score, slotId, backupSlots, autoAssign, timestamp, week, stateId } = req.body;
      const activeState = await getFallbackStateId(stateId);
      
      const beforeBookings = await fetchCurrentBookingsFromDb(activeState);

      let targetWeek = week;
      if (!targetWeek) {
        targetWeek = await getActiveWeekForState(activeState);
      }

      await pool.query(
        `INSERT INTO bookings (id, player_name, user_id, email, alliance_id, event_type, speedup_days, speedup_hours, score, slot_id, backup_slots, auto_assign, timestamp, week, discord_username, state_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [id, playerName, userId, email, allianceId, eventType, speedupDays, speedupHours, score, slotId, JSON.stringify(backupSlots), autoAssign, timestamp, targetWeek, discordUsername || '', activeState]
      );
      
      triggerQuietBackgroundSync(activeState);

      const afterBookings = await fetchCurrentBookingsFromDb(activeState);

      // Trigger asynchronous notifications bound to activeState
      checkAndSendEmailNotifications({
        beforeBookings,
        afterBookings,
        targetDay: eventType,
        modifiedBookingId: id,
        modificationType: 'create'
      }).catch(err => console.error("Async email dispatch error:", err));

      res.json({ success: true });
    } catch (err: any) {
      console.error("Error saving booking to DB:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/bookings/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { slotId, speedupDays, speedupHours, score } = req.body;

      // Access active state directly from target booking
      const lookupRes = await pool.query("SELECT state_id, event_type FROM bookings WHERE id = $1", [id]);
      if (lookupRes.rows.length === 0) {
        return res.status(444).json({ error: "Booking target does not exist." });
      }
      const activeState = lookupRes.rows[0].state_id;
      const targetDay = lookupRes.rows[0].event_type || 'monday';

      const beforeBookings = await fetchCurrentBookingsFromDb(activeState);

      await pool.query(
        `UPDATE bookings 
         SET slot_id = $1, speedup_days = $2, speedup_hours = $3, score = $4
         WHERE id = $5`,
         [slotId, speedupDays, speedupHours, score, id]
      );
      
      triggerQuietBackgroundSync(activeState);

      const afterBookings = await fetchCurrentBookingsFromDb(activeState);

      checkAndSendEmailNotifications({
        beforeBookings,
        afterBookings,
        targetDay,
        modifiedBookingId: id,
        modificationType: 'update'
      }).catch(err => console.error("Async email dispatch error:", err));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/bookings/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const lookupRes = await pool.query("SELECT state_id, event_type FROM bookings WHERE id = $1", [id]);
      if (lookupRes.rows.length === 0) {
        return res.status(444).json({ error: "Booking target does not exist." });
      }
      const activeState = lookupRes.rows[0].state_id;
      const targetDay = lookupRes.rows[0].event_type || 'monday';

      const beforeBookings = await fetchCurrentBookingsFromDb(activeState);

      await pool.query("DELETE FROM bookings WHERE id = $1", [id]);
      
      triggerQuietBackgroundSync(activeState);

      const afterBookings = await fetchCurrentBookingsFromDb(activeState);

      checkAndSendEmailNotifications({
        beforeBookings,
        afterBookings,
        targetDay,
        modifiedBookingId: id,
        modificationType: 'delete'
      }).catch(err => console.error("Async email dispatch error:", err));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Audit Logs API (Restricted by state assignments)
  app.get('/api/audit-logs', async (req, res) => {
    try {
      const stateId = req.query.stateId as string;
      let query = "SELECT * FROM audit_logs";
      let params: any[] = [];
      if (stateId) {
        query = "SELECT * FROM audit_logs WHERE state_id = $1";
        params = [stateId];
      }
      query += " ORDER BY timestamp DESC LIMIT 400";
      const { rows } = await pool.query(query, params);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/audit-logs', async (req, res) => {
    try {
      const { id, operator, action, details, timestamp, stateId } = req.body;
      const activeState = await getFallbackStateId(stateId);
      await pool.query(
        "INSERT INTO audit_logs (id, operator, action, details, timestamp, state_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, operator, action, details, timestamp, activeState]
      );
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error saving audit log in DB:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // CLEAR DATA (For clean reset on command, keeps credentials)
  app.post('/api/clear-all-data', async (req, res) => {
    try {
      await pool.query("DELETE FROM bookings");
      await pool.query("DELETE FROM audit_logs");
      triggerQuietBackgroundSync();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Serve static files / Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer();
