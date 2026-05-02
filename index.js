import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import pkg from 'pg';
const { Pool } = pkg;

const bot = new TelegramBot(process.env.BOT_TOKEN);
const app = express();

// =====================
// DATABASE
// =====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =====================
// SERVER (Railway needs it)
// =====================
app.get('/', (req, res) => {
  res.send('Bot running');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🚀 Server running');
});

// =====================
// TIME PARSER (5m, 2h, 3d, 1mo)
// =====================
function parseDuration(input) {
  const match = input.match(/^(\d+)(m|h|d|mo)$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  const now = Date.now();

  switch (unit) {
    case 'm': return now + value * 60 * 1000;
    case 'h': return now + value * 60 * 60 * 1000;
    case 'd': return now + value * 24 * 60 * 60 * 1000;
    case 'mo': return now + value * 30 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// =====================
// ENSURE USER EXISTS
// =====================
async function ensureUser(userId) {
  await pool.query(
    `INSERT INTO users (user_id, has_access, expires_at)
     VALUES ($1, false, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

// =====================
// START
// =====================
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;

  await ensureUser(userId);

  bot.sendMessage(userId, `👋 Welcome!\n\nUse /buy 5m or /buy 1h etc.`);
});

// =====================
// BUY (TEST MODE)
// =====================
bot.onText(/\/buy (.+)/, async (msg, match) => {
  const userId = msg.from.id;
  const durationInput = match[1];

  const expiresAt = parseDuration(durationInput);

  if (!expiresAt) {
    return bot.sendMessage(userId, `❌ Invalid format\nUse: 5m, 1h, 3d, 1mo`);
  }

  await ensureUser(userId);

  await pool.query(
    `UPDATE users
     SET has_access = true,
         expires_at = $1
     WHERE user_id = $2`,
    [expiresAt, userId]
  );

  bot.sendMessage(userId, `✅ Access granted for ${durationInput}`);
});

// =====================
// STATUS
// =====================
bot.onText(/\/status/, async (msg) => {
  const userId = msg.from.id;

  await ensureUser(userId);

  const result = await pool.query(
    `SELECT has_access, expires_at
     FROM users
     WHERE user_id = $1`,
    [userId]
  );

  const user = result.rows[0];

  if (!user.has_access) {
    return bot.sendMessage(userId, `❌ No active access`);
  }

  const remaining = user.expires_at - Date.now();

  if (remaining <= 0) {
    return bot.sendMessage(userId, `⛔ Expired`);
  }

  const minutes = Math.floor(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  bot.sendMessage(userId,
    `✅ Active\n⏳ Remaining: ${days}d ${hours % 24}h ${minutes % 60}m`
  );
});

// =====================
// AUTO EXPIRY CHECK (NO SPAM)
// =====================
setInterval(async () => {
  try {
    const now = Date.now();

    const result = await pool.query(
      `SELECT user_id FROM users
       WHERE has_access = true AND expires_at <= $1`,
      [now]
    );

    for (const user of result.rows) {
      await pool.query(
        `UPDATE users
         SET has_access = false
         WHERE user_id = $1`,
        [user.user_id]
      );

      bot.sendMessage(user.user_id, `⛔ Your access expired`);
    }

  } catch (err) {
    console.error('Expiry check error:', err);
  }
}, 60000); // runs every 1 min (NO spam)

// =====================
// WEBHOOK (Railway)
// =====================
const url = process.env.RAILWAY_STATIC_URL;

if (url) {
  bot.setWebHook(`${url}/bot${process.env.BOT_TOKEN}`);
  app.use(bot.webHookCallback(`/bot${process.env.BOT_TOKEN}`));
  console.log('✅ Webhook set');
} else {
  bot.startPolling();
}
