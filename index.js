import express from "express"
import fetch from "node-fetch"
import { Bot } from "grammy"
import pkg from "pg"

const { Pool } = pkg

const app = express()
app.use(express.json())

const bot = new Bot(process.env.BOT_TOKEN)

const ADMIN_ID = process.env.ADMIN_ID
const CHANNEL_ID = process.env.CHANNEL_ID

// =====================
// DATABASE (POSTGRES)
// =====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// =====================
// START
// =====================
bot.command("start", (ctx) => {
  ctx.reply("Welcome 💎\n\nUse /buy or /access")
})

// =====================
// ACCESS CHECK
// =====================
bot.command("access", async (ctx) => {
  const userId = ctx.from.id

  const result = await pool.query(
    "SELECT expiry FROM users WHERE user_id=$1",
    [userId]
  )

  if (result.rows.length === 0) {
    return ctx.reply("❌ No active access")
  }

  const expiry = result.rows[0].expiry

  if (expiry > Date.now()) {
    const sec = Math.floor((expiry - Date.now()) / 1000)
    ctx.reply(`✅ Active\n⏳ ${sec}s`)
  } else {
    ctx.reply("❌ Expired")
  }
})

// =====================
// PAYPAL TOKEN
// =====================
async function getPayPalToken() {
  const res = await fetch(`${process.env.PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          process.env.PAYPAL_CLIENT_ID + ":" + process.env.PAYPAL_SECRET
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  })

  const data = await res.json()
  return data.access_token
}

// =====================
// CAPTURE ORDER
// =====================
async function captureOrder(orderId) {
  const token = await getPayPalToken()

  await fetch(
    `${process.env.PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  )
}

// =====================
// CREATE ORDER
// =====================
app.post("/create-order", async (req, res) => {
  const { userId } = req.body

  const token = await getPayPalToken()

  const orderRes = await fetch(
    `${process.env.PAYPAL_API}/v2/checkout/orders`,
    {
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
              currency_code: "USD",
              value: "10.00",
            },
            custom_id: String(userId),
          },
        ],
        application_context: {
          return_url: `https://${process.env.RAILWAY_STATIC_URL}/success`,
          cancel_url: `https://${process.env.RAILWAY_STATIC_URL}/cancel`,
        },
      }),
    }
  )

  const order = await orderRes.json()
  const approve = order.links.find((l) => l.rel === "approve")

  res.json({ url: approve.href })
})

// =====================
// BUY
// =====================
bot.command("buy", async (ctx) => {
  const userId = ctx.from.id

  const baseUrl = `https://${process.env.RAILWAY_STATIC_URL}`

  const r = await fetch(`${baseUrl}/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  })

  const data = await r.json()

  await ctx.reply("Click below:", {
    reply_markup: {
      inline_keyboard: [[{ text: "💰 Buy", url: data.url }]],
    },
  })
})

// =====================
// PAYPAL WEBHOOK
// =====================
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body

  console.log("EVENT:", event.event_type)

  // CAPTURE
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    await captureOrder(event.resource.id)
  }

  // SUCCESS
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const userId = Number(
      event.resource.purchase_units[0].custom_id
    )

    const expiry = Date.now() + 5 * 60 * 1000

    // SAVE USER
    await pool.query(
      `INSERT INTO users (user_id, expiry)
       VALUES ($1,$2)
       ON CONFLICT (user_id)
       DO UPDATE SET expiry=$2`,
      [userId, expiry]
    )

    // CREATE ONE-TIME LINK (ANTI-SHARE)
    const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 300,
    })

    await bot.api.sendMessage(
      userId,
      `✅ Payment confirmed\n\n🔗 Join:\n${invite.invite_link}`
    )
  }

  res.sendStatus(200)
})

// =====================
// AUTO CLEANER (CRITICAL)
// =====================
setInterval(async () => {
  const now = Date.now()

  const result = await pool.query(
    "SELECT user_id FROM users WHERE expiry < $1",
    [now]
  )

  for (const row of result.rows) {
    const userId = row.user_id

    try {
      await bot.api.banChatMember(CHANNEL_ID, userId)
      await bot.api.unbanChatMember(CHANNEL_ID, userId)

      await pool.query(
        "DELETE FROM users WHERE user_id=$1",
        [userId]
      )

      console.log("⛔ Removed:", userId)
    } catch {}
  }
}, 60000)

// =====================
app.get("/success", (req, res) => {
  res.send("✅ Payment received. Return to Telegram.")
})

// =====================
await bot.init()

app.post(`/bot${process.env.BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body)
  res.sendStatus(200)
})

app.listen(8080)
