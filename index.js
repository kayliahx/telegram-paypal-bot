const TelegramBot = require("node-telegram-bot-api");

const express = require("express");

const fetch = global.fetch;

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const app = express();

app.use(express.json());

const CHANNEL_ID = process.env.CHANNEL_ID;

const users = new Map();

const remindersSent = new Set();

// =======================

// START COMMAND (BUTTON)

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

// BUTTON CLICK

// =======================

bot.on("callback_query", async (query) => {

  const userId = query.from.id;

  // 🔒 Prevent double payment

  if (users.has(userId) && Date.now() < users.get(userId)) {

    return bot.sendMessage(

      query.message.chat.id,

      "✅ You already have active access."

    );

  }

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

  // 🔒 Prevent double payment

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

              value: "1.00", // 💰 CHANGE PRICE HERE

            },

          },

        ],

        application_context: {

          return_url: "https://perceptive-empathy-production-18c6.up.railway.app/success",

          cancel_url: "https://perceptive-empathy-production-18c6.up.railway.app/cancel",

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

    const userId = Number(data.purchase_units[0].custom_id);

    console.log("💰 Payment from:", userId);

    const duration = 5 * 60 * 1000; // ⏱ CHANGE TIME HERE

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

// AUTO KICK + REMINDER

// =======================

setInterval(async () => {

  const now = Date.now();

  for (const [userId, expiry] of users.entries()) {

    const timeLeft = expiry - now;

    // 🔔 Adaptive reminder

    const reminderTime = Math.min(

      3 * 24 * 60 * 60 * 1000,

      Math.max(60 * 60 * 1000, timeLeft * 0.2)

    );

    if (

      timeLeft > 0 &&

      timeLeft <= reminderTime &&

      !remindersSent.has(userId)

    ) {

      try {

        await bot.sendMessage(

          userId,

          "⏳ Your access will expire soon.\n\nRenew here 👉 /buy"

        );

        remindersSent.add(userId);

        console.log("🔔 Reminder sent to:", userId);

      } catch (err) {

        console.log("Reminder error:", err.message);

      }

    }

    // ⛔ Remove user

    if (now > expiry) {

      try {

        await bot.banChatMember(CHANNEL_ID, userId);

        users.delete(userId);

        remindersSent.delete(userId);

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
