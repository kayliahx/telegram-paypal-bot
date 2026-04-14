import { Telegraf } from 'telegraf';

const bot = new Telegraf(process.env.BOT_TOKEN);

// Start command
bot.start((ctx) => {
  ctx.reply('Bot is online 🚀');
});

// Simple test command
bot.command('ping', (ctx) => {
  ctx.reply('pong ✅');
});

bot.launch();

console.log('Bot started');
