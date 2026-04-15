const TelegramBot = require('node-telegram-bot-api');

console.log("🚀 STARTING BOT...");

const token = process.env.BOT_TOKEN;

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

// Create bot
const bot = new TelegramBot(token, { polling: true });

console.log("✅ BOT STARTED");

// ===== CONFIG =====
const ADMIN_ID = 145044793;
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

// Store approved users (temporary memory)
const usersPaid = new Set();

// ===== BOT LOGIC =====
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // ===== USER COMMANDS =====

    if (text === '/start') {
        return bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    if (text === '/buy') {
        return bot.sendMessage(chatId, `Pay here:\n${PAYPAL_LINK}`);
    }

    if (text === '/id') {
        return bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
    }

    if (text === '/access') {
        if (!usersPaid.has(msg.from.id)) {
            return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
        }

        return bot.sendMessage(chatId, "🔥 Here is your private content");
    }

    // ===== ADMIN ONLY =====
    if (msg.from.id != ADMIN_ID) return;

    if (text === '/test') {
        return bot.sendMessage(chatId, "Admin command works ✅");
    }

    if (text.startsWith('/approve')) {
        const userId = Number(text.split(' ')[1]);

        if (!userId) {
            return bot.sendMessage(chatId, "❌ Invalid ID");
        }

        usersPaid.add(userId);
        return bot.sendMessage(chatId, `✅ User ${userId} approved`);
    }
});
