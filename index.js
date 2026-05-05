import express from "express"
import fetch from "node-fetch"
import { Bot, webhookCallback } from "grammy"
import pkg from "pg"

const { Pool } = pkg

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN
const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT
const PAYPAL_SECRET = process.env.PAYPAL_SECRET
const CHANNEL_ID = process.env.CHANNEL_ID
const BASE_URL = process.env.BASE_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`

// ================= INIT =================
const bot = new Bot(BOT_TOKEN)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

const app = express()
app.use(express.json())

// ================= PAYPAL =================
async function getAccessToken() {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(PAYPAL_CLIENT + ":" + PAYPAL_SECRET).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  })
  const data = await res.json()
  return data.access_token
}

async function createOrder(userId) {
  const token = await getAccessToken()

  const res = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "10.00" },
          custom_id: String(userId)
        }
      ],
      application_context: {
        return_url: `${BASE_URL}/success`,
        cancel_url: `${BASE_URL}/cancel`
      }
    })
  })

  const data = await res.json()
  return data.links.find(l => l.rel === "approve").href
}

async function captureOrder(orderId) {
  const token = await getAccessToken()

  await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  })
}

// ================= BOT =================
bot.command("start", ctx => {
  ctx.reply(
    "Welcome 💎\n\nUse /buy to subscribe or /access to check your status."
  )
})

bot.command("buy", async ctx => {
  try {
    const url = await createOrder(ctx.from.id)

    await ctx.reply("Click below to subscribe:", {
      reply_markup: {
        inline_keyboard: [[{ text: "💰 Buy Access", url }]]
      }
    })
  } catch (e) {
    console.log(e)
    ctx.reply("❌ Error generating payment link. Try again.")
  }
})

bot.command("access", async ctx => {
  const result = await pool.query(
    "SELECT expiry FROM users WHERE user_id=$1",
    [ctx.from.id]
  )

  if (result.rows.length === 0) {
    return ctx.reply("❌ No active access.")
  }

  const expiry = result.rows[0].expiry

  if (Date.now() > expiry) {
    return ctx.reply("❌ Access expired.")
  }

  ctx.reply("✅ You have active access.")
})

// ================= WEBHOOK =================
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body

  console.log("EVENT:", event.event_type)

  try {
    // capture order
    if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
      await captureOrder(event.resource.id)
    }

    // payment completed
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {

      const userId =
        event.resource?.purchase_units?.[0]?.custom_id ||
        event.resource?.custom_id

      if (!userId) {
        console.log("❌ No userId found")
        return res.sendStatus(200)
      }

      const expiry = Date.now() + 5 * 60 * 1000 // 5 minutes

      // save user
      await pool.query(
        `INSERT INTO users (user_id, expiry)
         VALUES ($1,$2)
         ON CONFLICT (user_id)
         DO UPDATE SET expiry=$2`,
        [userId, expiry]
      )

      // create one-time invite
      const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 300
      })

      // send link
      await bot.api.sendMessage(
        userId,
        `✅ Payment confirmed\n\n🔗 ${invite.invite_link}`
      )

      console.log("✅ LINK SENT:", userId)
    }

  } catch (err) {
    console.log("❌ WEBHOOK ERROR:", err)
  }

  res.sendStatus(200)
})

// ================= ROUTES =================
app.get("/", (req, res) => res.send("Bot is running"))
app.get("/success", (req, res) =>
  res.send("✅ Payment received. Return to Telegram.")
)
app.get("/cancel", (req, res) =>
  res.send("❌ Payment cancelled.")
)

app.use(webhookCallback(bot, "express"))

// ================= START =================
app.listen(process.env.PORT || 8080, () => {
  console.log("Server running")
})
