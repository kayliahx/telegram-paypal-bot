import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(express.json());

// ==============================
// ENV VARIABLES
// ==============================
const TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;
const ADMIN_ID = process.env.ADMIN_ID;

// 🔥 YOUR PAYPAL LINK
const PAYMENT_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

// 🔥 YOUR PRIVATE CHANNEL LINK (PUT YOUR REAL ONE)
const CHANNEL_LINK = "https://t.me/+YOUR_PRIVATE_LINK";

// ==============================
// SAFETY CHECK
// ==============================
if (!TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

console.log("✅ BOT TOKEN LOADED");

// ==============================
// TELEGRAM BOT INIT
// ==============================
const bot = new TelegramBot(TOKEN, { polling: false });

// ==============================
// DEBUG LOGS
// ==============================
app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, req.url);
  next();
});

// ==============================
// TELEGRAM WEBHOOK
// ==============================
app.post(`/telegram-webhook/${TOKEN}`, (req, res) => {
  console.log("📩 Update received:", JSON.stringify(req.body));

  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Telegram webhook error:", err);
    res.sendStatus(200);
  }
});

// ==============================
// PAYPAL WEBHOOK (FINAL FIX)
// ==============================
app.post("/paypal-webhook", (req, res) => {
  console.log("💰 FULL PAYPAL EVENT:", JSON.stringify(req.body, null, 2));

  const event = req.body;

  try {
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const email = event.resource?.payer?.email_address;

      console.log("✅ PAYMENT DETECTED:", email);

      // Notify admin
      if (ADMIN_ID) {
        bot.sendMessage(
          ADMIN_ID,
          `💰 Payment confirmed\nEmail: ${email || "unknown"}`
        );
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ PayPal webhook error:", err);
    res.sendStatus(200);
  }
});

// ==============================
// START SERVER
// ==============================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const webhookUrl = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${TOKEN}`;

  try {
    await bot.setWebHook(webhookUrl);
    console.log("✅ Telegram webhook set:", webhookUrl);
  } catch (err) {
    console.error("❌ Webhook setup error:", err);
  }
});

// ==============================
// COMMANDS
// ==============================

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Welcome 👋 Choose an option:",
    {
      reply_markup: {
        keyboard: [
          ["💰 Buy Access"],
          ["ℹ️ Help"]
        ],
        resize_keyboard: true
      }
    }
  );
});

// HELP
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, "Use /buy to purchase access.");
});

// BUY
bot.onText(/\/buy/, (msg) => {
  sendPayment(msg);
});

// BUTTON HANDLER
bot.on("message", (msg) => {
  const text = msg.text;

  if (text === "💰 Buy Access") {
    sendPayment(msg);
  }

  if (text === "ℹ️ Help") {
    bot.sendMessage(msg.chat.id, "Use /buy to purchase access.");
  }
});

// ==============================
// PAYMENT FUNCTION
// ==============================
function sendPayment(msg) {
  bot.sendMessage(
    msg.chat.id,
    "Click below to pay:",
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💳 Pay Now",
              url: PAYMENT_LINK
            }
          ]
        ]
      }
    }
  );

  // Notify admin that user clicked buy
  if (ADMIN_ID) {
    bot.sendMessage(
      ADMIN_ID,
      `🛒 User clicked BUY\nUser ID: ${msg.from.id}\nUsername: @${msg.from.username || "N/A"}`
    );
  }
}
