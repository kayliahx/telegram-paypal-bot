const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const fetch = global.fetch;

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());

const CHANNEL_ID = process.env.CHANNEL_ID;

const users = new Map();

// =======================
// START COMMAND (WITH BUTTON)
// =======================
bot.onText(/\/start/, (msg) => {
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
// HANDLE BUTTON CLICK
// =======================
bot.on("callback_query", async (query) => {
  const msg = query.message;
  const userId = query.from.id;

  if (query.data === "buy_access") {
    try {
      const url = await createOrder(userId);

      bot.sendMessage(
        msg.chat.id,
        `💳 Complete your payment:\n${url}`
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(msg.chat.id, "❌ Payment error.");
    }
  }

  bot.answerCallbackQuery(query.id);
});

// =======================
// BUY COMMAND (STILL AVAILABLE)
// =======================
bot.onText(/\/buy/, async (msg) => {
  const userId = msg.from.id;

  try {
    const url = await createOrder(userId);

    bot.sendMessage(
      msg.chat.id,
      `💳 Complete your payment:\n${url}`
    );
  } catch (err) {
    console.error(err);
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
              value: "1.00", // 🔥 CHANGE PRICE HERE
            },
          },
        ],
        application_context: {
          return_url: "https://example.com/success",
          cancel_url: "https://example.com/cancel",
        },
      }),
    }
  );

  const data = await res.json();
  return data.links.find((l) => l.rel === "approve").href;
}

// =======================
// WEBHOOK
// =======================
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body;

  console.log("📩 Webhook received:", event.event_type);

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    try {
      const userId = Number(
        event.resource.purchase_units[0].custom_id
      );

      console.log("💰 Payment from user:", userId);

      const duration = 5 * 60 * 1000;
      const expiry = Date.now() + duration;

      users.set(userId, expiry);

      await bot.unbanChatMember(CHANNEL_ID, userId);

      const invite = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
      });

      await bot.sendMessage(
        userId,
        `✅ Payment received!\n\nJoin here:\n${invite.invite_link}`
      );

      console.log("✅ Access granted:", userId);
    } catch (err) {
      console.error("❌ Webhook error:", err.message);
    }
  }

  res.sendStatus(200);
});

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

        console.log("⛔ User removed:", userId);
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
