const TelegramBot = require(‘node-telegram-bot-api’);

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// 🔥 REPLACE THESE 2 VALUES
const ADMIN_ID = 145044793; // ← your Telegram ID
const PAYPAL_LINK = “https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU”; // ← your PayPal link

// /start command
bot.onText(//start/, (msg) => {
const userId = msg.chat.id;

bot.sendMessage(userId, `
💎 VIP Access

1️⃣ Pay securely here:
${PAYPAL_LINK}

2️⃣ Send your PayPal email OR transaction ID

3️⃣ You’ll be approved shortly 🚀
`);
});

// Handle user messages (payment proof)
bot.on(‘message’, (msg) => {
const userId = msg.chat.id;
const text = msg.text;

if (!text || text.startsWith(’/’)) return;

bot.sendMessage(userId, “⏳ Payment received, verifying…”);

bot.sendMessage(ADMIN_ID, `
💰 New payment to verify

User ID: ${userId}
Proof: ${text}

Approve with:
/approve ${userId}
`);
});

// Admin approves payment
bot.onText(//approve (.+)/, (msg, match) => {
const adminId = msg.chat.id;

if (adminId != ADMIN_ID) return;

const userId = match[1];

bot.sendMessage(userId, “🎉 Payment approved! Welcome 🔥”);
});

console.log(“💰 Payment bot running…”);
:::

const TelegramBot = require('node-telegram-bot-api');

console.log("🚀 STARTING BOT...");

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

console.log("🚀 Bot is launching...");

// 👇 BOT CREATION (this is where you add it)
const bot = new TelegramBot(token, { polling: true });

// 👇 ADD THIS RIGHT AFTER
bot.on('polling_error', (error) => {
  console.error("❌ Polling error:", error.message);
});

// 👇 KEEP THIS
bot.on('message', (msg) => {
  console.log("📩 Received:", msg.text);
  bot.sendMessage(msg.chat.id, "🔥 Bot is working!");
});
