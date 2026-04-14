const TelegramBot = require('node-telegram-bot-api');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

console.log("Bot started...");

bot.on('message', (msg) => {
  console.log("Message received:", msg.text);
  bot.sendMessage(msg.chat.id, "✅ Bot is working!");
});
