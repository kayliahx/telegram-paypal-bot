const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("✅ Bot started");

bot.on('message', (msg) => {
  console.log("📩 Received:", msg.text);
  bot.sendMessage(msg.chat.id, "🔥 Bot is working!");
});
