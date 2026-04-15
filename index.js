const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CHANNEL_ID = Number(process.env.CHANNEL_ID);
const PAYPAL_LINK = process.env.PAYPAL_LINK;

const bot = new TelegramBot(TOKEN);
const app = express();

app.use(express.json());

// ===== WEBHOOK =====
const WEBHOOK_URL = process.env.RAILWAY_STATIC_URL;

if (WEBHOOK_URL) {
  bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
  console.log("✅ WEBHOOK SET");
}

// ===== TELEGRAM ENDPOINT =====
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ===== SERVER =====
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ===== STORAGE =====
const usersPaid = new Map();

// ===== BOT =====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;

  // ===== START =====
  if (text === '/start') {
    return bot.sendMessage(chatId, "👋 Welcome!\nUse /buy to get access.");
  }

  // ===== BUY =====
  if (text === '/buy') {
    return bot.sendMessage(chatId, "💳 Click below to purchase:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💰 Pay now", url: PAYPAL_LINK }]
        ]
      }
    });
  }

  // ===== ID =====
  if (text === '/id') {
    return bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
  }

  // ===== ACCESS =====
  if (text === '/access') {
    const expiresAt = usersPaid.get(msg.from.id);

    if (!expiresAt) {
      return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
    }

    if (Date.now() > expiresAt) {
      usersPaid.delete(msg.from.id);
      return bot.sendMessage(chatId, "⏳ Your access has expired.");
    }

    try {
      const invite = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1
      });

      // 🔥 DEBUG LINE
      console.log("Invite link created:", invite.invite_link);

      return bot.sendMessage(chatId, "🔥 Click below to join your private channel:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🚀 Join Channel", url: invite.invite_link }]
          ]
        }
      });

    } catch (err) {
      console.log(err);
      return bot.sendMessage(chatId, "❌ Error generating access link");
    }
  }

  // ===== ADMIN ONLY =====
  if (msg.from.id !== ADMIN_ID) {
    console.log("❌ Not admin:", msg.from.id);
    return;
  }

  // ===== TEST =====
  if (text === '/test') {
    return bot.sendMessage(chatId, "Admin command works ✅");
  }

  // ===== APPROVE (5 MIN TEST) =====
  if (text.startsWith('/approve')) {
    const userId = Number(text.split(' ')[1]);

    if (!userId) {
      return bot.sendMessage(chatId, "❌ Invalid ID");
    }

    const expiresAt = Date.now() + 5 * 60 * 1000;

    usersPaid.set(userId, expiresAt);

    return bot.sendMessage(chatId, `👑 User ${userId} approved for 5 minutes`);
  }
});

// ===== AUTO REMOVE =====
setInterval(async () => {
  const now = Date.now();

  for (const [userId, expiresAt] of usersPaid.entries()) {

    if (userId === ADMIN_ID) continue;

    if (now > expiresAt) {
      try {
        await bot.banChatMember(CHANNEL_ID, userId);
        await bot.unbanChatMember(CHANNEL_ID, userId);

        usersPaid.delete(userId);

        console.log(`❌ Removed expired user ${userId}`);
      } catch (err) {
        console.log(`Error removing user ${userId}`, err.message);
      }
    }
  }
}, 60 * 1000);
