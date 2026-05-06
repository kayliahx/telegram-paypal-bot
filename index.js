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
  const userId = ctx.from.id

  const result = await pool.query(
    "SELECT expiry FROM users WHERE telegram_id = $1",
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
})

// ================= PAYPAL WEBHOOK =================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body

    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.sendStatus(200)
    }

    const captureId = event.resource?.id
    const userId = event.resource?.custom_id

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

    console.log("✅ VERIFIED PAYMENT:", userId)

    // 🎟 CREATE SINGLE USE LINK
    const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600
    })

    // 📅 SAVE EXPIRY (24h)
    const expiry = new Date(Date.now() + 86400000)

    await pool.query(
      `
      INSERT INTO users (telegram_id, expiry)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id)
      DO UPDATE SET expiry=$2
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
app.use(`/${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body)
  res.sendStatus(200)
})

// ================= AUTO KICK =================
setInterval(async () => {
  try {
    const expired = await pool.query(
      "SELECT telegram_id FROM users WHERE expiry < NOW()"
    )

    for (const user of expired.rows) {
      try {
        await bot.api.banChatMember(CHANNEL_ID, user.telegram_id)
        await bot.api.unbanChatMember(CHANNEL_ID, user.telegram_id)
        console.log("🚫 Kicked:", user.telegram_id)
      } catch (e) {}
    }
  } catch (err) {
    console.error("Auto-kick error:", err)
  }
}, 60000)

// ================= PREVENT LINK SHARING =================
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text

  if (text.includes("t.me/") || text.includes("telegram.me")) {
    try {
      await ctx.deleteMessage()
    } catch (e) {}
  }
})

// ================= START SERVER =================
const PORT = process.env.PORT || 3000

app.listen(PORT, async () => {
  console.log("🚀 Server running")

  try {
    await bot.api.setWebhook(`https://${BASE_URL}/${BOT_TOKEN}`)
    console.log("✅ Webhook set")
  } catch (err) {
    console.log("⚠️ Webhook already set or rate limited")
  }
})
