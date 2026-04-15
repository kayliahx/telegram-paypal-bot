const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CHANNEL_ID = process.env.CHANNEL_ID; // "-100xxxxxxxxxx"
const PAYPAL_LINK = process.env.PAYPAL_LINK;

const bot = new TelegramBot(TOKEN);
const app = express();

app.use(express.json());

// 🔥 Webhook setup
const WEBHOOK_URL = process.env.RAILWAY_STATIC_URL;

if (WEBHOOK_URL) {
  bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
  console.log("✅ WEBHOOK SET");
}

// 📩 Telegram webhook endpoint
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// 🚀 Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// 💾 Temporary storage (later we can replace with database)
const usersPaid = new Set();

// 📩 Message handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // 👋 Start
  if (text === '/start') {
    return bot.sendMessage(chatId, "👋 Welcome!\nUse /buy to get access.");
  }

  // 💳 Buy button
  if (text === '/buy') {
    return bot.sendMessage(chatId, "💳 Click below to purchase:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💰 Pay now", url: PAYPAL_LINK }]
        ]
      }
    });
  }

  // 🆔 Get user ID
  if (text === '/id') {
    return bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
  }

  // 🔓 Access (SECURE LINK)
  if (text === '/access') {
    if (!usersPaid.has(msg.from.id)) {
      return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
    }

    try {
      const invite = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1
      });

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

  // 🔐 ADMIN ONLY
  if (msg.from.id !== ADMIN_ID) return;

  // 🧪 Test command
  if (text === '/test') {
    return bot.sendMessage(chatId, "Admin command works ✅");
  }

  // ✅ Approve user
  if (text.startsWith('/approve')) {
    const userId = Number(text.split(' ')[1]);

    if (!userId) {
      return bot.sendMessage(chatId, "❌ Invalid ID");
    }

    usersPaid.add(userId);

    return bot.sendMessage(chatId, `👑 Admin approved user ${userId}`);
  }
});
