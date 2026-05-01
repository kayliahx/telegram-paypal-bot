import express from "express";
import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const ADMIN_ID = process.env.ADMIN_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PAYPAL_LINK = process.env.PAYPAL_LINK;
const DATABASE_URL = process.env.DATABASE_URL;

// ===== TELEGRAM =====
const bot = new TelegramBot(TOKEN);

// ===== DATABASE =====
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ===== INIT DB =====
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      expiry BIGINT
    );
  `);
  console.log("✅ Database ready");
})();

// ===== HELPER =====
async function getUser(userId) {
  const res = await pool.query(
    "SELECT * FROM users WHERE user_id = $1",
    [userId]
  );
  return res.rows[0];
}

async function setUser(userId, expiry) {
  await pool.query(
    `INSERT INTO users (user_id, expiry)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET expiry = EXCLUDED.expiry`,
    [userId, expiry]
  );
}

// ===== WEBHOOK =====
app.post(`/webhook`, async (req, res) => {
  console.log("📩 Update received");

  const update = req.body;

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    console.log("💬", userId, text);

    // ===== /start =====
    if (text === "/start") {
      return bot.sendMessage(
        chatId,
        "👋 Welcome!\n\nUse /buy to get access\nUse /status to check access"
      );
    }

    // ===== /buy =====
    if (text === "/buy") {
      return bot.sendMessage(
        chatId,
        `💳 Pay here:\n${PAYPAL_LINK}`
      );
    }

    // ===== /status =====
    if (text === "/status") {
      const user = await getUser(userId);

      if (!user || Date.now() > user.expiry) {
        return bot.sendMessage(chatId, "❌ No active subscription");
      }

      const timeLeft = Math.floor((user.expiry - Date.now()) / 1000 / 60);
      return bot.sendMessage(
        chatId,
        `✅ Active\n⏳ ${timeLeft} minutes left`
      );
    }

    // ===== /grant (ADMIN ONLY) =====
    if (text.startsWith("/grant") && userId.toString() === ADMIN_ID) {
      const parts = text.split(" ");
      const target = parts[1];
      const minutes = parseInt(parts[2]);

      if (!target || !minutes) {
        return bot.sendMessage(chatId, "Usage: /grant userId minutes");
      }

      const expiry = Date.now() + minutes * 60 * 1000;
      await setUser(target, expiry);

      return bot.sendMessage(chatId, "✅ User granted access");
    }
  }

  res.sendStatus(200);
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("🚀 Server running");

  // Set webhook automatically
  const webhook = `${WEBHOOK_URL}/webhook`;
  await bot.setWebHook(webhook);

  console.log("🔗 Webhook set:", webhook);
});
