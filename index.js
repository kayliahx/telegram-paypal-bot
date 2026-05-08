import express from "express"
import { Bot, InlineKeyboard } from "grammy"
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

// ================= ADMIN NOTIFICATIONS =================
async function notifyAdmin(message) {
  try {
    if (!ADMIN_ID) return

    await bot.api.sendMessage(ADMIN_ID, message)
  } catch (err) {
    console.log("Admin notification failed")
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

    if (!accessToken) {
      console.log("❌ No PayPal access token")
      return null
    }

    // VERIFY PAYMENT
    const res = await fetch(
      `https://api-m.paypal.com/v2/payments/captures/${captureId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    const data = await res.json()

    console.log("🔍 PAYPAL VERIFY:", JSON.stringify(data, null, 2))

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
    const firstName = ctx.from.first_name || "Unknown"

    // ADMIN NOTIFICATION
    await notifyAdmin(
      `🛒 BUY CLICK\n\nUser ID: ${userId}\nUsername: @${username}\nName: ${firstName}`
    )

    const link = `https://${BASE_URL}/create-payment?userId=${userId}&username=${encodeURIComponent(username)}&name=${encodeURIComponent(firstName)}`

    const keyboard = new InlineKeyboard().url(
      "💳 PAY NOW",
      link
    )

    await ctx.reply("💎 Click below to subscribe:", {
      reply_markup: keyboard
    })
  } catch (err) {
    console.error(err)
    await ctx.reply("❌ Error generating payment link.")
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

    if (!expiry || new Date(expiry) < new Date()) {
      return ctx.reply("❌ Subscription expired.")
    }

    return ctx.reply("✅ You have active access.")
  } catch (err) {
    console.log(err)
    return ctx.reply("❌ Error checking access.")
  }
})

// ================= CREATE PAYMENT ROUTE =================
app.get("/create-payment", async (req, res) => {
  try {
    const userId = req.query.userId
    const username = req.query.username || "no_username"
    const firstName = req.query.name || "Unknown"

    if (!userId) {
      return res.status(400).send("Missing user ID")
    }

    // ADMIN NOTIFICATION
    await notifyAdmin(
      `🌐 PAYMENT PAGE OPENED\n\nUser ID: ${userId}\nUsername: @${username}\nName: ${firstName}`
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

    if (!accessToken) {
      console.log(tokenData)
      return res.status(500).send("PayPal auth failed")
    }

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

    console.log("🧾 PAYPAL ORDER:", JSON.stringify(orderData, null, 2))

    const approveLink = orderData.links?.find(
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

// ================= PAYPAL WEBHOOK =================
app.post("/paypal-webhook", async (req, res) => {
  try {
    const event = req.body

    console.log("🔥 PAYPAL WEBHOOK RECEIVED")
    console.log(JSON.stringify(event, null, 2))

    await notifyAdmin("🔥 PAYPAL WEBHOOK RECEIVED")

    if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return res.sendStatus(200)
    }

    const captureId = event.resource?.id
    const userId = event.resource?.custom_id

    if (!captureId || !userId) {
      console.log("❌ Missing capture ID or user ID")
      return res.sendStatus(200)
    }

    // VERIFY PAYMENT
    const verified = await verifyPayPalPayment(captureId)

    if (!verified) {
      console.log("❌ Fake payment blocked")

      await notifyAdmin(
        `❌ FAKE PAYMENT BLOCKED\n\nUser ID: ${userId}`
      )

      return res.sendStatus(200)
    }

    // VERIFY AMOUNT
    if (
      verified.amount?.value !== "0.50" ||
      verified.amount?.currency_code !== "EUR"
    ) {
      console.log("❌ Wrong amount")

      await notifyAdmin(
        `❌ WRONG PAYMENT AMOUNT\n\nUser ID: ${userId}`
      )

      return res.sendStatus(200)
    }

    console.log("✅ VERIFIED PAYMENT:", userId)

    await notifyAdmin(
      `💰 PAYMENT RECEIVED\n\nUser ID: ${userId}\nAmount: €0.50`
    )

    // CREATE INVITE LINK (5 MINUTES)
    const invite = await bot.api.createChatInviteLink(
      CHANNEL_ID,
      {
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 300
      }
    )

    // 24 HOURS ACCESS
    const expiry = new Date(Date.now() + 86400000)

    await pool.query(
      `
      INSERT INTO users (telegram_id, expiry)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id)
      DO UPDATE SET expiry = EXCLUDED.expiry
      `,
      [userId, expiry]
    )

    await bot.api.sendMessage(
      userId,
      `✅ Payment confirmed!\n\n🎟 Your private access link:\n${invite.invite_link}\n\n⚠️ Link expires in 5 minutes.`
    )

    console.log("🔗 LINK SENT:", userId)

    await notifyAdmin(
      `🔗 INVITE LINK SENT\n\nUser ID: ${userId}`
    )

    return res.sendStatus(200)
  } catch (err) {
    console.error("Webhook error:", err)

    await notifyAdmin(
      `❌ WEBHOOK ERROR\n\n${err.message}`
    )

    return res.sendStatus(500)
  }
})

// ================= SUCCESS PAGE =================
app.get("/success", (req, res) => {
  res.send("✅ Payment processed. Return to Telegram.")
})

// ================= CANCEL PAGE =================
app.get("/cancel", (req, res) => {
  res.send("❌ Payment cancelled.")
})

// ================= TELEGRAM WEBHOOK =================
app.post(`/${BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body)
    res.sendStatus(200)
  } catch (err) {
    console.error("Telegram webhook error:", err)
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
      WHERE expiry IS NOT NULL
      AND expiry < NOW()
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

        await notifyAdmin(
          `🚫 USER REMOVED\n\nUser ID: ${user.telegram_id}`
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
    const text = ctx.message.text.toLowerCase()

    if (
      text.includes("t.me/") ||
      text.includes("telegram.me") ||
      text.includes("chat.whatsapp") ||
      text.includes("onlyfans.com") ||
      text.includes("discord.gg")
    ) {
      await ctx.deleteMessage()

      await notifyAdmin(
        `🚫 LINK DELETED\n\nUser ID: ${ctx.from.id}`
      )
    }
  } catch (e) {}
})

// ================= START SERVER =================
const PORT = process.env.PORT || 3000

app.listen(PORT, async () => {
  console.log("🚀 Server running")

  try {
    const webhookUrl = `https://${BASE_URL}/${BOT_TOKEN}`

    await bot.api.setWebhook(webhookUrl)

    console.log(`✅ Webhook set: ${webhookUrl}`)

    await notifyAdmin(
      `🚀 BOT STARTED\n\nWebhook:\n${webhookUrl}`
    )
  } catch (err) {
    console.log("⚠️ Webhook error:", err.message)
  }
})