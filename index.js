import express from "express";
import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// =====================
// DATABASE
// =====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =====================
// TELEGRAM BOT
// =====================
const bot = new TelegramBot(process.env.BOT_TOKEN);

// =====================
// WEBHOOK ROUTE
// =====================
app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// =====================
// BOT COMMANDS
// =====================

// /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;

  try {
    await pool.query(
      `INSERT INTO users (user_id, has_access, expires_at)
       VALUES ($1, false, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );

    await bot.sendMessage(
      msg.chat.id,
      "Welcome 🚀\n\nUse /access to check your subscription."
    );
  } catch (err) {
    console.error(err);
  }
});

// /access
bot.onText(/\/access/, async (msg) => {
  const userId = msg.from.id;

  try {
    const result = await pool.query(
      `SELECT has_access, expires_at FROM users WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "No access record found.");
    }

    const { has_access, expires_at } = result.rows[0];

    const now = Date.now();

    if (has_access && expires_at > now) {
      bot.sendMessage(msg.chat.id, "✅ You have access.");
    } else {
      bot.sendMessage(msg.chat.id, "❌ Access expired or not active.");
    }

  } catch (err) {
    console.error(err);
  }
});

// =====================
// PAYMENT SIMULATION (you can replace later with PayPal webhook)
// =====================
app.get("/grant-access/:userId", async (req, res) => {
  const userId = req.params.userId;

  const expires = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days

  try {
    await pool.query(
      `UPDATE users
       SET has_access = true,
           expires_at = $1
       WHERE user_id = $2`,
      [expires, userId]
    );

    await bot.sendMessage(userId, "🎉 Access granted for 30 days!");

    res.send("Access granted");

  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// =====================
// START SERVER + WEBHOOK
// =====================
app.listen(PORT, async () => {
  console.log("🚀 Server running");

  try {
    const url = process.env.RAILWAY_STATIC_URL;

    await bot.setWebHook(`${url}/bot${process.env.BOT_TOKEN}`);

    console.log("✅ Webhook set:", `${url}/bot${process.env.BOT_TOKEN}`);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});
