const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const app = express();
app.use(express.json());

// ENV VARIABLES
const token = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PAYPAL_LINK = process.env.PAYPAL_LINK;

const bot = new TelegramBot(token);

// ===== STORAGE =====
const users = new Map();

// ===== TELEGRAM WEBHOOK =====
bot.setWebHook(`${WEBHOOK_URL}/bot${token}`);

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== PAYPAL WEBHOOK =====
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body;

  console.log("💰 PayPal event:", event.event_type);

  try {
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {

      const userId = Number(event.resource.custom_id);

      if (!userId) {
        console.log("❌ No userId in payment");
        return res.sendStatus(200);
      }

      // prevent double approval
      if (users.has(userId) && Date.now() < users.get(userId)) {
        console.log("⚠️ Already active:", userId);
        return res.sendStatus(200);
      }

      const duration = 5 * 60 * 1000;
      const expiry = Date.now() + duration;

      users.set(userId, expiry);

      console.log("✅ AUTO APPROVED:", userId);

      bot.sendMessage(userId, "✅ Payment received! Use /access");

    }

    res.sendStatus(200);
  } catch (err) {
    console.log("❌ PayPal webhook error:", err.message);
    res.sendStatus(500);
  }
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

// BUY (WITH TRACKING)
bot.onText(/\/buy/, (msg) => {
  const userId = msg.from.id;

  const link = `${PAYPAL_LINK}?custom_id=${userId}`;

  bot.sendMessage(
    msg.chat.id,
    `💳 Complete your payment:\n${link}`
  );
});

// ===== APPROVE (ADMIN ONLY) =====
bot.onText(/\/approve (\d+)/, (msg, match) => {
  const adminId = msg.from.id;

  if (adminId !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "❌ You are not admin.");
  }

  const userId = Number(match[1]);

  // prevent double approval
  if (users.has(userId) && Date.now() < users.get(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "⚠️ User already has active access."
    );
  }

  const duration = 5 * 60 * 1000;
  const expiry = Date.now() + duration;

  users.set(userId, expiry);

  console.log(`✅ Approved: ${userId}`);

  bot.sendMessage(
    msg.chat.id,
    `👑 User ${userId} approved for 5 minutes`
  );
});

// ===== ACCESS =====
bot.onText(/\/access/, async (msg) => {
  const userId = msg.from.id;

  console.log("📩 Access request:", userId);

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

    console.log("🔗 Invite:", invite.invite_link);

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
    console.log("❌ Invite error:", err.message);
  }
});

// ===== AUTO REMOVE =====
setInterval(async () => {
  const now = Date.now();

  console.log("🧠 Checking users...");

  for (const [userId, expiry] of users.entries()) {

    if (now > expiry) {
      console.log("⏰ Expired:", userId);

      try {
        await bot.banChatMember(CHANNEL_ID, userId);
        await bot.unbanChatMember(CHANNEL_ID, userId);
      } catch (err) {
        console.log("⚠️ Kick error:", err.message);
      }

      users.delete(userId);
    }
  }
}, 30000);

// ===== SERVER =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
