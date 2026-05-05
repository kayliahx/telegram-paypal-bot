import express from "express"
import { Bot } from "grammy"
import fetch from "node-fetch"
import pkg from "pg"
const { Pool } = pkg

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN
const BASE_URL = process.env.BASE_URL
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID
const PAYPAL_SECRET = process.env.PAYPAL_SECRET
const CHANNEL_ID = process.env.CHANNEL_ID

if (!BOT_TOKEN || !BASE_URL) {
  throw new Error("Missing required environment variables")
}

// ===== SETUP =====
const bot = new Bot(BOT_TOKEN)
const app = express()
app.use(express.json())

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ===== START =====
bot.command("start", async (ctx) => {
  await ctx.reply("Welcome 💎\n\nUse /buy or /access")
})

// ===== BUY =====
bot.command("buy", async (ctx) => {
  try {
    const userId = ctx.from.id

    const order = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64")
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          amount: {
            currency_code: "EUR",
            value: "0.20"
          },
          custom_id: userId.toString()
        }]
      })
    })

    const data = await order.json()

    const link = data.links.find(l => l.rel === "approve").href

    await ctx.reply("Click below to pay:", {
      reply_markup: {
        inline_keyboard: [[{ text: "💰 Buy Access", url: link }]]
      }
    })

  } catch (err) {
    console.error(err)
    await ctx.reply("❌ Error generating payment link. Try again.")
  }
})

// ===== ACCESS CHECK =====
bot.command("access", async (ctx) => {
  const userId = ctx.from.id

  const result = await pool.query(
    "SELECT * FROM users WHERE telegram_id=$1",
    [userId]
  )

  if (result.rows.length === 0) {
    return ctx.reply("❌ No access found")
  }

  const user = result.rows[0]

  if (new Date(user.expiry) < new Date()) {
    return ctx.reply("❌ Your access expired")
  }

  ctx.reply("✅ You have access")
})

// ===== PAYPAL WEBHOOK =====
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {

      const userId = event.resource?.custom_id

      if (!userId) return res.sendStatus(200)

      console.log("💰 PAYMENT SUCCESS:", userId)

      // ===== CREATE INVITE LINK =====
      const link = await bot.api.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + (60 * 60) // 1 hour
      })

      // ===== SAVE USER =====
      const expiry = new Date(Date.now() + (24 * 60 * 60 * 1000)) // 24h access

      await pool.query(`
        INSERT INTO users (telegram_id, expiry)
        VALUES ($1, $2)
        ON CONFLICT (telegram_id)
        DO UPDATE SET expiry=$2
      `, [userId, expiry])

      // ===== SEND LINK =====
      await bot.api.sendMessage(userId, `✅ Payment confirmed\n\n🔗 ${link.invite_link}`)

      console.log("✅ LINK SENT:", userId)
    }

    res.sendStatus(200)

  } catch (err) {
    console.error(err)
    res.sendStatus(500)
  }
})

// ===== AUTO KICK EXPIRED USERS =====
setInterval(async () => {
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE expiry < NOW()"
    )

    for (const user of result.rows) {
      try {
        await bot.api.banChatMember(CHANNEL_ID, user.telegram_id)
        await bot.api.unbanChatMember(CHANNEL_ID, user.telegram_id)

        await pool.query(
          "DELETE FROM users WHERE telegram_id=$1",
          [user.telegram_id]
        )

        console.log("🚫 Kicked:", user.telegram_id)
      } catch (e) {}
    }

  } catch (err) {
    console.error(err)
  }
}, 60000)

// ===== WEBHOOK =====
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body)
  res.sendStatus(200)
})

// ===== START SERVER =====
const PORT = process.env.PORT || 8080

app.listen(PORT, async () => {
  console.log("Server running")

  await bot.api.setWebhook(`${BASE_URL}/bot${BOT_TOKEN}`)

  console.log("Webhook set:", `${BASE_URL}/bot${BOT_TOKEN}`)
})
