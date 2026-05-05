import express from "express"
import { Bot } from "grammy"
import fetch from "node-fetch"
import pkg from "pg"
const { Pool } = pkg

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID
const PAYPAL_SECRET = process.env.PAYPAL_SECRET
const CHANNEL_ID = process.env.CHANNEL_ID
const BASE_URL = process.env.BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN

// ===== DB =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ===== INIT =====
const bot = new Bot(BOT_TOKEN)
const app = express()
app.use(express.json())

// ===== PAYPAL TOKEN =====
async function getAccessToken() {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  })

  const data = await res.json()
  return data.access_token
}

// ===== CREATE ORDER =====
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
          amount: { currency_code: "EUR", value: "0.20" },
          custom_id: String(userId)
        }
      ],
      application_context: {
        return_url: `https://${BASE_URL}/success`,
        cancel_url: `https://${BASE_URL}/cancel`
      }
    })
  })

  const data = await res.json()

  if (!data.links) throw new Error("No PayPal links")

  const approve = data.links.find(l => l.rel === "approve")
  if (!approve) throw new Error("No approve link")

  return approve.href
}

// ===== START =====
bot.command("start", ctx => {
  ctx.reply("Welcome 💎\n\nUse /buy or /access")
})

// ===== BUY =====
bot.command("buy", async ctx => {
  try {
    const link = await createOrder(ctx.from.id)

    await ctx.reply("Click below:", {
      reply_markup: {
        inline_keyboard: [[{ text: "💰 Buy", url: link }]]
      }
    })
  } catch (err) {
    console.error("BUY ERROR:", err)
    await ctx.reply("❌ Error generating payment link. Try again.")
  }
})

// ===== ACCESS =====
bot.command("access", async ctx => {
  const userId = ctx.from.id

  const res = await pool.query(
    "SELECT expires_at FROM users WHERE user_id=$1",
    [userId]
  )

  if (res.rows.length === 0) {
    return ctx.reply("❌ No access found.")
  }

  const expiry = new Date(res.rows[0].expires_at)

  if (expiry < new Date()) {
    return ctx.reply("❌ Access expired.")
  }

  const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
    member_limit: 1,
    expire_date: Math.floor((Date.now() + 10 * 60 * 1000) / 1000)
  })

  ctx.reply("🔗 Your access link:", {
    reply_markup: {
      inline_keyboard: [[{ text: "Open Channel", url: invite.invite_link }]]
    }
  })
})

// ===== PAYPAL WEBHOOK =====
app.post("/webhook", async (req, res) => {
  const event = req.body

  try {
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      console.log("PAYMENT CAPTURED")

      const userId = event.resource?.custom_id

      if (!userId) {
        console.log("❌ NO USER ID")
        return res.sendStatus(200)
      }

      const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

      await pool.query(
        `
        INSERT INTO users (user_id, expires_at)
        VALUES ($1, $2)
        ON CONFLICT (user_id)
        DO UPDATE SET expires_at = EXCLUDED.expires_at
        `,
        [userId, expiry]
      )

      const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
        member_limit: 1,
        expire_date: Math.floor((Date.now() + 10 * 60 * 1000) / 1000)
      })

      await bot.api.sendMessage(userId, "✅ Payment confirmed\n\n🔗 Access:", {
        reply_markup: {
          inline_keyboard: [[{ text: "ENTER", url: invite.invite_link }]]
        }
      })

      console.log("✅ LINK SENT:", userId)
    }

    res.sendStatus(200)
  } catch (err) {
    console.error("WEBHOOK ERROR:", err)
    res.sendStatus(500)
  }
})

// ===== AUTO KICK =====
setInterval(async () => {
  try {
    const res = await pool.query(
      "SELECT user_id FROM users WHERE expires_at < NOW()"
    )

    for (const row of res.rows) {
      try {
        await bot.api.banChatMember(CHANNEL_ID, row.user_id)
        await bot.api.unbanChatMember(CHANNEL_ID, row.user_id)

        console.log("🚫 KICKED:", row.user_id)
      } catch (err) {
        console.log("Kick failed:", row.user_id)
      }
    }
  } catch (err) {
    console.error("AUTO KICK ERROR:", err)
  }
}, 60 * 1000)

// ===== SUCCESS =====
app.get("/success", (req, res) => {
  res.send("✅ Payment received. Return to Telegram.")
})

app.get("/cancel", (req, res) => {
  res.send("❌ Payment cancelled.")
})

// ===== START =====
bot.start()
app.listen(8080, () => console.log("Server running"))
