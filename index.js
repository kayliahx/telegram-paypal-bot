const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const app = express();
app.use(express.json());

// ENV VARIABLES
const token = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const bot = new TelegramBot(token);

// ===== STORAGE =====
const users = new Map();

// ===== WEBHOOK =====
bot.setWebHook(`${WEBHOOK_URL}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== BASIC COMMANDS =====

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome!\n\nUse /buy to get access.\nThen /access to enter the private channel."
  );
});

// ID
bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 Your ID: ${msg.from.id}`);
});

// BUY
bot.onText(/\/buy/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    `💳 Purchase access here:\n${process.env.PAYPAL_LINK || "YOUR_PAYPAL_LINK"}`
  );
});

// ===== APPROVE (UPDATED) =====
bot.onText(/\/approve (\d+)/, (msg, match) => {
  const adminId = msg.from.id;

  if (adminId !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ You are not admin.");
  }

  const userId = Number(match[1]);

  // 🚫 PREVENT DOUBLE APPROVAL
  if (users.has(userId) && Date.now() < users.get(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ User already has active access."
    );
  }

  const duration = 5 * 60 * 1000; // 5 minutes
  const expiry = Date.now() + duration;

  users.set(userId, expiry);

  console.log(`✅ Approved: ${userId} until ${new Date(expiry).toISOString()}`);

  bot.sendMessage(
    msg.chat.id,
    `👑 User ${userId} approved for 5 minutes`
  );
});

// ===== ACCESS =====
bot.onText(/\/access/, async (msg) => {
  const userId = msg.from.id;

  console.log("📩 Access request from:", userId);
  console.log("📦 Stored users:", users);

  if (!users.has(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ You must purchase first.\nUse /buy"
    );
  }

  const expiry = users.get(userId);

  if (Date.now() > expiry) {
    users.delete(userId);
    return bot.sendMessage(msg.chat.id, "⏳ Your access expired.");
  }

  try {
    const invite = await bot.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 300,
    });

    console.log("🔗 Invite created:", invite.invite_link);

    bot.sendMessage(
      msg.chat.id,
      "🔥 Click below to join your private channel:",
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Join Channel", url: invite.invite_link }],
          ],
        },
      }
    );
  } catch (err) {
    console.error("❌ Invite error:", err);
    bot.sendMessage(msg.chat.id, "❌ Error generating link.");
  }
});

// ===== AUTO REMOVE SYSTEM =====
setInterval(async () => {
  const now = Date.now();

  console.log("🧠 Checking users...", new Date().toISOString());

  for (const [userId, expiry] of users.entries()) {
    console.log("👀 Checking:", userId);
    console.log("🕒 NOW:", now);
    console.log("⏳ EXPIRES:", expiry);
    console.log("📉 DIFF:", expiry - now);

    if (now > expiry) {
      console.log("⏰ Expired:", userId);

      try {
        await bot.banChatMember(CHANNEL_ID, userId);
        console.log("🚫 Banned:", userId);

        await bot.unbanChatMember(CHANNEL_ID, userId);
        console.log("♻️ Unbanned:", userId);
      } catch (err) {
        console.log("⚠️ Kick error:", err.message);
      }

      users.delete(userId);
      console.log("❌ Removed from system:", userId);
    }
  }
}, 30000);

// ===== SERVER =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
