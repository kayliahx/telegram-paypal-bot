import express from "express"
import fetch from "node-fetch"
import { Bot, InlineKeyboard } from "grammy"

const app = express()
app.use(express.json())

const bot = new Bot(process.env.BOT_TOKEN)

const ADMIN_ID = process.env.ADMIN_ID
const CHANNEL_ID = process.env.CHANNEL_ID

// =====================
// DEBUG LOGGER (KEEP)
// =====================
bot.use((ctx, next) => {
  console.log("UPDATE:", JSON.stringify(ctx.update))
  return next()
})

// =====================
// START COMMAND
// =====================
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome 💎\n\nUse /buy to subscribe or /access to check your status."
  )
})

// =====================
// ACCESS COMMAND
// =====================
bot.command("access", async (ctx) => {
  await ctx.reply("❌ Access expired or not active.")
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
// CREATE ORDER (REAL)
// =====================
app.post("/create-order", async (req, res) => {
  try {
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
            return_url: `${process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`}/success`,
            cancel_url: `${process.env.RAILWAY_STATIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`}/cancel`,
          },
        }),
      }
    )

    const order = await orderRes.json()

    const approve = order.links?.find((l) => l.rel === "approve")

    if (!approve?.href) {
      console.log("❌ PayPal order error:", order)
      return res.status(500).json({ error: "No approval link" })
    }

    res.json({ url: approve.href })
  } catch (err) {
    console.error("CREATE ORDER ERROR:", err)
    res.status(500).json({ error: "Internal error" })
  }
})

// =====================
// BUY COMMAND (FIXED)
// =====================
bot.command("buy", async (ctx) => {
  try {
    const userId = ctx.from.id

    console.log("BUY:", userId)

    await bot.api.sendMessage(
      ADMIN_ID,
      `🛒 BUY CLICK\nUser: ${userId}\nName: ${ctx.from.first_name}`
    )

    // ✅ FIX: always absolute URL
    const baseUrl =
      process.env.RAILWAY_STATIC_URL ||
      `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`

    console.log("BASE URL:", baseUrl)

    if (!baseUrl) {
      throw new Error("No base URL found")
    }

    const response = await fetch(`${baseUrl}/create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId }),
    })

    const data = await response.json()

    if (!data.url) {
      throw new Error("No PayPal URL returned")
    }

    const keyboard = new InlineKeyboard().url("💰 Buy Access", data.url)

    await ctx.reply("Click below to subscribe:", {
      reply_markup: keyboard,
    })
  } catch (err) {
    console.error("BUY ERROR:", err)
    await ctx.reply("❌ Error generating payment link. Try again.")
  }
})

// =====================
// PAYPAL WEBHOOK
// =====================
app.post("/paypal-webhook", async (req, res) => {
  const event = req.body

  console.log("PAYPAL EVENT:", event.event_type)

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const customId =
      event.resource.purchase_units?.[0]?.custom_id

    if (!customId) {
      console.log("❌ No custom_id")
      return res.sendStatus(200)
    }

    console.log("✅ PAYMENT FOR:", customId)

    await bot.api.sendMessage(
      ADMIN_ID,
      `💰 Payment OK\nUser: ${customId}`
    )

    // GIVE ACCESS
    await bot.api.unbanChatMember(CHANNEL_ID, Number(customId))

    await bot.api.sendMessage(
      customId,
      "✅ Payment successful! You now have access."
    )

    // 5 MIN ACCESS
    setTimeout(async () => {
      try {
        await bot.api.banChatMember(CHANNEL_ID, Number(customId))
        await bot.api.unbanChatMember(CHANNEL_ID, Number(customId))

        await bot.api.sendMessage(
          customId,
          "❌ Access expired."
        )

        console.log("⛔ User kicked:", customId)
      } catch (e) {
        console.log("Kick error:", e)
      }
    }, 5 * 60 * 1000)
  }

  res.sendStatus(200)
})

// =====================
// SUCCESS / CANCEL ROUTES
// =====================
app.get("/success", (req, res) => {
  res.send("✅ Payment received. You can return to Telegram.")
})

app.get("/cancel", (req, res) => {
  res.send("❌ Payment cancelled.")
})

// =====================
// TELEGRAM WEBHOOK
// =====================
await bot.init()

app.post(`/bot${process.env.BOT_TOKEN}`, async (req, res) => {
  try {
    await bot.handleUpdate(req.body)
    res.sendStatus(200)
  } catch (err) {
    console.error("Webhook error:", err)
    res.sendStatus(500)
  }
})

// =====================
// START SERVER
// =====================
app.listen(8080, () => {
  console.log("Server running on port 8080")
})
