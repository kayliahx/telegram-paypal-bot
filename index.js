const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

console.log("🚀 STARTING BOT...");

// ENV VARIABLES
const token = process.env.BOT_TOKEN;
const ADMIN_ID = 8283814198; // 🔥 REPLACE WITH YOUR ID
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU"; // 🔥 YOUR LINK

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

// STORAGE (temporary)
const usersPaid = new Set();

// EXPRESS SERVER (Railway requirement)
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('Bot is running ✅');
});

app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// TELEGRAM BOT (polling)
const bot = new TelegramBot(token, { polling: true });

console.log("✅ BOT STARTED");

// BOT LOGIC
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // START
    if (text === '/start') {
        return bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    // BUY
    if (text === '/buy') {
        return bot.sendMessage(chatId, `💳 Pay here:\n${PAYPAL_LINK}`);
    }

    // GET USER ID
    if (text === '/id') {
        return bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
    }

    // ACCESS CONTROL
    if (text === '/access') {
        if (!usersPaid.has(Number(msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
        }

        return bot.sendMessage(chatId, "🔥 Here is your private content");
    }

    // ADMIN ONLY BELOW
    if (msg.from.id != ADMIN_ID) return;

    // TEST ADMIN
    if (text === '/test') {
        return bot.sendMessage(chatId, "Admin command works ✅");
    }

    // APPROVE USER
    if (text.startsWith('/approve')) {

        const parts = text.split(' ');

        if (parts.length < 2) {
            return bot.sendMessage(chatId, "❌ Usage: /approve USER_ID");
        }

        const userId = parseInt(parts[1]);

        if (isNaN(userId)) {
            return bot.sendMessage(chatId, "❌ Invalid ID");
        }

        usersPaid.add(userId);

        return bot.sendMessage(chatId, `👑 Admin approved user ${userId}`);
    }
});
