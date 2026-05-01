import express from "express";
import TelegramBot from "node-telegram-bot-api";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ===== ENV =====
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const ADMIN_ID = process.env.ADMIN_ID;
const PAYPAL_LINK = process.env.PAYPAL_LINK;
const DATABASE_URL = process.env.DATABASE_URL;

// ===== TELEGRAM =====
const bot = new TelegramBot(TOKEN);

// ===== DATABASE =====
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ===== INIT DB =====
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id BIGINT PRIMARY KEY,
      expiry BIGINT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY
    );
  `);

  console.log("✅ Database ready");
})();

// ===== HELPERS =====
async function getUser(userId) {
  const res = await pool.query(
    "SELECT * FROM users WHERE user_id = $1",
    [userId]
  );
  return res.rows[0];
}

async function setUser(userId, expiry) {
  await pool.query(
    `INSERT INTO users (user_id, expiry)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET expiry = EXCLUDED.expiry`,
    [userId, expiry]
  );
}

// ===== TELEGRAM WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    console.log("📩 Update received");

    const update = req.body;

    if (!update.message) {
      return res.sendStatus(200);
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // 🔥 FIXED COMMAND PARSER
    const text = (msg.text || "")
      .split(" ")[0]
      .split("@")[0];

    console.log("💬", userId, text);

    if (!text) return res.sendStatus(200);

    // ===== COMMANDS =====
    switch (text) {
      case "/start":
        await bot.sendMessage(
          chatId,
          "👋 Welcome!\n\nUse /buy to get access\nUse /status to check access"
        );
        break;

      case "/buy":
        await bot.sendMessage(
          chatId,
          `💳 Pay here:\n${PAYPAL_LINK}`
        );
        break;

      case "/status": {
        const user = await getUser(userId);

        if (!user || Date.now() > user.expiry) {
          await bot.sendMessage(chatId, "❌ No active subscription");
        } else {
          const timeLeft = Math.floor(
            (user.expiry - Date.now()) / 60000
          );

          await bot.sendMessage(
            chatId,
            `✅ Active\n⏳ ${timeLeft} minutes left`
          );
        }
        break;
      }

      default:
        console.log("⚠️ Unknown command:", text);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Telegram webhook error:", err);
    res.sendStatus(500);
  }
});

// ===== PAYPAL WEBHOOK =====
app.post("/paypal-webhook", async (req, res) => {
  console.log("💰 PayPal webhook received");

  try {
    const transmissionId = req.headers["paypal-transmission-id"];
    const timeStamp = req.headers["paypal-transmission-time"];
    const certUrl = req.headers["paypal-cert-url"];
    const authAlgo = req.headers["paypal-auth-algo"];
    const transmissionSig = req.headers["paypal-transmission-sig"];

    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    const verifyRes = await fetch(
      "https://api-m.paypal.com/v1/notifications/verify-webhook-signature",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            Buffer.from(
              `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
            ).toString("base64"),
        },
        body: JSON.stringify({
          transmission_id: transmissionId,
          transmission_time: timeStamp,
          cert_url: certUrl,
          auth_algo: authAlgo,
          transmission_sig: transmissionSig,
          webhook_id: webhookId,
          webhook_event: req.body,
        }),
      }
    );

    const verifyData = await verifyRes.json();

    if (verifyData.verification_status !== "SUCCESS") {
      console.log("❌ Invalid PayPal signature");
      return res.sendStatus(400);
    }

    const event = req.body;

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const paymentId = event.resource.id;

      // 🔁 Anti-duplicate
      const existing = await pool.query(
        "SELECT * FROM payments WHERE id = $1",
        [paymentId]
      );

      if (existing.rows.length > 0) {
        console.log("⚠️ Duplicate payment ignored");
        return res.sendStatus(200);
      }

      await pool.query(
        "INSERT INTO payments (id) VALUES ($1)",
        [paymentId]
      );

      const userId = event.resource.custom_id;

      if (!userId) {
        console.log("❌ Missing userId in PayPal");
        return res.sendStatus(200);
      }

      const expiry = Date.now() + 24 * 60 * 60 * 1000;

      await setUser(userId, expiry);

      await bot.sendMessage(
        userId,
        "✅ Payment received! Access granted 🎉"
      );

      console.log("✅ Access granted to", userId);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ PayPal webhook error:", err);
    res.sendStatus(500);
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("🚀 Server running");

  const webhook = `${WEBHOOK_URL}/webhook`;

  await bot.setWebHook(webhook);

  console.log("🔗 Webhook set:", webhook);
});
