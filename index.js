const TelegramBot = require('node-telegram-bot-api');

console.log("🚀 STARTING BOT...");

const token = process.env.BOT_TOKEN;
const ADMIN_ID = 145044793; // replace
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU"; // replace

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

// 🚀 CREATE BOT (NO polling)
const bot = new TelegramBot(token);

// 🌐 Railway gives you this automatically
const url = process.env.RAILWAY_STATIC_URL;

// Set webhook
bot.setWebHook(`${url}/bot${token}`);

console.log("✅ WEBHOOK SET");

// Express server to receive updates
const express = require('express');
const app = express();

app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Basic route (optional)
app.get('/', (req, res) => {
    res.send("Bot is running");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌍 Server running on port ${PORT}`);
});

// ===== BOT LOGIC =====

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    if (text === '/buy') {
        bot.sendMessage(chatId, `Pay here:\n${PAYPAL_LINK}`);
    }

    if (msg.from.id != ADMIN_ID) return;

    if (text === '/test') {
        bot.sendMessage(chatId, "Admin command works ✅");
    }
});
