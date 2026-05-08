import express from "express"
import { Bot } from "grammy"
import pkg from "pg"

const { Pool } = pkg

const app = express()
app.use(express.json())

// ================= CONFIG =================
const BOT_TOKEN = process.env.BOT_TOKEN
const CHANNEL_ID = process.env.CHANNEL_ID
const ADMIN_ID = process.env.ADMIN_ID

const BASE_URL = process.env.BASE_URL
  ? process.env.BASE_URL.replace("https://", "")
  : null

if (!BOT_TOKEN || !CHANNEL_ID || !BASE_URL) {
  throw new Error("❌ Missing environment variables")
}

const bot = new Bot(BOT_TOKEN)

await bot.init()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

// ================= ADMIN NOTIFY =================
async function notifyAdmin(message) {
  try {
    if (!ADMIN_ID) return

    await bot.api.sendMessage(ADMIN_ID, message)
  } catch (err) {
    console.log("Admin notification error:", err.message)
  }
}

// ================= PAYPAL VERIFY =================
async function verifyPayPalPayment(captureId) {
  try {
    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
    ).toString("base64")

    // GET ACCESS TOKEN
    const tokenRes = await fetch(
      "https://api-m.paypal.com/v1/oauth2/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      }
    )

    const tokenData = await tokenRes.json()

    const accessToken = tokenData.access_token

    // VERIFY PAYMENT
    const res = await fetch(
      `https://api-m.paypal.com/v2/payments/captures/${captureId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    )

    const data = await res.json()

    if (data.status !== "COMPLETED") {
      return null
    }

    return data

  } catch (err) {
    console.log("PayPal verify error:", err)
    return null
  }
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
    const username = ctx.from.username || "no_username"

    const link = `https://${BASE_URL}/create-payment?userId=${userId}`

    console.log("💳 BUY CLICK:", userId)

    await notifyAdmin(
      `💳 BUY CLICK\n\nUser ID: ${userId}\nUsername: @${username}`
    )

    await ctx.reply("💳 Subscribe now:", {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "💎 Pay €0.50",
              url: link
            }
          ]
        ]
      }
    })

  } catch (err) {
    console.error(err)
    await ctx.reply("❌ Error generating payment link. Try again.")
  }
})

bot.command("access", async (ctx) => {
  try {
    const userId = ctx.from.id

    const result = await pool.query(
      `
      SELECT expiry
      FROM users
      WHERE telegram_id = $1
      `,
      [userId]
    )

    if (!result.rows.length) {
      return ctx.reply("❌ No active subscription.")
    }

    const expiry = result.rows[0].expiry

    if (new Date(expiry) < new Date()) {
      return ctx.reply("❌ Subscription expired.")
    }

    await ctx.reply("✅ You have access.")

  } catch (err) {
    console.log(err)
    await ctx.reply("❌ Error checking access.")
  }
})

// ================= CREATE PAYMENT ROUTE =================
app.get("/create-payment", async (req, res) => {
  try {
    const userId = req.query.userId

    if (!userId) {
      return res.status(400).send("Missing user ID")
    }

    console.log("🌐 PAYMENT PAGE OPENED:", userId)

    await notifyAdmin(
      `🌐 PAYMENT PAGE OPENED\n\nUser ID: ${userId}`
    )

    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
    ).toString("base64")

    // GET ACCESS TOKEN
    const tokenRes = await fetch(
      "https://api-m.paypal.com/v1/oauth2/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "grant_type=client_credentials"
      }
    )

    const tokenData = await tokenRes.json()

    const accessToken = tokenData.access_token

    // CREATE ORDER
    const orderRes = await fetch(
      "https://api-m.paypal.com/v2/checkout/orders",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: userId,
              amount: {
                currency_code: "EUR",
                value: "0.50"
              }
            }
          ],
          application_context: {
            return_url: `https://${BASE_URL}/success`,
            cancel_url: `https://${BASE_URL}/cancel`
          }
        })
      }
    )

    const orderData = await orderRes.json()

    const approveLink = orderData.links.find(
      (l) => l.rel === "approve"
    )

    if (!approveLink) {
      console.log(orderData)
      return res.status(500).send("Failed to create PayPal link")
    }

    return res.redirect(approveLink.href)

  } catch (err) {
    console.error("Create payment error:", err)
    return res.status(500).send("Payment creation failed")
  }
})

// ================= SUCCESS PAGE =================
app.get("/success", (req, res) => {
  res.send("✅ Payment received. Return to Telegram.")
})

// ================= CANCEL PAGE =================
app.get("/cancel", (req, res) => {
  res.send("❌ Payment cancelled.")
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

    // VERIFY PAYMENT
    const verified = await verifyPayPalPayment(captureId)

    if (!verified) {
      console.log("❌ Fake payment blocked")
      return res.sendStatus(200)
    }

    // VERIFY PRICE
    if (
      verified.amount.value !== "0.50" ||
      verified.amount.currency_code !== "EUR"
    ) {
      console.log("❌ Wrong payment amount")
      return res.sendStatus(200)
    }

    console.log("✅ VERIFIED PAYMENT:", userId)

    await notifyAdmin(
      `✅ PAYMENT RECEIVED\n\nUser ID: ${userId}\nAmount: €0.50`
    )

    // CREATE INVITE LINK (5 MINUTES)
    const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 300
    })

    // SAVE SUBSCRIPTION
    const expiry = new Date(Date.now() + 86400000)

    await pool.query(
      `
      INSERT INTO users (telegram_id, expiry)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id)
      DO UPDATE SET expiry = $2
      `,
      [userId, expiry]
    )

    // SEND LINK
    await bot.api.sendMessage(
      userId,
      `✅ Payment confirmed\n\n${invite.invite_link}`
    )

    console.log("🔗 LINK SENT:", userId)

    await notifyAdmin(
      `🔗 INVITE SENT\n\nUser ID: ${userId}`
    )

    return res.sendStatus(200)

  } catch (err) {
    console.error("Webhook error:", err)
    return res.sendStatus(500)
  }
})

// ================= TELEGRAM WEBHOOK =================
app.post(`/${BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body)
    res.sendStatus(200)

  } catch (err) {
    console.log("Telegram webhook error:", err)
    res.sendStatus(500)
  }
})

// ================= AUTO KICK =================
setInterval(async () => {
  try {
    const expired = await pool.query(
      `
      SELECT telegram_id
      FROM users
      WHERE expiry < NOW()
      `
    )

    for (const user of expired.rows) {
      try {
        await bot.api.banChatMember(
          CHANNEL_ID,
          user.telegram_id
        )

        await bot.api.unbanChatMember(
          CHANNEL_ID,
          user.telegram_id
        )

        console.log("🚫 Kicked:", user.telegram_id)

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
    const text = ctx.message.text.toLowerCase()

    if (
      text.includes("t.me/") ||
      text.includes("telegram.me") ||
      text.includes("http://") ||
      text.includes("https://")
    ) {
      await ctx.deleteMessage()

      console.log("🚫 Link deleted")
    }

  } catch (e) {}
})

// ================= START SERVER =================
const PORT = process.env.PORT || 3000

app.listen(PORT, async () => {
  console.log("🚀 Server running")

  try {
    await bot.api.setWebhook(
      `https://${BASE_URL}/${BOT_TOKEN}`
    )

    console.log(
      `✅ Webhook set: https://${BASE_URL}/${BOT_TOKEN}`
    )

  } catch (err) {
    console.log("⚠️ Webhook already set or rate limited")
  }
})