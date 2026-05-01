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
const PAYMENT_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

// Safety check
if (!TOKEN) {
  console.error("❌ BOT_TOKEN is missing!");
  process.exit(1);
}

console.log("✅ BOT TOKEN LOADED");

// ==============================
// TELEGRAM BOT INIT
// ==============================
const bot = new TelegramBot(TOKEN, { polling: false });

// ==============================
// DEBUG: LOG ALL REQUESTS
// ==============================
app.use((req, res, next) => {
  console.log("➡️ Incoming:", req.method, req.url);
  next();
});

// ==============================
// WEBHOOK ROUTE (FIXED)
// ==============================
app.post(`/telegram-webhook/${TOKEN}`, (req, res) => {
  console.log("📩 Update received:", JSON.stringify(req.body));

  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.sendStatus(200);
  }
});

// ==============================
// HEALTH CHECK
// ==============================
app.get("/", (req, res) => {
  res.send("Bot is alive 🚀");
});

// ==============================
// START SERVER + SET WEBHOOK
// ==============================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const webhookUrl = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${TOKEN}`;

  try {
    await bot.setWebHook(webhookUrl);
    console.log("✅ Webhook set:", webhookUrl);
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
  bot.sendMessage(
    msg.chat.id,
    "Use /buy to purchase access."
  );
});

// BUY COMMAND
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

  // Notify admin
  if (ADMIN_ID) {
    bot.sendMessage(
      ADMIN_ID,
      `💰 User clicked BUY\n\nUser ID: ${msg.from.id}\nUsername: @${msg.from.username || "N/A"}`
    );
  }
}
