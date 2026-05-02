import express from "express";
import axios from "axios";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const DATABASE_URL = process.env.DATABASE_URL;

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// DB
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ======================
// INIT DB
// ======================
await pool.query(`
CREATE TABLE IF NOT EXISTS users (
  user_id BIGINT PRIMARY KEY,
  payment_id TEXT,
  expires_at BIGINT
);
`);

// ======================
// HELPERS
// ======================
async function sendMessage(chatId, text, options = {}) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
    ...options
  });
}

function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);

  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ======================
// TELEGRAM WEBHOOK
// ======================
app.post(`/telegram-webhook/${BOT_TOKEN}`, async (req, res) => {
  res.sendStatus(200);

  const msg = req.body.message;
  if (!msg) return;

  const userId = msg.from.id;
  const text = msg.text;

  console.log(`📩 ${userId} → ${text}`);

  // START
  if (text === "/start") {
    await sendMessage(userId, "Welcome!", {
      reply_markup: {
        keyboard: [[{ text: "💰 Buy Access" }]],
        resize_keyboard: true
      }
    });
  }

  // BUY
  if (text === "💰 Buy Access") {
    const paymentId = `user_${userId}_${Date.now()}`;

    await pool.query(
      `INSERT INTO users (user_id, payment_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET payment_id = $2`,
      [userId, paymentId]
    );

    console.log(`🛒 BUY → ${userId}`);

    const paymentLink = `https://your-payment-link.com?custom_id=${paymentId}`;

    await sendMessage(userId, `💳 Pay here:\n${paymentLink}`);
  }

  // STATUS
  if (text === "/status") {
    const { rows } = await pool.query(
      `SELECT expires_at FROM users WHERE user_id=$1`,
      [userId]
    );

    if (!rows.length || !rows[0].expires_at) {
      await sendMessage(userId, "❌ No active access");
      return;
    }

    const remaining = rows[0].expires_at - Date.now();

    await sendMessage(
      userId,
      `✅ Active\n⏳ Remaining: ${formatTime(remaining)}`
    );
  }

  // ACCESS
  if (text === "/access") {
    const { rows } = await pool.query(
      `SELECT expires_at FROM users WHERE user_id=$1`,
      [userId]
    );

    if (!rows.length || rows[0].expires_at < Date.now()) {
      await sendMessage(userId, "❌ Access expired");
      return;
    }

    const linkRes = await axios.post(`${TELEGRAM_API}/createChatInviteLink`, {
      chat_id: CHANNEL_ID,
      member_limit: 1
    });

    const link = linkRes.data.result.invite_link;

    await sendMessage(userId, `🔗 ${link}`);
  }
});

// ======================
// PAYPAL WEBHOOK
// ======================
app.post("/paypal-webhook", async (req, res) => {
  res.sendStatus(200);

  const event = req.body;

  console.log("💰 PAYPAL EVENT");

  const customId =
    event?.resource?.custom_id ||
    event?.resource?.purchase_units?.[0]?.custom_id;

  if (!customId) {
    console.log("❌ No custom_id");
    return;
  }

  const { rows } = await pool.query(
    `SELECT user_id FROM users WHERE payment_id=$1`,
    [customId]
  );

  if (!rows.length) {
    console.log("❌ No user match");
    return;
  }

  const userId = rows[0].user_id;

  console.log(`✅ MATCH → ${userId}`);

  const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

  await pool.query(
    `UPDATE users SET expires_at=$1 WHERE user_id=$2`,
    [Date.now() + ONE_MONTH, userId]
  );

  const linkRes = await axios.post(`${TELEGRAM_API}/createChatInviteLink`, {
    chat_id: CHANNEL_ID,
    member_limit: 1
  });

  const link = linkRes.data.result.invite_link;

  await sendMessage(userId, `✅ Payment confirmed!\n🔗 ${link}`);
});

// ======================
// AUTO KICK
// ======================
setInterval(async () => {
  const now = Date.now();

  const { rows } = await pool.query(`SELECT user_id, expires_at FROM users`);

  for (const user of rows) {
    if (user.expires_at && now > user.expires_at) {
      try {
        await axios.post(`${TELEGRAM_API}/banChatMember`, {
          chat_id: CHANNEL_ID,
          user_id: user.user_id
        });

        await axios.post(`${TELEGRAM_API}/unbanChatMember`, {
          chat_id: CHANNEL_ID,
          user_id: user.user_id
        });

        await pool.query(
          `UPDATE users SET expires_at=NULL WHERE user_id=$1`,
          [user.user_id]
        );

        console.log(`⛔ Removed: ${user.user_id}`);
      } catch (err) {
        console.log("Kick error:", err.message);
      }
    }
  }
}, 5 * 60 * 1000);

// ======================
// START
// ======================
app.get("/", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log("🚀 Server running");

  await axios.post(`${TELEGRAM_API}/setWebhook`, {
    url: `${process.env.RAILWAY_STATIC_URL}/telegram-webhook/${BOT_TOKEN}`
  });

  console.log("✅ Webhook set");
});
