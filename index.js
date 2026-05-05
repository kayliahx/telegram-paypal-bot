import express from "express"
import fetch from "node-fetch"
import { Bot, InlineKeyboard } from "grammy"

const app = express()
app.use(express.json())

const bot = new Bot(process.env.BOT_TOKEN)

const ADMIN_ID = process.env.ADMIN_ID
const CHANNEL_ID = process.env.CHANNEL_ID

// =====================
// DEBUG LOGGER
// =====================
bot.use((ctx, next) => {
  console.log("UPDATE:", JSON.stringify(ctx.update))
  return next()
})

// =====================
// START
// =====================
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome 💎\n\nUse /buy to subscribe or /access to check your status."
  )
})

// =====================
// ACCESS
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
// BUY (FIXED)
// =====================
bot.command("buy", async (ctx) => {
  try {
    const userId = ctx.from.id
    const name = ctx.from.first_name || "Unknown"

    console.log("BUY:", userId)

    // Notify admin
    await bot.api.sendMessage(
      ADMIN_ID,
      `🛒 BUY CLICK\nUser: ${userId}\nName: ${name}`
    )

    // Get PayPal token
    const token = await getPayPalToken()

    // Create order DIRECTLY (no internal fetch)
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
            return_url: "https://example.com/success",
            cancel_url: "https://example.com/cancel",
          },
        }),
      }
    )

    const order = await orderRes.json()

    const approve = order.links.find((l) => l.rel === "approve")

    if (!approve || !approve.href) {
      console.error("❌ PayPal link missing", order)
      return ctx.reply("❌ Payment error. Try again.")
    }

    const keyboard = new InlineKeyboard().url("💰 Buy Access", approve.href)

    await ctx.reply("Click below to subscribe:", {
      reply_markup: keyboard,
    })

  } catch (err) {
    console.error("BUY ERROR:", err)
    await ctx.reply("❌ Something went wrong.")
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

    // ⏱ 5 MINUTES ACCESS
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
