import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ✅ Webhook route
app.post(`/telegram-webhook/${BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error);
    res.sendStatus(200); // still respond to Telegram
  }
});

// ✅ Basic test route
app.get("/", (req, res) => {
  res.send("Bot is alive");
});

// ✅ Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);

  const WEBHOOK_URL = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${BOT_TOKEN}`;

  try {
    await bot.setWebHook(WEBHOOK_URL);
    console.log("Webhook set:", WEBHOOK_URL);
  } catch (err) {
    console.error("Webhook setup error:", err);
  }
});

// ✅ Test command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Bot is working 🚀");
});
