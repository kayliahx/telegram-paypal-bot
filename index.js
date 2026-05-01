import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

/* ================= TELEGRAM WEBHOOK ================= */
app.post(`/telegram-webhook/${BOT_TOKEN}`, (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("Telegram webhook error:", err);
    res.sendStatus(200);
  }
});

/* ================= PAYPAL TOKEN ================= */
async function getAccessToken() {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  return data.access_token;
}

/* ================= CREATE ORDER ================= */
async function createOrder(userId) {
  const token = await getAccessToken();

  const res = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
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
    }),
  });

  const data = await res.json();

  const approveLink = data.links.find((l) => l.rel === "approve");
  return approveLink.href;
}

/* ================= COMMANDS ================= */

// START
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome 👇", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💳 Buy Access", callback_data: "buy" }],
      ],
    },
  });
});

// BUY (text command)
bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const url = await createOrder(chatId);
    bot.sendMessage(chatId, `💳 Pay here:\n${url}`);
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Error creating payment");
  }
});

/* ================= BUTTON HANDLER ================= */

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;

  try {
    if (query.data === "buy") {
      const url = await createOrder(chatId);
      await bot.sendMessage(chatId, `💳 Pay here:\n${url}`);
    }

    bot.answerCallbackQuery(query.id);
  } catch (err) {
    console.error("Callback error:", err);
  }
});

/* ================= PAYPAL WEBHOOK ================= */

app.post("/paypal-webhook", async (req, res) => {
  console.log("💰 PayPal webhook received:", JSON.stringify(req.body, null, 2));

  const event = req.body;

  try {
    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.sendStatus(200);
    }

    const userId =
      event.resource?.purchase_units?.[0]?.custom_id;

    console.log("🔥 USER ID FROM PAYPAL:", userId);

    if (!userId) {
      console.log("❌ No userId found");
      return res.sendStatus(200);
    }

    await bot.sendMessage(
      userId,
      "✅ Payment received! Access granted 🎉"
    );

  } catch (err) {
    console.error("PayPal webhook error:", err);
  }

  res.sendStatus(200);
});

/* ================= HEALTH CHECK ================= */

app.get("/", (req, res) => {
  res.send("Bot is running");
});

/* ================= START SERVER ================= */

app.listen(PORT, async () => {
  console.log("Server running on port", PORT);

  const WEBHOOK_URL = `https://perceptive-empathy-production-18c6.up.railway.app/telegram-webhook/${BOT_TOKEN}`;

  await bot.setWebHook(WEBHOOK_URL);

  console.log("Telegram webhook set");
});
