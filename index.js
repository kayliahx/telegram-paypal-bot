import express from "express";
import { Bot } from "grammy";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ENV
const bot = new Bot(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CHANNEL_ID = process.env.CHANNEL_ID;

// =========================
// START COMMAND (FIXED)
// =========================
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;

  await pool.query(
    "INSERT INTO users (user_id, has_access, expires_at) VALUES ($1, false, 0) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );

  await ctx.reply(
    "Welcome 🚀\n\nUse /buy to subscribe or check your status below:"
  );

  await ctx.reply("💰 Click below to subscribe:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "💰 Buy Access",
            url: `${process.env.PAYPAL_LINK}?custom_id=${userId}`,
          },
        ],
      ],
    },
  });
});

// =========================
// BUY COMMAND
// =========================
bot.command("buy", async (ctx) => {
  const userId = ctx.from.id;

  await ctx.reply("💰 Click below to subscribe:", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "💰 Buy Access",
            url: `${process.env.PAYPAL_LINK}?custom_id=${userId}`,
          },
        ],
      ],
    },
  });
});

// =========================
// ACCESS COMMAND
// =========================
bot.command("access", async (ctx) => {
  const userId = ctx.from.id;

  const result = await pool.query(
    "SELECT has_access, expires_at FROM users WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].has_access) {
    return ctx.reply("❌ Access expired or not active.");
  }

  const expiresAt = parseInt(result.rows[0].expires_at);

  if (Date.now() > expiresAt) {
    await pool.query(
      "UPDATE users SET has_access = false WHERE user_id = $1",
      [userId]
    );

    try {
      await bot.api.banChatMember(CHANNEL_ID, userId);
      await bot.api.unbanChatMember(CHANNEL_ID, userId);
    } catch {}

    return ctx.reply("❌ Access expired or not active.");
  }

  ctx.reply("✅ Your access is active.");
});

// =========================
// PAYPAL WEBHOOK
// =========================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body;

    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      const userId = event.resource.custom_id;

      const duration = 30 * 24 * 60 * 60 * 1000; // 30 days
      const expiresAt = Date.now() + duration;

      await pool.query(
        "UPDATE users SET has_access = true, expires_at = $1 WHERE user_id = $2",
        [expiresAt, userId]
      );

      await bot.api.unbanChatMember(CHANNEL_ID, userId);

      console.log("User activated:", userId);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// =========================
// AUTO EXPIRATION SYSTEM
// =========================
setInterval(async () => {
  try {
    const result = await pool.query(
      "SELECT user_id FROM users WHERE has_access = true AND expires_at < $1",
      [Date.now()]
    );

    for (const row of result.rows) {
      const userId = row.user_id;

      try {
        await bot.api.banChatMember(CHANNEL_ID, userId);
        await bot.api.unbanChatMember(CHANNEL_ID, userId);
      } catch {}

      await pool.query(
        "UPDATE users SET has_access = false WHERE user_id = $1",
        [userId]
      );

      console.log("Expired user removed:", userId);
    }
  } catch (err) {
    console.error("Expiration error:", err);
  }
}, 60 * 60 * 1000); // every hour

// =========================
// WEBHOOK ROUTE
// =========================
app.post(`/bot${process.env.BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook error:", err);
    res.sendStatus(500);
  }
});

// =========================
// ROOT FIX (NO MORE "Cannot GET /")
// =========================
app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

// =========================
// START SERVER + FIXED HTTPS WEBHOOK
// =========================
const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  await bot.init();

  const webhookUrl = `https://${process.env.RAILWAY_STATIC_URL.replace(/^https?:\\/\\//, "")}/bot${process.env.BOT_TOKEN}`;

  await bot.api.setWebhook(webhookUrl);

  console.log("✅ Telegram webhook set:", webhookUrl);
});
