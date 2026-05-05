import express from "express"
import { Bot } from "grammy"
import fetch from "node-fetch"
import pkg from "pg"

const { Pool } = pkg

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN
const BASE_URL = process.env.BASE_URL.replace("https://", "")
const CHANNEL_ID = process.env.CHANNEL_ID
const DATABASE_URL = process.env.DATABASE_URL

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID
const PAYPAL_SECRET = process.env.PAYPAL_SECRET

const PRICE = "0.20"
const CURRENCY = "EUR"
const ACCESS_DURATION_MINUTES = 60 * 24

// ===== INIT =====
const app = express()
const bot = new Bot(BOT_TOKEN)

const db = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

app.use(express.json())

// ===== DB INIT =====
await db.query(`
CREATE TABLE IF NOT EXISTS users (
  telegram_id BIGINT PRIMARY KEY,
  expiry BIGINT
)
`)

// ===== PAYPAL TOKEN =====
async function getPayPalToken() {
  const res = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Authorization":
        "Basic " +
        Buffer.from(PAYPAL_CLIENT_ID + ":" + PAYPAL_SECRET).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  })

  const data = await res.json()
  return data.access_token
}

// ===== CREATE ORDER =====
async function createOrder(userId) {
  const token = await getPayPalToken()

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
          amount: {
            currency_code: CURRENCY,
            value: PRICE
          },
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
  return data.links.find(l => l.rel === "approve").href
}

// ===== COMMANDS =====
bot.command("start", (ctx) => {
  ctx.reply("Welcome 💎\nUse /buy or /access")
})

bot.command("buy", async (ctx) => {
  try {
    const link = await createOrder(ctx.from.id)

    await ctx.reply("Click below:", {
      reply_markup: {
        inline_keyboard: [[{ text: "💰 Buy", url: link }]]
      }
    })
  } catch (e) {
    console.log(e)
    ctx.reply("❌ Error generating payment link.")
  }
})

bot.command("access", async (ctx) => {
  const res = await db.query(
    "SELECT expiry FROM users WHERE telegram_id=$1",
    [ctx.from.id]
  )

  if (!res.rows.length) {
    return ctx.reply("❌ No active access.")
  }

  const expiry = res.rows[0].expiry

  if (Date.now() > expiry) {
    return ctx.reply("❌ Access expired.")
  }

  const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
    expire_date: Math.floor(expiry / 1000),
    member_limit: 1
  })

  ctx.reply(`🔗 Your access:\n${invite.invite_link}`)
})

// ===== 🔐 ANTI-SHARING (JOIN CONTROL) =====
bot.on("chat_member", async (ctx) => {
  const update = ctx.update.chat_member

  if (update.new_chat_member.status === "member") {
    const userId = update.new_chat_member.user.id

    const res = await db.query(
      "SELECT expiry FROM users WHERE telegram_id=$1",
      [userId]
    )

    if (!res.rows.length) {
      await bot.api.banChatMember(CHANNEL_ID, userId)
      await bot.api.unbanChatMember(CHANNEL_ID, userId)
      console.log("🚫 Unauthorized join blocked:", userId)
      return
    }

    const expiry = res.rows[0].expiry

    if (Date.now() > expiry) {
      await bot.api.banChatMember(CHANNEL_ID, userId)
      await bot.api.unbanChatMember(CHANNEL_ID, userId)
      console.log("🚫 Expired user kicked:", userId)
      return
    }

    console.log("✅ Valid user joined:", userId)
  }
})

// ===== PAYPAL WEBHOOK =====
app.post("/paypal", async (req, res) => {
  try {
    const event = req.body

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      console.log("💰 PAYMENT RECEIVED")

      const userId = event.resource?.custom_id

      if (!userId) {
        console.log("❌ No user ID")
        return res.sendStatus(200)
      }

      const expiry = Date.now() + ACCESS_DURATION_MINUTES * 60 * 1000

      await db.query(
        `
        INSERT INTO users (telegram_id, expiry)
        VALUES ($1, $2)
        ON CONFLICT (telegram_id)
        DO UPDATE SET expiry=$2
      `,
        [userId, expiry]
      )

      const invite = await bot.api.createChatInviteLink(CHANNEL_ID, {
        expire_date: Math.floor(expiry / 1000),
        member_limit: 1
      })

      await bot.api.sendMessage(
        userId,
        `✅ Payment confirmed\n🔗 ${invite.invite_link}`
      )

      console.log("✅ LINK SENT:", userId)
    }

    res.sendStatus(200)
  } catch (err) {
    console.log(err)
    res.sendStatus(500)
  }
})

// ===== AUTO KICK =====
setInterval(async () => {
  const res = await db.query("SELECT telegram_id, expiry FROM users")

  for (const user of res.rows) {
    if (Date.now() > user.expiry) {
      try {
        await bot.api.banChatMember(CHANNEL_ID, user.telegram_id)
        await bot.api.unbanChatMember(CHANNEL_ID, user.telegram_id)
        console.log("🚫 Removed:", user.telegram_id)
      } catch {}
    }
  }
}, 60000)

// ===== TELEGRAM WEBHOOK =====
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body)
  res.sendStatus(200)
})

// ===== INIT =====
const init = async () => {
  await bot.api.deleteWebhook()

  const webhookUrl = `https://${BASE_URL}/bot${BOT_TOKEN}`

  await bot.api.setWebhook(webhookUrl)

  console.log("✅ Webhook set:", webhookUrl)
}

init()

app.listen(8080, () => console.log("🚀 Server running"))
