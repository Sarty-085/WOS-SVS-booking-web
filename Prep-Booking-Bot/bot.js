import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environmental properties
dotenv.config();

// PostgreSQL database configuration fallback
const dbConnectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_NrZ0fLbFap2Q@ep-wispy-river-ao7qo2tt-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

// Connect to the synchronized bookings database
const pool = new pg.Pool({
  connectionString: dbConnectionString,
});

async function getDiscordBotToken() {
  // If set in environment, use that
  if (process.env.DISCORD_BOT_TOKEN) {
    return process.env.DISCORD_BOT_TOKEN;
  }
  // Otherwise, load dynamically from settings table
  try {
    const res = await pool.query("SELECT value FROM settings WHERE key = 'discord_bot_token'");
    return res.rows[0]?.value || null;
  } catch (err) {
    console.error("[-] Failed to retrieve bot token from DB settings table:", err.message);
    return null;
  }
}

// Initialize Client with proper gateway intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
  ]
});

client.once('ready', () => {
  console.log(`[+] Bot successfully authenticated as ${client.user.tag}`);
  console.log(`[+] Activating SVS active-period notification scanner daemon...`);
  
  // Launch periodic checks every 60 seconds
  setInterval(scanAndTriggerReminders, 60 * 1000);
  
  // Initial run
  scanAndTriggerReminders();
});

// Helper to look up a Discord User object by their registered In-game custom name
async function resolveUserByUsername(username) {
  if (!username) return null;
  const targetUser = username.toLowerCase().replace(/^@/, '').trim();
  
  for (const guild of client.guilds.cache.values()) {
    try {
      console.log(`[~] Fetching members cache for guild: "${guild.name}" to locate @${targetUser}...`);
      const members = await guild.members.fetch();
      const memberMatch = members.find(m => 
        m.user.username.toLowerCase() === targetUser || 
        m.user.tag.toLowerCase() === targetUser
      );
      if (memberMatch) {
        return memberMatch.user;
      }
    } catch (err) {
      console.error(`[-] Could not search membership inside "${guild.name}":`, err.message);
    }
  }
  return null;
}

async function scanAndTriggerReminders() {
  try {
    // 1. Identify active week and current day mapping
    const weekRes = await pool.query("SELECT value FROM settings WHERE key = 'active_week'");
    const activeWeek = weekRes.rows[0]?.value || 'w23';

    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const now = new Date();
    const currentDayName = days[now.getUTCDay()];

    console.log(`[Cycle Scan] Tick at ${now.toISOString()} - Week: ${activeWeek} | Day: ${currentDayName}`);

    // If today is not an active battle day, skip checks
    if (!['monday', 'tuesday', 'thursday'].includes(currentDayName)) {
      return;
    }

    // 2. Query bookings config
    const bookingsRes = await pool.query(
      `SELECT b.*, a.name as alliance_name, a.tag as alliance_tag 
       FROM bookings b 
       LEFT JOIN alliances a ON b.alliance_id = a.id 
       WHERE b.week = $1 AND b.event_type = $2`,
      [activeWeek, currentDayName]
    );

    const bookings = bookingsRes.rows;
    for (const row of bookings) {
      const discordUsername = row.discord_username;
      
      // Skip bookings without a Discord handle
      if (!discordUsername || discordUsername.trim() === '') {
        continue;
      }

      const slotId = row.slot_id; // e.g. "12:30", "15:00"
      const [hStr, mStr] = slotId.split(':');
      const hours = parseInt(hStr, 10);
      const minutes = parseInt(mStr, 10);

      const targetTimeToday = new Date(now);
      targetTimeToday.setUTCHours(hours, minutes, 0, 0);

      // Check current offset to target time in minutes
      const differenceMs = targetTimeToday.getTime() - now.getTime();
      const minutesRemaining = Math.round(differenceMs / (1000 * 60));

      console.log(`[Booking Check] Operator: ${row.player_name} | Slot: ${slotId} | Target Epoch Remaining: ${minutesRemaining} mins`);

      // Reminder matches within the 30-minute reminder threshold (25 to 35 range limit)
      if (minutesRemaining >= 25 && minutesRemaining <= 35) {
        // Double-check if already dispatched to prevent spamming
        const sentRes = await pool.query(
          "SELECT 1 FROM sent_reminders WHERE booking_id = $1 AND slot_id = $2 AND week = $3 AND channel = 'discord'",
          [row.id, slotId, activeWeek]
        );

        if (sentRes.rowCount > 0) {
          console.log(`[Skip] Already delivered Discord warning for booking ${row.id} previously.`);
          continue;
        }

        // Search Discord User handle
        console.log(`[Match] Attempting user matching for @${discordUsername}...`);
        const discordUser = await resolveUserByUsername(discordUsername);
        
        if (!discordUser) {
          console.warn(`[Warning] Could not find Discord User matching raw handle: @${discordUsername} in any mutual guilds.`);
          continue;
        }

        // Construct high-status visual embed
        const customEmbed = new EmbedBuilder()
          .setTitle("🚨 PREP BATTLE EVENT SLOT EXHORTATION 🚨")
          .setURL("https://ai.studio/build")
          .setDescription(`## Attention, Commander!\nYour registered **SVS Battle Prep Slot** under **Prep Booking Console** commences in **30 minutes**. Log in to secure your placement immediately!`)
          .setThumbnail("https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&h=150&q=80")
          .setColor(0x06b6d4) // Vivid Cyan
          .addFields(
            { name: "👤 In-game Name", value: `\`${row.player_name}\` (User ID: ${row.user_id})`, inline: true },
            { name: "🛡️ Alliance affiliation", value: `**${row.alliance_name || 'Individual'}** \`[${row.alliance_tag || 'SVS'}]\``, inline: true },
            { name: "⏰ Slot Commencement", value: `**${slotId} UTC**`, inline: true },
            { name: "📅 Battle Phase Day", value: `**${row.event_type.toUpperCase()}**`, inline: true },
            { name: "📦 Priority speedups", value: `\`${row.speedup_days || 0} Days, ${row.speedup_hours || 0} Hours\``, inline: true },
            { name: "⚡ Leaderboard weight", value: `**${(row.score || 0).toLocaleString()} DP Priority Score**`, inline: true }
          )
          .setImage("https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=800&h=200&q=80")
          .setFooter({ 
            text: "🚨 Remember: Ensure Direct Messages from server members are enabled on this server to keep receiving alerts! | Prep Booking automated daemon",
            iconURL: discordUser.displayAvatarURL()
          })
          .setTimestamp();

        try {
          // Send DM to the user
          await discordUser.send({
            embeds: [customEmbed]
          });
          
          console.log(`[Success] Successfully delivered beautiful alert to DM for @${discordUsername}!`);

          // Register in PostgreSQL sent table
          await pool.query(
            "INSERT INTO sent_reminders (booking_id, slot_id, week, event_type, sent_at, channel) VALUES ($1, $2, $3, $4, $5, $6)",
            [row.id, slotId, activeWeek, row.event_type, new Date().toISOString(), 'discord']
          );
        } catch (err) {
          console.error(`[-] Direct Message delivery failed for user @${discordUsername}. This usually happens of DMs are disabled globally or on the server:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error("[-] Error inside automated notification scanner cycle:", err);
  }
}

// Bootstrap application daemon
async function startDaemon() {
  console.log("[~] Starting Discord Bot setup phase, verifying security credentials...");
  const token = await getDiscordBotToken();
  if (!token || token.trim() === '') {
    console.warn("[-] No valid Discord token configured yet in database properties or environmental vars.");
    console.warn("[!] Please head over to the Web Dashboard Admin Setup panel and configure the Discord Bot Token to start notifications.");
    
    // Check back again in 10 seconds in case an admin saves it on the dashboard
    setTimeout(startDaemon, 10000);
    return;
  }
  
  try {
    await client.login(token);
  } catch (err) {
    console.error("[-] Auth signature mismatch / login exception triggered:", err.message);
    console.log("[~] Re-checking credentials database query thread in 15 seconds...");
    setTimeout(startDaemon, 15000);
  }
}

startDaemon();
