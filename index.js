import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;

// ⚠️ Replace this with YOUR REAL PayPal checkout link (not paypal.me)
const PAYMENT_LINK ="https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

/* =========================
   WEBHOOK
========================= */
app.post(`/telegram-webhook/${BOT_TOKEN}`, (req, res) => {
  try {
    console.log("📩 Update received:", JSON.stringify(req.body));

    bot.processUpdate(req.body);

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.sendStatus(200);
  }
});

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

/* =========================
   START COMMAND
========================= */
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, "Welcome 👋 Choose an option:", {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Buy Access" }],
        [{ text: "ℹ️ Help" }]
      ],
      resize_keyboard: true
    }
  });
});

/* =========================
   BUY COMMAND (TEXT)
========================= */
bot.onText(/\/buy/, (msg) => {
  const chatId = msg.chat.id;

  console.log("💸 /buy triggered by:", chatId);

  bot.sendMessage(chatId, "Click below to pay:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 Pay Now", url: PAYMENT_LINK }]
      ]
    }
  });
});

/* =========================
   BUTTON HANDLER
========================= */
bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "💰 Buy Access") {
    console.log("💸 Button BUY clicked:", chatId);

    bot.sendMessage(chatId, "Click below to pay:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Pay Now", url: PAYMENT_LINK }]
        ]
      }
    });
  }

  if (text === "ℹ️ Help") {
    bot.sendMessage(chatId, "Use /buy to purchase access.");
  }
});

/* =========================
   START SERVER + SET WEBHOOK
========================= */
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN is missing!");
    return;
  }

  const WEBHOOK_URL = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${BOT_TOKEN}`;

  try {
    const res = await bot.setWebHook(WEBHOOK_URL);
    console.log("✅ Webhook set:", res);
    console.log("🔗 URL:", WEBHOOK_URL);
  } catch (err) {
    console.error("❌ Webhook setup error:", err.response?.body || err.message);
  }
});
