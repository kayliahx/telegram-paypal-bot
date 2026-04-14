const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// 🔥 REPLACE THIS AFTER YOU FIND YOUR GROUP ID
const GROUP_ID = -1000000000000;

// 🔥 REPLACE THIS WITH YOUR TELEGRAM USER ID
const ADMIN_ID = 123456789;

let users = {};
let pending = {};

// Load users
if (fs.existsSync('users.json')) {
  users = JSON.parse(fs.readFileSync('users.json'));
}

// Save users
function saveUsers() {
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
}

// Grant access for 30 days
function addUser(userId) {
  const expiry = Date.now() + (30 * 24 * 60 * 60 * 1000);

  users[userId] = expiry;
  saveUsers();

  bot.unbanChatMember(GROUP_ID, userId).catch(()=>{});

  bot.sendMessage(userId, "✅ Access granted for 30 days 🔥");
}

// START COMMAND
bot.onText(/\/start/, (msg) => {
  const userId = msg.chat.id;

  bot.sendMessage(userId, `
💎 VIP Access

1️⃣ Pay here:
https://YOUR_PAYPAL_LINK

2️⃣ Send your PayPal email or transaction ID

3️⃣ You’ll get access within minutes 🚀
`);
});

// 🔥 LOG EVERYTHING (FOR GROUP ID + DEBUG)
bot.on('message', (msg) => {
  console.log("📩 FULL MESSAGE:", JSON.stringify(msg, null, 2));

  const userId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith('/')) return;

  pending[userId] = text;

  bot.sendMessage(userId, "⏳ Payment received, verifying...");

  bot.sendMessage(ADMIN_ID, `
💰 New payment to verify

User ID: ${userId}
Proof: ${text}

Reply with:
/approve ${userId}
`);
});

// ADMIN APPROVES PAYMENT
bot.onText(/\/approve (.+)/, (msg, match) => {
  const adminId = msg.chat.id;

  if (adminId != ADMIN_ID) return;

  const userId = match[1];

  addUser(userId);

  bot.sendMessage(userId, "🎉 Payment approved! Welcome!");
});

// AUTO REMOVE EXPIRED USERS
setInterval(() => {
  const now = Date.now();

  for (let userId in users) {
    if (users[userId] < now) {

      bot.banChatMember(GROUP_ID, userId)
        .then(() => console.log(`❌ Removed ${userId}`))
        .catch(()=>{});

      delete users[userId];
      saveUsers();
    }
  }
}, 60 * 60 * 1000);

console.log("🚀 Bot running");
