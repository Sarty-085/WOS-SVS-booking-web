import express from 'express';
import path from 'path';
import pg from 'pg';
import { createServer as createViteServer } from 'vite';
import { JWT } from 'google-auth-library';
import nodemailer from 'nodemailer';
import { loadDailySlots } from './src/dataStore';

const { Pool } = pg;

// DATABASE_URL must be set in environment (via Render env vars or .env locally)
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("FATAL: DATABASE_URL environment variable is not set. Please configure it in your Render dashboard or .env file.");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
});

/**
 * Perform server-side synchronization of PostgreSQL bookings to Google Sheets
 */
async function syncPostgresToGoogleSheets(): Promise<{ success: boolean; message: string; email?: string }> {
  try {
    // 1. Fetch settings from Postgres
    const sIdRes = await pool.query("SELECT value FROM settings WHERE key = 'google_spreadsheet_id'");
    const rawSpreadsheetId = sIdRes.rows[0]?.value;

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
    const actWeekRes = await pool.query("SELECT value FROM settings WHERE key = 'active_week'");
    const activeWeek = actWeekRes.rows[0]?.value || 'w23';

    const bookingsRes = await pool.query("SELECT * FROM bookings WHERE week = $1", [activeWeek]);
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
function triggerQuietBackgroundSync() {
  syncPostgresToGoogleSheets().then((status) => {
    if (status.success) {
      console.log(`[Google Sheets Auto-Sync] SUCCESS. Synced with service account: ${status.email}`);
    } else {
      console.log(`[Google Sheets Auto-Sync] SKIPPED/FAILED. ${status.message}`);
    }
  }).catch((e) => {
    console.error("[Google Sheets Auto-Sync] Critical error:", e);
  });
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

// Fetch all bookings from postgres, formatted as Booking objects
async function fetchCurrentBookingsFromDb(): Promise<any[]> {
  const { rows } = await pool.query("SELECT * FROM bookings");
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
    week: r.week || 'w23'
  }));
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
  // Render injects PORT dynamically; fall back to 3000 for local dev
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // Bootstrap DB tables
  try {
    const client = await pool.connect();
    try {
      console.log("Bootstrapping Neon PostgreSQL tables...");
      
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
          timestamp TEXT NOT NULL
        );
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
          timestamp TEXT NOT NULL
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

      // Seed default alliances if empty
      const { rows } = await client.query("SELECT COUNT(*) FROM alliances");
      if (parseInt(rows[0].count, 10) === 0) {
        await client.query(`
          INSERT INTO alliances (id, name, tag, color) VALUES
          ('all-1', 'Bastion Throne', 'BTN', '#ec4899'),
          ('all-2', 'Shadow Spies', 'SPY', '#a855f7'),
          ('all-3', 'Dominion Coalition', 'DNC', '#f97316'),
          ('all-4', 'Blizzard Vanguard', 'BAZ', '#3b82f6'),
          ('all-5', 'Frozen Fellowship', 'FzF', '#22c55e'),
          ('all-6', 'Royal Scepter', 'ROYAL', '#06b6d4')
        `);
        console.log("Seeded default alliances into PostgreSQL!");
      }
      
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
      const sIdRes = await pool.query("SELECT value FROM settings WHERE key = 'google_spreadsheet_id'");
      const rawSpreadsheetId = sIdRes.rows[0]?.value || null;

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
    const status = await syncPostgresToGoogleSheets();
    if (status.success) {
      res.json({ success: true, message: status.message, email: status.email });
    } else {
      res.status(400).json({ success: false, message: status.message });
    }
  });

  // Alliances API
  app.get('/api/alliances', async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM alliances ORDER BY name ASC");
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/alliances', async (req, res) => {
    try {
      const { id, name, tag, color } = req.body;
      await pool.query(
        "INSERT INTO alliances (id, name, tag, color) VALUES ($1, $2, $3, $4)",
        [id, name, tag, color]
      );
      triggerQuietBackgroundSync();
      res.json({ success: true });
    } catch (err: any) {
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

  // Bookings API
  app.get('/api/bookings', async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM bookings");
      const mapped = rows.map(r => ({
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
        backupSlots: JSON.parse(r.backup_slots),
        autoAssign: r.auto_assign,
        timestamp: r.timestamp,
        week: r.week || 'w23'
      }));
      res.json(mapped);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/bookings', async (req, res) => {
    try {
      const { id, playerName, userId, email, discordUsername, allianceId, eventType, speedupDays, speedupHours, score, slotId, backupSlots, autoAssign, timestamp, week } = req.body;
      
      const beforeBookings = await fetchCurrentBookingsFromDb();

      let targetWeek = week;
      if (!targetWeek) {
        const actWeekRes = await pool.query("SELECT value FROM settings WHERE key = 'active_week'");
        targetWeek = actWeekRes.rows[0]?.value || 'w23';
      }

      await pool.query(
        `INSERT INTO bookings (id, player_name, user_id, email, alliance_id, event_type, speedup_days, speedup_hours, score, slot_id, backup_slots, auto_assign, timestamp, week, discord_username)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [id, playerName, userId, email, allianceId, eventType, speedupDays, speedupHours, score, slotId, JSON.stringify(backupSlots), autoAssign, timestamp, targetWeek, discordUsername || '']
      );
      
      triggerQuietBackgroundSync();

      const afterBookings = await fetchCurrentBookingsFromDb();

      // Trigger asynchronous notifications so REST response is fast
      checkAndSendEmailNotifications({
        beforeBookings,
        afterBookings,
        targetDay: eventType,
        modifiedBookingId: id,
        modificationType: 'create'
      }).catch(err => console.error("Async email dispatch error:", err));

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/bookings/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { slotId, speedupDays, speedupHours, score } = req.body;

      const beforeBookings = await fetchCurrentBookingsFromDb();
      const targetBk = beforeBookings.find(b => b.id === id);
      const targetDay = targetBk?.eventType || 'monday';

      await pool.query(
        `UPDATE bookings 
         SET slot_id = $1, speedup_days = $2, speedup_hours = $3, score = $4
         WHERE id = $5`,
        [slotId, speedupDays, speedupHours, score, id]
      );
      
      triggerQuietBackgroundSync();

      const afterBookings = await fetchCurrentBookingsFromDb();

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

      const beforeBookings = await fetchCurrentBookingsFromDb();
      const targetBk = beforeBookings.find(b => b.id === id);
      const targetDay = targetBk?.eventType || 'monday';

      await pool.query("DELETE FROM bookings WHERE id = $1", [id]);
      
      triggerQuietBackgroundSync();

      const afterBookings = await fetchCurrentBookingsFromDb();

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

  // Audit Logs API
  app.get('/api/audit-logs', async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 400");
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/audit-logs', async (req, res) => {
    try {
      const { id, operator, action, details, timestamp } = req.body;
      await pool.query(
        "INSERT INTO audit_logs (id, operator, action, details, timestamp) VALUES ($1, $2, $3, $4, $5)",
        [id, operator, action, details, timestamp]
      );
      res.json({ success: true });
    } catch (err: any) {
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
