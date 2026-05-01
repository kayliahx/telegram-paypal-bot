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

// ================== TELEGRAM ==================
const bot = new TelegramBot(BOT_TOKEN);

// 🔥 IMPORTANT: replace with your Railway URL
const WEBHOOK_URL = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${BOT_TOKEN}`;

// Set Telegram webhook
await bot.setWebHook(WEBHOOK_URL);
console.log("📡 Telegram webhook set:", WEBHOOK_URL);

// Telegram webhook endpoint
app.post(`/telegram-webhook/${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================== DB ==================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    has_access BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
  )
`);

// ================== PAYPAL ==================
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

// ================== TELEGRAM COMMANDS ==================

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

// ================== PAYPAL WEBHOOK ==================

app.post("/paypal-webhook", async (req, res) => {
  console.log("💰 PayPal webhook received");

  const event = req.body;

  try {
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.sendStatus(200);
    }

    const userId =
      event.resource?.custom_id ||
      event.resource?.supplementary_data?.related_ids?.order_id;

    if (!userId || !/^\d+$/.test(userId)) {
      console.log("❌ Invalid or missing userId");
      return res.sendStatus(200);
    }

    await pool.query(
      `INSERT INTO users (id, has_access)
       VALUES ($1, true)
       ON CONFLICT (id)
       DO UPDATE SET has_access = true`,
      [userId]
    );

    const inviteLink = await bot.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
    });

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

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
