const TelegramBot = require("node-telegram-bot-api");
const express = require("express");

const app = express();
app.use(express.json());

// ✅ FIX: ROOT ROUTE (VERY IMPORTANT)
app.get("/", (req, res) => {
  res.send("Bot is alive ✅");
});

// ================== CONFIG ==================
const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const CHANNEL_ID = Number(process.env.CHANNEL_ID);

const ACCESS_DURATION = 5 * 60 * 1000; // 5 minutes

// ================== INIT ==================
const bot = new TelegramBot(TOKEN);
const users = new Map();

// ================== WEBHOOK ==================
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, async () => {
  console.log("🚀 Server running on port", PORT);

  const url = `${process.env.RAILWAY_STATIC_URL}/bot${TOKEN}`;
  await bot.setWebHook(url);
  console.log("✅ WEBHOOK SET:", url);
});

// ================== ADMIN APPROVE ==================
bot.onText(/\/approve (\d+)/, async (msg, match) => {
  console.log("🟢 APPROVE CALLED BY:", msg.from.id);

  if (msg.from.id !== ADMIN_ID) {
    console.log("❌ Not admin:", msg.from.id);
    return;
  }

  const userId = Number(match[1]);

  const expireAt = Date.now() + ACCESS_DURATION;
  users.set(userId, { expireAt });

  console.log("✅ Approved:", userId, "until", new Date(expireAt));

  bot.sendMessage(
    msg.chat.id,
    `👑 User ${userId} approved for ${ACCESS_DURATION / 60000} minutes`
  );
});

// ================== ACCESS ==================
bot.onText(/\/access/, async (msg) => {
  const userId = msg.from.id;

  console.log("📥 Access request from:", userId);
  console.log("📦 Stored users:", users);

  if (!users.has(userId)) {
    return bot.sendMessage(msg.chat.id, "❌ You must purchase first.\nUse /buy");
  }

  try {
    const invite = await bot.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
      expire_date: Math.floor((Date.now() + 5 * 60 * 1000) / 1000),
    });

    console.log("🔗 Invite created:", invite.invite_link);

    // 🔒 AUTO REVOKE AFTER 15 SECONDS
    setTimeout(async () => {
      try {
        await bot.revokeChatInviteLink(CHANNEL_ID, invite.invite_link);
        console.log("🔒 Link revoked:", invite.invite_link);
      } catch (e) {
        console.log("❌ Revoke error:", e.message);
      }
    }, 15000);

    bot.sendMessage(msg.chat.id, "🔥 Here is your private access:", {
      reply_markup: {
        inline_keyboard: [[{ text: "🔓 Join Channel", url: invite.invite_link }]],
      },
    });
  } catch (err) {
    console.log("❌ Invite error:", err.message);
  }
});

// ================== AUTO REMOVE ==================
setInterval(async () => {
  console.log("🧠 Checking users...", new Date().toISOString());

  const now = Date.now();

  for (const [userId, data] of users.entries()) {
    console.log("👀 Checking:", userId);

    console.log("🕒 NOW:", now);
    console.log("⏳ EXPIRES:", data.expireAt);
    console.log("📉 DIFF:", data.expireAt - now);

    if (now > data.expireAt) {
      console.log("⏳ Expired:", userId);

      try {
        const member = await bot.getChatMember(CHANNEL_ID, userId);
        console.log("👤 Member status:", member.status);

        if (member.status === "member" || member.status === "restricted") {
          await bot.banChatMember(CHANNEL_ID, userId);
          console.log("🚫 Banned:", userId);

          await bot.unbanChatMember(CHANNEL_ID, userId);
          console.log("♻️ Unbanned:", userId);
        }
      } catch (e) {
        console.log("❌ REMOVE ERROR FULL:", e.response?.body || e.message);
      }

      users.delete(userId);
      console.log("❌ Removed from system:", userId);
    }
  }
}, 30000);

// ================== TEST ==================
bot.onText(/\/test/, (msg) => {
  if (msg.from.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, "Admin command works ✅");
});
