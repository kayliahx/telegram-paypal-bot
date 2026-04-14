const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("Bot started");

// WHEN USER TYPES /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const paypalLink = "https://www.paypal.com/webapps/billing/subscriptions?plan_id=P-7XX3454641010963FNHOTJAA";

  bot.sendMessage(chatId, `Subscribe here:\n${paypalLink}`);
});
