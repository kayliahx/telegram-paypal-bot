const TelegramBot = require('node-telegram-bot-api');

console.log("🚀 STARTING BOT...");

const token = process.env.BOT_TOKEN;

if (!token) {
    console.log("❌ NO TOKEN FOUND");
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

console.log("✅ BOT STARTED");

// ===== CONFIG =====
const ADMIN_ID = 8283814198; //
const PAYPAL_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU"; //
const CHANNEL_ID = -1002841551368; //

// ===== STORAGE =====
const usersPaid = new Set();

// ===== BOT LOGIC =====
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // ===== USER =====

    if (text === '/start') {
        return bot.sendMessage(chatId, "Welcome 💫\nSend /buy to purchase.");
    }

    if (text === '/buy') {
        return bot.sendMessage(chatId, `💳 Pay here:\n${PAYPAL_LINK}`);
    }

    if (text === '/id') {
        return bot.sendMessage(chatId, `Your ID: ${msg.from.id}`);
    }

    // 🔐 ACCESS WITH SECURE INVITE LINK
    if (text === '/access') {

        if (!usersPaid.has(Number(msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You must purchase first.\nUse /buy");
        }

        try {
            const invite = await bot.createChatInviteLink(CHANNEL_ID, {
                member_limit: 1
            });

            return bot.sendMessage(chatId, "🔓 Your private access:", {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Join Channel 🔥", url: invite.invite_link }]
                    ]
                }
            });

        } catch (err) {
            console.log(err);
            return bot.sendMessage(chatId, "❌ Error generating access link");
        }
    }

    // ===== ADMIN ONLY =====
    if (msg.from.id != ADMIN_ID) return;

    if (text === '/test') {
        return bot.sendMessage(chatId, "Admin command works ✅");
    }

    // APPROVE USER
    if (text.startsWith('/approve')) {

        const parts = text.split(' ');
        const userId = parseInt(parts[1]);

        if (isNaN(userId)) {
            return bot.sendMessage(chatId, "❌ Invalid ID");
        }

        usersPaid.add(userId);

        return bot.sendMessage(chatId, `👑 Admin approved user ${userId}`);
    }
});
