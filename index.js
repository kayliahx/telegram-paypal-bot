const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const fetch = global.fetch;

const bot = new TelegramBot(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());

const CHANNEL_ID = process.env.CHANNEL_ID;
const users = new Map();

// =======================
// WEBHOOK SETUP
// =======================
const WEBHOOK_URL = "https://perceptive-empathy-production-18c6.up.railway.app/webhook";

bot.setWebHook(WEBHOOK_URL)
  .then(() => console.log("🔗 Webhook set:", WEBHOOK_URL))
  .catch(err => console.error("Webhook error:", err.message));

// =======================
// RECEIVE UPDATES
// =======================
app.post("/webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// =======================
// START COMMAND
// =======================
bot.onText(/\/start/, (msg) => {
  console.log("📩 /start from", msg.from.id);

  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome!\n\n💳 Get access to the private channel:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Buy Access", callback_data: "buy_access" }]
        ],
      },
    }
  );
});

// =======================
// BUTTON CLICK
// =======================
bot.on("callback_query", async (query) => {
  const userId = query.from.id;

  if (query.data === "buy_access") {
    const url = await createOrder(userId);

    bot.sendMessage(
      query.message.chat.id,
      `💳 Complete your payment:\n${url}`
    );
  }

  bot.answerCallbackQuery(query.id);
});

// =======================
// BUY COMMAND
// =======================
bot.onText(/\/buy/, async (msg) => {
  const userId = msg.from.id;

  if (users.has(userId) && Date.now() < users.get(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "✅ You already have active access."
    );
  }

  const url = await createOrder(userId);

  bot.sendMessage(
    msg.chat.id,
    `💳 Complete your payment:\n${url}`
  );
});

// =======================
// ID COMMAND
// =======================
bot.onText(/\/id/, (msg) => {
  bot.sendMessage(msg.chat.id, `🆔 Your ID: ${msg.from.id}`);
});

// =======================
// ACCESS COMMAND
// =======================
bot.onText(/\/access/, (msg) => {
  const userId = msg.from.id;

  if (!users.has(userId) || Date.now() > users.get(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ You must purchase first.\nUse /buy"
    );
  }

  bot.sendMessage(msg.chat.id, "✅ You already have access.");
});

// =======================
// STATUS COMMAND ✅
// =======================
bot.onText(/\/status/, (msg) => {
  const userId = msg.from.id;

  if (!users.has(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ You don’t have active access."
    );
  }

  const expiry = users.get(userId);

  if (Date.now() > expiry) {
    return bot.sendMessage(
      msg.chat.id,
      "❌ Your access has expired.\nUse /buy to renew."
    );
  }

  const timeLeftMs = expiry - Date.now();

  const minutes = Math.floor(timeLeftMs / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  bot.sendMessage(
    msg.chat.id,
    `⏳ Time remaining:\n${hours}h ${remainingMinutes}m`
  );
});

// =======================
// PAYPAL TOKEN
// =======================
async function getAccessToken() {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  return data.access_token;
}

// =======================
// CREATE ORDER
// =======================
async function createOrder(userId) {
  const token = await getAccessToken();

  const res = await fetch(
    "https://api-m.paypal.com/v2/checkout/orders",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: String(userId),
            amount: {
              currency_code: "EUR",
              value: "1.00",
            },
          },
        ],
        application_context: {
          return_url:
            "https://perceptive-empathy-production-18c6.up.railway.app/success",
          cancel_url:
            "https://perceptive-empathy-production-18c6.up.railway.app/cancel",
        },
      }),
    }
  );

  const data = await res.json();
  return data.links.find((l) => l.rel === "approve").href;
}

// =======================
// SUCCESS (CAPTURE)
// =======================
app.get("/success", async (req, res) => {
  try {
    const orderID = req.query.token;

    const token = await getAccessToken();

    const captureRes = await fetch(
      `https://api-m.paypal.com/v2/checkout/orders/${orderID}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await captureRes.json();

    const userId = Number(
      data.purchase_units[0].payments.captures[0].custom_id ||
      data.purchase_units[0].custom_id
    );

    console.log("💰 PAYMENT:", userId);

    const duration = 5 * 60 * 1000;
    const expiry = Date.now() + duration;

    users.set(userId, expiry);

    await bot.unbanChatMember(CHANNEL_ID, userId);

    const invite = await bot.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
    });

    await bot.sendMessage(
      userId,
      `✅ Payment successful!\n\nJoin here:\n${invite.invite_link}`
    );

    res.send("✅ Payment successful! You can return to Telegram.");
  } catch (err) {
    console.error("❌ Capture error:", err.message);
    res.send("❌ Payment error.");
  }
});

// =======================
// CANCEL
// =======================
app.get("/cancel", (req, res) => {
  res.send("❌ Payment cancelled.");
});

// =======================
// REMINDER SYSTEM
// =======================
setInterval(async () => {
  const now = Date.now();

  for (const [userId, expiry] of users.entries()) {
    const timeLeft = expiry - now;

    if (timeLeft > 0 && timeLeft < 60000) {
      await bot.sendMessage(
        userId,
        "⏳ Your access expires soon!\nUse /buy to renew."
      );
    }
  }
}, 30000);

// =======================
// AUTO KICK
// =======================
setInterval(async () => {
  const now = Date.now();

  for (const [userId, expiry] of users.entries()) {
    if (now > expiry) {
      try {
        await bot.banChatMember(CHANNEL_ID, userId);
        users.delete(userId);

        console.log("⛔ Removed:", userId);
      } catch (err) {
        console.log("Kick error:", err.message);
      }
    }
  }
}, 30000);

// =======================
// SERVER
// =======================
app.listen(process.env.PORT || 8080, () => {
  console.log("🚀 Server running");
});
