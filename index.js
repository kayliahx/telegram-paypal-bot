console.log("🚀 STARTING BOT...");

const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("✅ BOT STARTED");

const ADMIN_ID = 145044793; // your ID
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

// ✅ ADD HERE
const usersPaid = new Set();

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // ✅ /start
    if (text === '/start') {
        bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    // ✅ /buy (WITH BUTTON)
    if (text === '/buy') {
        bot.sendMessage(chatId, "Unlock access 💎", {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "💳 Pay now",
                            url: PAYPAL_LINK
                        }
                    ]
                ]
            }
        });
    }

    // ✅ /id (user gets their ID)
    if (text === '/id') {
        bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
    }

    // ✅ /access (LOCKED CONTENT)
    if (text === '/access') {
        if (!usersPaid.has(msg.from.id)) {
            return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
        }

        bot.sendMessage(chatId, "🔥 Here is your private content:\n[PUT YOUR LINK HERE]");
    }

    // 🚨 ADMIN ONLY BELOW THIS LINE
    if (msg.from.id != ADMIN_ID) return;

    // ✅ /test
    if (text === '/test') {
        bot.sendMessage(chatId, "Admin command works ✅");
    }

    // ✅ /approve USER_ID
    if (text.startsWith('/approve')) {
        const userId = text.split(' ')[1];

        usersPaid.add(Number(userId));

        bot.sendMessage(chatId, `✅ User ${userId} approved`);
    }
});
