import express from "express";
import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";

const { Pool } = pkg;

const app = express();
app.use(express.json());

// ================== ENV ==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;

// ✅ FIXED: enable polling
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ================== DB ==================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ FIXED: safe async init (prevents crash)
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      has_access BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
})();

// ================== PAYPAL TOKEN ==================
async function getAccessToken() {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  return data.access_token;
}

// ================== CREATE ORDER ==================
async function createOrder(userId) {
  const accessToken = await getAccessToken();

  const res = await fetch(
    "https://api-m.paypal.com/v2/checkout/orders",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "EUR",
              value: "0.50",
            },
            custom_id: String(userId),
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

// ================== COMMANDS ==================

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;

  await pool.query(
    `INSERT INTO users (id) VALUES ($1)
     ON CONFLICT (id) DO NOTHING`,
    [chatId]
  );

  await bot.sendMessage(
    chatId,
    `👋 Welcome!

Use /buy to get access  
Use /status to check access`
  );
});

bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;

  const checkoutUrl = await createOrder(chatId);

  await bot.sendMessage(
    chatId,
    `💳 Complete your payment:\n${checkoutUrl}`
  );
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;

  const result = await pool.query(
    `SELECT has_access FROM users WHERE id=$1`,
    [chatId]
  );

  if (result.rows.length && result.rows[0].has_access) {
    await bot.sendMessage(chatId, "✅ You have access");
  } else {
    await bot.sendMessage(chatId, "❌ No active access");
  }
});

// ================== WEBHOOK ==================

app.post("/paypal-webhook", async (req, res) => {
  console.log("💰 PayPal webhook received");

  const event = req.body;

  try {
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.sendStatus(200);
    }

    // ✅ FIXED: correct location of userId
    const userId =
      event.resource?.purchase_units?.[0]?.custom_id;

    if (!userId) {
      console.log("❌ No userId in purchase_units");
      console.log(JSON.stringify(event.resource, null, 2));
      return res.sendStatus(200);
    }

    if (!/^\d+$/.test(userId)) {
      console.log("❌ Invalid userId format:", userId);
      return res.sendStatus(200);
    }

    // ================== SAVE ACCESS ==================
    await pool.query(
      `INSERT INTO users (id, has_access)
       VALUES ($1, true)
       ON CONFLICT (id)
       DO UPDATE SET has_access = true`,
      [userId]
    );

    // ================== CREATE INVITE ==================
    const inviteLink = await bot.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
    });

    // ================== SEND ACCESS ==================
    await bot.sendMessage(
      userId,
      `🎉 Payment received!

Here is your private access:
${inviteLink.invite_link}`
    );

    console.log("✅ Access granted to", userId);

  } catch (err) {
    console.log("❌ Error:", err.message);
  }

  res.sendStatus(200);
});

// ================== SERVER ==================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
