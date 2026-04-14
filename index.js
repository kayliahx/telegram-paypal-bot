const TelegramBot = require('node-telegram-bot-api');

console.log("🚀 STARTING BOT...");

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

console.log("🚀 Bot is launching...");

const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  console.log("📩 Received:", msg.text);
  bot.sendMessage(msg.chat.id, "🔥 Bot is working!");
});
