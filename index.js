require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const PORT = process.env.PORT || 8080;

// ===== STORAGE =====
const DB_FILE = "./db.json";

let db = {
  pendingUsers: {},
  activeUsers: {}
};

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ===== TELEGRAM =====
async function sendMessage(chatId, text, extra = {}) {
  return axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    ...extra
  });
}

// ===== LOGS =====
function log(msg) {
  console.log(msg);
}

// ===== TELEGRAM WEBHOOK =====
app.post(`/telegram-webhook/${BOT_TOKEN}`, async (req, res) => {
  const msg = req.body.message;
  if (!msg) return res.sendStatus(200);

  const chatId = msg.chat.id;
  const text = msg.text || "";

  log(`📩 ${chatId} → ${text}`);

  // START
  if (text === "/start") {
    await sendMessage(chatId, "Welcome 👋 Choose an option:", {
      reply_markup: {
        keyboard: [
          ["💰 Buy Access"],
          ["ℹ️ Help"]
        ],
        resize_keyboard: true
      }
    });
  }

  // HELP
  if (text === "ℹ️ Help") {
    await sendMessage(chatId, "Use /buy to purchase access.");
  }

  // STATUS
  if (text === "/status") {
    const user = db.activeUsers[chatId];
    if (!user) {
      return sendMessage(chatId, "❌ No active access.");
    }

    const remaining = Math.floor((user.expiresAt - Date.now()) / 1000);
    return sendMessage(chatId, `✅ Active\n⏳ Remaining: ${remaining}s`);
  }

  // ACCESS
  if (text === "/access") {
    if (!db.activeUsers[chatId]) {
      return sendMessage(chatId, "❌ No access.");
    }

    return sendMessage(chatId, "✅ You already have access.");
  }

  // BUY
  if (text === "💰 Buy Access" || text === "/buy") {
    db.pendingUsers[chatId] = Date.now();
    saveDB();

    log(`🛒 BUY → ${chatId}`);

    await sendMessage(chatId, "Click below to pay:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Pay Now", url: "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU" }]
        ]
      }
    });

    await sendMessage(ADMIN_ID, `💰 BUY CLICK\nUser: ${chatId}`);
  }

  res.sendStatus(200);
});

// ===== PAYPAL WEBHOOK =====
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body;

  log("💰 PAYPAL EVENT RECEIVED");

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const now = Date.now();

    const validUser = Object.entries(db.pendingUsers)
      .filter(([id, time]) => now - time < 10 * 60 * 1000)
      .sort((a, b) => b[1] - a[1])[0];

    if (!validUser) {
      log("❌ No matching user");
      return res.sendStatus(200);
    }

    const chatId = validUser[0];

    log(`✅ MATCH → ${chatId}`);

    delete db.pendingUsers[chatId];

    // ===== CREATE INVITE =====
    const invite = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/createChatInviteLink`,
      {
        chat_id: CHANNEL_ID,
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 300 // 5 min to use link
      }
    );

    const link = invite.data.result.invite_link;

    // ===== SAVE ACCESS (1 month) =====
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;

    db.activeUsers[chatId] = {
      expiresAt
    };

    saveDB();

    await sendMessage(chatId, `✅ Payment confirmed\n\nJoin here:\n${link}`);

    await sendMessage(ADMIN_ID, `💰 PAYMENT OK\nUser: ${chatId}`);
  }

  res.sendStatus(200);
});

// ===== EXPIRY CHECK (EVERY 1 MIN) =====
setInterval(async () => {
  const now = Date.now();

  for (const chatId in db.activeUsers) {
    if (db.activeUsers[chatId].expiresAt < now) {
      try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/banChatMember`, {
          chat_id: CHANNEL_ID,
          user_id: chatId
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/unbanChatMember`, {
          chat_id: CHANNEL_ID,
          user_id: chatId
        });

        log(`🚫 Removed ${chatId}`);

        delete db.activeUsers[chatId];
        saveDB();
      } catch (e) {
        log("Kick error: " + (e.response?.data || e.message));
      }
    }
  }
}, 60000);

// ===== START SERVER =====
app.listen(PORT, async () => {
  log("🚀 Server running");

  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    url: `https://${process.env.RAILWAY_STATIC_URL}/telegram-webhook/${BOT_TOKEN}`
  });

  log("✅ Telegram webhook set");
});
