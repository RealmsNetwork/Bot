const { GoogleGenerativeAI } = require('@google/generative-ai');

let clientRef = null;
let configRef = null;
let model = null;

// ------------------------------------------------------------------
// Cooldown tracker
// ------------------------------------------------------------------
const cooldowns = new Map();

function isOnCooldown(userId, cooldownSeconds) {
  const now = Date.now();
  const last = cooldowns.get(userId);
  if (last && (now - last) < cooldownSeconds * 1000) return true;
  cooldowns.set(userId, now);
  return false;
}

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------
function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length <= maxLen ? text : text.slice(0, maxLen) + '…';
}

async function safeReply(message, content) {
  try {
    await message.reply(content);
  } catch (err) {
    console.error('[Chat] Failed to send reply:', err);
  }
}

function startTyping(channel) {
  let stopped = false;
  let interval = null;

  const sendTyping = async () => {
    if (stopped) return;
    try {
      await channel.sendTyping();
    } catch (_) {}
  };

  sendTyping();
  interval = setInterval(sendTyping, 5000);

  return () => {
    stopped = true;
    if (interval) clearInterval(interval);
  };
}

// ------------------------------------------------------------------
// Main message handler
// ------------------------------------------------------------------
async function handleMessage(message) {
  // Safety checks
  if (message.author.bot) return;
  if (message.partial) await message.fetch().catch(() => {});
  if (message.channelId !== configRef.chat.channelId) return;

  const content = message.content?.trim();
  if (!content) return;

  const cooldownSec = configRef.chat.cooldownSeconds || 5;
  if (isOnCooldown(message.author.id, cooldownSec)) {
    await safeReply(message, `⏳ Please wait ${cooldownSec}s before sending another message.`);
    return;
  }

  const maxLen = configRef.chat.maxInputLength || 2000;
  const safeContent = truncateText(content, maxLen);

  const stopTyping = startTyping(message.channel);

  try {
    const result = await model.generateContent(safeContent);
    const response = await result.response;
    let replyText = response.text();

    if (!replyText || replyText.length === 0) {
      replyText = configRef.chat.fallbackMessage || 'I couldn’t generate a response. Please try again.';
    }

    replyText = truncateText(replyText, 2000);
    await message.reply(replyText);
  } catch (error) {
    console.error('[Chat] Gemini API error:', error);
    await safeReply(message, '⚠️ The AI service is temporarily unavailable. Please try later.');
  } finally {
    stopTyping();
  }
}

// ------------------------------------------------------------------
// Register events
// ------------------------------------------------------------------
function registerEvents() {
  clientRef.on('messageCreate', async (message) => {
    if (!message.guild || message.guild.id !== configRef.guildId) return;
    await handleMessage(message);
  });
}

// ------------------------------------------------------------------
// Initialisation
// ------------------------------------------------------------------
function initialize(client, config) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('[Chat] GEMINI_API_KEY not set – chat module disabled');
    return;
  }

  clientRef = client;
  configRef = config;

  // Initialise Gemini
  const genAI = new GoogleGenerativeAI(apiKey);
  model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  registerEvents();
  console.log('[Chat] Module initialised, listening to channel ' + config.chat?.channelId);
}

module.exports = { initialize };
