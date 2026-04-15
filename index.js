console.log("🚀 STARTING BOT...");

const TelegramBot = require('node-telegram-bot-api'); // ✅ FIRST

const token = process.env.BOT_TOKEN;

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true }); // ✅ ONLY ONE

console.log("✅ BOT STARTED");

const ADMIN_ID = 145044793; // replace with your ID
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU"; // your link

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // User commands
    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    if (text === '/buy') {
        bot.sendMessage(chatId, `Pay here:\n${PAYPAL_LINK}`);
    }

    // Admin commands (ONLY YOU)
    if (msg.from.id != ADMIN_ID) return;

    if (text === '/test') {
        bot.sendMessage(chatId, "Admin command works ✅");
    }
});
