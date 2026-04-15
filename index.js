const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

console.log("🚀 STARTING BOT...");

const token = process.env.BOT_TOKEN;

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

// ✅ ADD YOUR ADMIN ID HERE
const ADMIN_ID = 8283814198;

// ✅ ADD YOUR PAYPAL LINK HERE
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

// ✅ YOUR RAILWAY URL
const url = "https://perceptive-empathy-production-18c6.up.railway.app";

const bot = new TelegramBot(token);
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 8080;

// Set webhook
bot.setWebHook(`${url}/bot${token}`);
console.log("✅ WEBHOOK SET");

// Telegram endpoint
app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Start server
app.listen(PORT, () => {
    console.log(`🌐 Server running on port ${PORT}`);
});

// ===== BOT LOGIC =====

const usersPaid = new Set();

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    console.log("User ID:",145044793);
    console.log("ADMIN_ID:",8283814198);

    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    if (text === '/buy') {
        bot.sendMessage(chatId, "Unlock access 💎", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💳 Pay now", url: PAYPAL_LINK }]
                ]
            }
        });
    }

    if (text === '/id') {
        bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
    }

    if (text === '/access') {
        if (!usersPaid.has(msg.from.id)) {
            return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
        }
        bot.sendMessage(chatId, "🔥 Here is your private content");
    }

    // ADMIN ONLY
    if (msg.from.id != ADMIN_ID) return;

    if (text === '/test') {
        bot.sendMessage(chatId, "Admin command works ✅");
    }

    if (text.startsWith('/approve')) {
        const userId = text.split(' ')[1];
        usersPaid.add(Number(userId));
        bot.sendMessage(chatId, `✅ User ${userId} approved`);
    }
});
