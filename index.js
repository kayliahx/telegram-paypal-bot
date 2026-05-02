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

// ================= STATUS FUNCTION =================
async function sendStatus(ctx) {
  const userId = ctx.from.id;

  const result = await pool.query(
    "SELECT has_access, expires_at FROM users WHERE user_id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    return ctx.reply("❌ No subscription found.");
  }

  const { has_access, expires_at } = result.rows[0];
  const now = Math.floor(Date.now() / 1000);

  if (!has_access || expires_at < now) {
    return ctx.reply("❌ Your access is not active.\n\nUse /buy to subscribe.");
  }

  const remaining = expires_at - now;
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);

  await ctx.reply(`✅ Subscription Active\n\n⏳ ${days} days ${hours} hours remaining`);
}

// ================= START =================
bot.command("start", async (ctx) => {
  const userId = ctx.from.id;

  await pool.query(
    "INSERT INTO users (user_id, has_access, expires_at) VALUES ($1, false, 0) ON CONFLICT (user_id) DO NOTHING",
    [userId]
  );

  await ctx.reply("Welcome 🚀\n\nUse /buy to subscribe or check your status below:");
  await sendStatus(ctx);
});

// ================= ACCESS / STATUS =================
bot.command("access", sendStatus);
bot.command("status", sendStatus);

// ================= BUY =================
bot.command("buy", async (ctx) => {
  const userId = ctx.from.id;
  const link = `${process.env.PAYPAL_LINK}?custom_id=${userId}`;

  await ctx.reply("💰 Subscribe below:", {
    reply_markup: {
      inline_keyboard: [[{ text: "💰 Buy Access", url: link }]],
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

      // Send invite link automatically
      try {
        const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
          member_limit: 1,
        });

        await bot.api.sendMessage(
          userId,
          `🎉 Payment successful!\n\nJoin your private channel:\n${invite.invite_link}`
        );
      } catch (err) {
        console.error("Invite link error:", err.message);
      }
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
  bot.handleUpdate(req.body, res);
});

// ================= AUTO KICK EXPIRED USERS =================
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

        console.log(`❌ Kicked expired user: ${userId}`);

        await pool.query(
          "UPDATE users SET has_access = false WHERE user_id = $1",
          [userId]
        );

      } catch (err) {
        console.error(`Kick failed for ${userId}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Auto-kick error:", err);
  }
}

setInterval(kickExpiredUsers, 5 * 60 * 1000);

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const webhookUrl = `${process.env.RAILWAY_STATIC_URL}/bot${process.env.BOT_TOKEN}`;

  await bot.api.setWebhook(webhookUrl);

  console.log("✅ Telegram webhook set:", webhookUrl);
});
