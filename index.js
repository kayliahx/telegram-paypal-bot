import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(express.json());

/* =========================
   ENV VARIABLES
========================= */
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;
const ADMIN_ID = process.env.ADMIN_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("❌ CHANNEL_ID missing");
  process.exit(1);
}

console.log("✅ ENV loaded");

/* =========================
   BOT INIT
========================= */
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

/* =========================
   PENDING USERS (queue)
========================= */
let pendingUsers = [];

/* =========================
   TELEGRAM WEBHOOK
========================= */
app.post(`/telegram-webhook/${BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Telegram error:", err);
    res.sendStatus(200);
  }
});

/* =========================
   PAYPAL WEBHOOK
========================= */
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body;

  console.log("💰 PAYPAL EVENT:", JSON.stringify(event, null, 2));

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {

    // Take the oldest pending user
    const user = pendingUsers.shift();

    if (!user) {
      console.log("❌ No pending user");
      return res.sendStatus(200);
    }

    const telegramId = user.chatId;
    console.log("✅ MATCHED USER:", telegramId);

    try {
      // 🎯 ONE-TIME INVITE (1 min expiry)
      const invite = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 60
      });

      // Send access
      await bot.sendMessage(
        telegramId,
        "✅ Payment received! Join quickly (1 min access):",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔓 Join Channel", url: invite.invite_link }]
            ]
          }
        }
      );

      // 🔥 AUTO KICK AFTER 1 MINUTE
      setTimeout(async () => {
        try {
          await bot.banChatMember(CHANNEL_ID, telegramId);
          await bot.unbanChatMember(CHANNEL_ID, telegramId);

          await bot.sendMessage(
            telegramId,
            "⛔ Test access expired (1 min)."
          );

          console.log("🚫 Removed:", telegramId);
        } catch (err) {
          console.error("❌ Kick error:", err);
        }
      }, 1 * 60 * 1000);

      // Admin log
      if (ADMIN_ID) {
        bot.sendMessage(
          ADMIN_ID,
          `💰 Payment OK\nUser: ${telegramId}`
        );
      }

    } catch (err) {
      console.error("❌ Invite error:", err);
    }
  }

  res.sendStatus(200);
});

/* =========================
   COMMANDS
========================= */

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome 👋", {
    reply_markup: {
      keyboard: [["💰 Buy Access"]],
      resize_keyboard: true
    }
  });
});

// BUY
bot.onText(/Buy Access|\/buy/, (msg) => {
  const chatId = msg.chat.id;

  // Store user before payment
  pendingUsers.push({
    chatId,
    time: Date.now()
  });

  bot.sendMessage(chatId, "Click below to pay:", {
    reply_markup: {
      inline_keyboard: [
        [{
          text: "💳 Pay Now",
          url: "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU"
        }]
      ]
    }
  });

  if (ADMIN_ID) {
    bot.sendMessage(
      ADMIN_ID,
      `🛒 BUY CLICK\nUser: ${chatId}`
    );
  }
});

/* =========================
   SERVER
========================= */
app.listen(PORT, async () => {
  console.log("🚀 Running on port", PORT);

  const WEBHOOK_URL = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${BOT_TOKEN}`;

  try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("✅ Telegram webhook set");
  } catch (err) {
    console.error("❌ Webhook error:", err);
  }
});
