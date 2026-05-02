import express from "express";
import { Bot } from "grammy";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

const bot = new Bot(process.env.BOT_TOKEN);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PORT = process.env.PORT || 3000;
const CHANNEL_ID = process.env.CHANNEL_ID;

// ================= START =================
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;

  await pool.query(
    "INSERT INTO users (user_id, has_access, expires_at) VALUES ($1, false, 0) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );

  await ctx.reply("Welcome 🚀\n\nUse /access to check your subscription.");
});

// ================= ACCESS =================
bot.command("access", async (ctx) => {
  const userId = ctx.from.id;

  const result = await pool.query(
    "SELECT has_access, expires_at FROM users WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return ctx.reply("❌ No data found.");
  }

  const { has_access, expires_at } = result.rows[0];
  const now = Math.floor(Date.now() / 1000);

  if (!has_access || expires_at < now) {
    return ctx.reply("❌ Access expired or not active.");
  }

  const remaining = expires_at - now;
  ctx.reply(`✅ Active\n⏳ Remaining: ${remaining}s`);
});

// ================= BUY =================
bot.command("buy", async (ctx) => {
  const userId = ctx.from.id;

  const link = `${process.env.PAYPAL_LINK}?custom_id=${userId}`;

  await ctx.reply("💰 Click below to subscribe:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💰 Buy Access", url: link }]
      ],
    },
  });
});

// ================= PAYPAL WEBHOOK =================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event_type === "BILLING.SUBSCRIPTION.ACTIVATED") {
      const userId = event.resource.custom_id;
      const expires = Math.floor(Date.now() / 1000) + 2592000;

      await pool.query(
        "INSERT INTO users (user_id, has_access, expires_at) VALUES ($1, true, $2) ON CONFLICT (user_id) DO UPDATE SET has_access = true, expires_at = $2",
        [userId, expires]
      );

      console.log("✅ User activated:", userId);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ PayPal webhook error:", err);
    res.sendStatus(500);
  }
});

// ================= TELEGRAM WEBHOOK =================
await bot.init();

app.use(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body)
    .then(() => res.sendStatus(200))
    .catch((err) => {
      console.error("Telegram webhook error:", err);
      res.sendStatus(500);
    });
});

// ================= AUTO KICK =================
async function kickExpiredUsers() {
  try {
    const now = Math.floor(Date.now() / 1000);

    const result = await pool.query(
      "SELECT user_id FROM users WHERE has_access = true AND expires_at < $1",
      [now]
    );

    for (const row of result.rows) {
      const userId = row.user_id;

      try {
        await bot.api.banChatMember(CHANNEL_ID, userId);
        await bot.api.unbanChatMember(CHANNEL_ID, userId);

        console.log(`❌ Kicked: ${userId}`);

        await pool.query(
          "UPDATE users SET has_access = false WHERE user_id = $1",
          [userId]
        );

      } catch (err) {
        console.error(`Kick failed ${userId}:`, err.message);
      }
    }

  } catch (err) {
    console.error("Auto-kick error:", err);
  }
}

setInterval(kickExpiredUsers, 5 * 60 * 1000);

// ================= SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const webhookUrl = `${process.env.RAILWAY_STATIC_URL}/bot${process.env.BOT_TOKEN}`;

  await bot.api.setWebhook(webhookUrl);

  console.log("✅ Webhook set:", webhookUrl);
});
