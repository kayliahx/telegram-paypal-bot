const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const fetch = global.fetch;

const TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const BASE_URL = "https://perceptive-empathy-production-18c6.up.railway.app";

const bot = new TelegramBot(TOKEN); // ✅ NO POLLING
const app = express();

app.use(express.json());

const users = new Map();

// =======================
// ✅ WEBHOOK ROUTE (FIXED)
// =======================
app.post("/webhook", (req, res) => {
  console.log("📩 Update received:", JSON.stringify(req.body));

  bot.processUpdate(req.body);

  res.sendStatus(200);
});

// =======================
// DEBUG LISTENER
// =======================
bot.on("message", (msg) => {
  console.log("📨 Message:", msg.text);
});

// =======================
// START COMMAND
// =======================
bot.onText(/\/start/, (msg) => {
  console.log("👤 /start from:", msg.from.id);

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

  console.log("🖱 Button clicked:", userId);

  if (query.data === "buy_access") {
    try {
      const url = await createOrder(userId);

      bot.sendMessage(
        query.message.chat.id,
        `💳 Complete your payment:\n${url}`
      );
    } catch (err) {
      console.error("❌ Order error:", err.message);
      bot.sendMessage(query.message.chat.id, "❌ Payment error.");
    }
  }

  bot.answerCallbackQuery(query.id);
});

// =======================
// BUY COMMAND
// =======================
bot.onText(/\/buy/, async (msg) => {
  const userId = msg.from.id;

  console.log("💰 /buy from:", userId);

  if (users.has(userId) && Date.now() < users.get(userId)) {
    return bot.sendMessage(
      msg.chat.id,
      "✅ You already have active access."
    );
  }

  try {
    const url = await createOrder(userId);

    bot.sendMessage(
      msg.chat.id,
      `💳 Complete your payment:\n${url}`
    );
  } catch (err) {
    console.error("❌ Order error:", err.message);
    bot.sendMessage(msg.chat.id, "❌ Payment error.");
  }
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
          return_url: `${BASE_URL}/success`,
          cancel_url: `${BASE_URL}/cancel`,
        },
      }),
    }
  );

  const data = await res.json();

  console.log("🧾 Order created:", data.id);

  return data.links.find((l) => l.rel === "approve").href;
}

// =======================
// SUCCESS (CAPTURE)
// =======================
app.get("/success", async (req, res) => {
  try {
    const orderID = req.query.token;

    console.log("✅ Payment success hit:", orderID);

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

    console.log("💰 Capture:", JSON.stringify(data));

    const userId = Number(
      data.purchase_units[0].payments.captures[0].custom_id ||
      data.purchase_units[0].custom_id
    );

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
// RENEWAL REMINDER
// =======================
setInterval(async () => {
  const now = Date.now();

  for (const [userId, expiry] of users.entries()) {
    if (expiry - now < 60000 && expiry - now > 30000) {
      try {
        await bot.sendMessage(
          userId,
          "⚠️ Your access expires soon.\nUse /buy to renew."
        );
      } catch {}
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
// START SERVER + SET WEBHOOK
// =======================
app.listen(process.env.PORT || 8080, async () => {
  console.log("🚀 Server running (webhook mode)");

  try {
    const webhookUrl = `${BASE_URL}/webhook`;

    await fetch(
      `https://api.telegram.org/bot${TOKEN}/setWebhook?url=${webhookUrl}`
    );

    console.log("🔗 Webhook set:", webhookUrl);
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
  }
});
