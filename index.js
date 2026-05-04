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

const CHANNEL_ID = process.env.CHANNEL_ID;

// =========================
// ⏳ TIME CONFIG (EDIT HERE)
// =========================
const EXPIRY = {
  minutes: 5,
  hours: 0,
  days: 0,
  months: 0,
};

const EXPIRY_MS =
  EXPIRY.minutes * 60 * 1000 +
  EXPIRY.hours * 60 * 60 * 1000 +
  EXPIRY.days * 24 * 60 * 60 * 1000 +
  EXPIRY.months * 30 * 24 * 60 * 60 * 1000;

// =========================
// DEBUG LOGS
// =========================
bot.use((ctx, next) => {
  console.log("📩 UPDATE:", JSON.stringify(ctx.update));
  return next();
});

// =========================
// START
// =========================
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;

  await pool.query(
    "INSERT INTO users (user_id, has_access, expires_at) VALUES ($1, false, 0) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );

  await ctx.reply("Welcome 🚀\n\nUse /buy to subscribe.");
});

// =========================
// BUY
// =========================
bot.command("buy", async (ctx) => {
  try {
    console.log("👉 /buy triggered:", ctx.from);

    const userId = ctx.from.id;
    const name = ctx.from.first_name || "NoName";
    const username = ctx.from.username || "N/A";

    const paypalLink = `${process.env.PAYPAL_LINK}?custom_id=${userId}`;

    await ctx.reply("💰 Click below to subscribe:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💰 Buy Access", url: paypalLink }],
        ],
      },
    });

    await bot.api.sendMessage(
      process.env.ADMIN_ID,
      `🛒 BUY CLICK\nUser: ${userId}\nName: ${name}\nUsername: @${username}`
    );

    console.log("✅ Admin notified");

  } catch (err) {
    console.error("❌ BUY ERROR:", err);
  }
});

// =========================
// ACCESS
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

  if (Date.now() > result.rows[0].expires_at) {
    return ctx.reply("❌ Access expired.");
  }

  ctx.reply("✅ Access active.");
});

// =========================
// PAYPAL WEBHOOK
// =========================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const body = req.body;

    console.log("📩 PayPal event:", body.event_type);

    if (body.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const userId = body.resource.custom_id;

      if (!userId) {
        console.log("❌ No custom_id found");
        return res.sendStatus(200);
      }

      console.log("💰 Payment for user:", userId);

      const expiresAt = Date.now() + EXPIRY_MS;

      await pool.query(
        "UPDATE users SET has_access = true, expires_at = $1 WHERE user_id = $2",
        [expiresAt, userId]
      );

      // 🔗 invite link
      const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
      });

      await bot.api.sendMessage(
        userId,
        `✅ Payment confirmed!\n\nJoin here:\n${invite.invite_link}`
      );

      // ⏳ AUTO KICK AFTER EXPIRY
      setTimeout(async () => {
        try {
          console.log("⏰ Expiring:", userId);

          await bot.api.banChatMember(CHANNEL_ID, userId);
          await bot.api.unbanChatMember(CHANNEL_ID, userId);

          await pool.query(
            "UPDATE users SET has_access = false WHERE user_id = $1",
            [userId]
          );

          await bot.api.sendMessage(
            process.env.ADMIN_ID,
            `⛔ User expired: ${userId}`
          );

        } catch (err) {
          console.error("❌ Expiry error:", err);
        }
      }, EXPIRY_MS);
    }

    res.sendStatus(200);

  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.sendStatus(500);
  }
});

// =========================
// TELEGRAM WEBHOOK
// =========================
app.post(`/bot${process.env.BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("Telegram error:", err);
    res.sendStatus(500);
  }
});

// =========================
// ROOT
// =========================
app.get("/", (req, res) => {
  res.send("Bot running 🚀");
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on ${PORT}`);

  await bot.init();

  const baseUrl = process.env.RAILWAY_STATIC_URL.replace("https://", "");
  const webhookUrl = `https://${baseUrl}/bot${process.env.BOT_TOKEN}`;

  await bot.api.setWebhook(webhookUrl);

  console.log("✅ Webhook set:", webhookUrl);
});
