import express from "express"
import { Bot } from "grammy"
import pkg from "pg"

const { Pool } = pkg

const app = express()
app.use(express.json())

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN
const CHANNEL_ID = process.env.CHANNEL_ID
const BASE_URL = process.env.BASE_URL
  ? process.env.BASE_URL.replace("https://", "")
  : null

if (!BOT_TOKEN || !CHANNEL_ID || !BASE_URL) {
  throw new Error("❌ Missing environment variables")
}

const bot = new Bot(BOT_TOKEN)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ================= PAYPAL VERIFY =================
async function verifyPayPalPayment(captureId) {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64")

  const res = await fetch(
    `https://api-m.paypal.com/v2/payments/captures/${captureId}`,
    {
      headers: {
        Authorization: `Basic ${auth}`
      }
    }
  )

  const data = await res.json()

  if (data.status !== "COMPLETED") return null

  return data
}

// ================= COMMANDS =================
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome 💎\n\nUse /buy to subscribe or /access to check your status."
  )
})

bot.command("buy", async (ctx) => {
  try {
    const userId = ctx.from.id

    const link = `https://${BASE_URL}/create-payment?userId=${userId}`

    await ctx.reply(`💳 Click to pay:\n${link}`)
  } catch (err) {
    console.error(err)
    await ctx.reply("❌ Error generating payment link. Try again.")
  }
})

bot.command("access", async (ctx) => {
  try {
    const userId = ctx.from.id

    const result = await pool.query(
      "SELECT expiry FROM users WHERE user_id = $1",
      [userId]
    )

    if (!result.rows.length) {
      return ctx.reply("❌ No active subscription.")
    }

    const expiry = result.rows[0].expiry

    if (new Date(expiry) < new Date()) {
      return ctx.reply("❌ Subscription expired.")
    }

    ctx.reply("✅ You have access.")
  } catch (err) {
    console.error(err)
    ctx.reply("❌ Error checking access.")
  }
})

// ================= PAYPAL WEBHOOK =================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body

    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.sendStatus(200)
    }

    const captureId = event.resource?.id
    const userId = Number(event.resource?.custom_id)

    if (!captureId || !userId) {
      return res.sendStatus(200)
    }

    // 🔐 VERIFY PAYMENT
    const verified = await verifyPayPalPayment(captureId)

    if (!verified) {
      console.log("❌ Fake payment blocked")
      return res.sendStatus(200)
    }

    // 🔒 CHECK AMOUNT (€0.20)
    if (
      verified.amount.value !== "0.20" ||
      verified.amount.currency_code !== "EUR"
    ) {
      console.log("❌ Wrong amount")
      return res.sendStatus(200)
    }

    // 🔒 PREVENT DUPLICATE PAYMENTS
    const existingPayment = await pool.query(
      "SELECT * FROM payments WHERE payment_id = $1",
      [captureId]
    )

    if (existingPayment.rows.length > 0) {
      console.log("❌ Duplicate payment blocked")
      return res.sendStatus(200)
    }

    // 💾 SAVE PAYMENT
    await pool.query(
      `
      INSERT INTO payments (payment_id, user_id)
      VALUES ($1, $2)
      `,
      [captureId, userId]
    )

    console.log("✅ VERIFIED PAYMENT:", userId)

    // 🎟 CREATE SINGLE USE LINK
    const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600,
      creates_join_request: false
    })

    // 📅 SAVE EXPIRY (24h)
    const expiry = new Date(Date.now() + 86400000)

    await pool.query(
      `
      INSERT INTO users (user_id, expiry)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET expiry = EXCLUDED.expiry
      `,
      [userId, expiry]
    )

    await bot.api.sendMessage(
      userId,
      `✅ Payment confirmed\n\n${invite.invite_link}`
    )

    console.log("🔗 LINK SENT:", userId)

    res.sendStatus(200)

  } catch (err) {
    console.error("Webhook error:", err)
    res.sendStatus(500)
  }
})

// ================= TELEGRAM WEBHOOK =================
app.use(`/${BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body)
  } catch (err) {
    console.error("Telegram webhook error:", err)
  }

  res.sendStatus(200)
})

// ================= AUTO KICK =================
setInterval(async () => {
  try {
    const expired = await pool.query(
      "SELECT user_id FROM users WHERE expiry < NOW()"
    )

    for (const user of expired.rows) {
      try {
        await bot.api.banChatMember(CHANNEL_ID, user.user_id)
        await bot.api.unbanChatMember(CHANNEL_ID, user.user_id)

        console.log("🚫 Kicked:", user.user_id)

        // 🗑 REMOVE EXPIRED USER
        await pool.query(
          "DELETE FROM users WHERE user_id = $1",
          [user.user_id]
        )

      } catch (e) {
        console.log("Kick error:", e.message)
      }
    }
  } catch (err) {
    console.error("Auto-kick error:", err)
  }
}, 60000)

// ================= PREVENT LINK SHARING =================
bot.on("message:text", async (ctx) => {
  try {
    const text = ctx.message.text || ""

    if (
      text.includes("t.me/") ||
      text.includes("telegram.me") ||
      text.includes("joinchat")
    ) {
      await ctx.deleteMessage()
    }
  } catch (e) {}
})

// ================= HEALTH CHECK =================
app.get("/", (req, res) => {
  res.send("Bot running")
})

// ================= START SERVER =================
const PORT = process.env.PORT || 3000

app.listen(PORT, async () => {
  console.log("🚀 Server running")

  try {
    const webhookUrl = `https://${BASE_URL}/${BOT_TOKEN}`

    await bot.api.setWebhook(webhookUrl)

    console.log("✅ Webhook set:", webhookUrl)

  } catch (err) {
    console.log("⚠️ Webhook already set or rate limited")
    console.log(err.message)
  }
})