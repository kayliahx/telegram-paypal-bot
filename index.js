import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 8080;

const ADMIN_ID = process.env.ADMIN_ID;
const CHANNEL_ID = process.env.CHANNEL_ID;

const PAYMENT_LINK = "https://www.paypal.com/ncp/payment/GTK5FEXNGNBDU";

// store last buyer
let pendingUsers = new Map();

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

console.log("✅ BOT TOKEN LOADED");

/* =========================
   TELEGRAM WEBHOOK
========================= */
app.post(`/telegram-webhook/${BOT_TOKEN}`, async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg) return res.sendStatus(200);

    const chatId = msg.chat.id;

    // ✅ better username display
    const username =
      msg.from.username
        ? `@${msg.from.username}`
        : `${msg.from.first_name || ""} ${msg.from.last_name || ""}`.trim() || "Unknown";

    console.log("📩 Update:", msg.text);

    /* ===== START ===== */
    if (msg.text === "/start") {
      bot.sendMessage(chatId, "Welcome 👋 Choose an option:", {
        reply_markup: {
          keyboard: [
            ["💰 Buy Access"],
            ["ℹ️ Help"]
          ],
          resize_keyboard: true
        }
      });
    }

    /* ===== BUY ===== */
    if (msg.text === "/buy" || msg.text === "💰 Buy Access") {
      pendingUsers.set(chatId, Date.now());

      // admin notify
      bot.sendMessage(ADMIN_ID,
        `💰 BUY CLICK\nUser: ${chatId}\nName: ${username}`
      );

      bot.sendMessage(chatId, "Click below to pay:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Pay Now", url: PAYMENT_LINK }]
          ]
        }
      });
    }

    /* ===== STATUS ===== */
    if (msg.text === "/status") {
      bot.sendMessage(chatId,
        `🧾 STATUS\nUser ID: ${chatId}\nPending payment: ${pendingUsers.has(chatId) ? "YES" : "NO"}`
      );
    }

    /* ===== ACCESS ===== */
    if (msg.text === "/access") {
      bot.sendMessage(chatId,
        "If you already paid, wait a few seconds. Access is automatic after payment."
      );
    }

    /* ===== HELP ===== */
    if (msg.text === "ℹ️ Help") {
      bot.sendMessage(chatId,
        "Use /buy to purchase access.\nAccess is granted automatically after payment."
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Telegram error:", err);
    res.sendStatus(500);
  }
});

/* =========================
   PAYPAL WEBHOOK
========================= */
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body;

    console.log("💰 PAYPAL EVENT:", JSON.stringify(event, null, 2));

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const email =
        event.resource?.payer?.email_address || "unknown";

      console.log("✅ PAYMENT DETECTED:", email);

      // take latest buyer
      const lastUser = Array.from(pendingUsers.keys()).pop();

      if (!lastUser) {
        console.log("❌ No pending user");
        return res.sendStatus(200);
      }

      console.log("✅ MATCHED USER:", lastUser);

      // create invite link
      const invite = await bot.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 300 // 5 min
      });

      // send to user
      await bot.sendMessage(lastUser,
        `✅ Payment received!\n\n🔗 Join here:\n${invite.invite_link}`
      );

      // admin notify
      await bot.sendMessage(ADMIN_ID,
        `💰 PAYMENT OK\nUser: ${lastUser}\nEmail: ${email}`
      );

      // kick after 5 min
      setTimeout(async () => {
        try {
          await bot.banChatMember(CHANNEL_ID, lastUser);
          await bot.unbanChatMember(CHANNEL_ID, lastUser);

          console.log("🚫 Removed:", lastUser);

          bot.sendMessage(ADMIN_ID,
            `🚫 User removed after 5 min\nUser: ${lastUser}`
          );
        } catch (err) {
          console.log("Kick error:", err.message);
        }
      }, 5 * 60 * 1000);

      pendingUsers.delete(lastUser);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ PayPal webhook error:", err);
    res.sendStatus(500);
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT, async () => {
  console.log(`🚀 Server running on ${PORT}`);

  const webhookUrl = `https://${process.env.RAILWAY_STATIC_URL}/telegram-webhook/${BOT_TOKEN}`;

  await bot.setWebHook(webhookUrl);

  console.log("✅ Telegram webhook set:", webhookUrl);
});
