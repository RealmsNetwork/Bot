const { EmbedBuilder, Colors, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Data file is stored in the same folder as this module.
const DATA_FILE = path.join(__dirname, 'data.json');
let DATA = {
  warningMessageId: null,
  warningChannelId: null,
  lastPurge: null,
  lastConfigHash: null,
  processing: new Set(),
};

let clientRef = null;
let configRef = null;

// ------------------------------------------------------------------
// Helpers: load/save data
// ------------------------------------------------------------------
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE));
      Object.assign(DATA, parsed);
      DATA.processing = new Set(parsed.processing || []);
      console.log('[Honeypot] Data loaded');
    }
  } catch (_) {}
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({
      warningMessageId: DATA.warningMessageId,
      warningChannelId: DATA.warningChannelId,
      lastPurge: DATA.lastPurge,
      lastConfigHash: DATA.lastConfigHash,
      processing: Array.from(DATA.processing),
    }, null, 2));
  } catch (_) {}
}

// ------------------------------------------------------------------
// Config helpers
// ------------------------------------------------------------------
function getConfigHash() {
  const cfg = configRef.honeypot.warningEmbed;
  const str = JSON.stringify({
    title: cfg.title,
    color: cfg.color,
    author: cfg.author,
    description: cfg.description,
    footer: cfg.footer,
  });
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash = hash & hash;
  }
  return hash.toString(16);
}

function getBranding() {
  return configRef.branding || {};
}

function getWarningColor() {
  const embedColor = configRef.honeypot.warningEmbed.color;
  return (embedColor !== null && embedColor !== undefined) ? embedColor : getBranding().embedColor || '#FF0000';
}

function getAuthorName() {
  const cfg = configRef.honeypot.warningEmbed.author;
  const brand = getBranding();
  return cfg && cfg.name ? cfg.name : `${brand.serverName || 'Server'} Security System`;
}

function getFooterText() {
  const cfg = configRef.honeypot.warningEmbed.footer;
  const brand = getBranding();
  return cfg && cfg.text ? cfg.text : `${brand.serverName || 'Server'} • Automated Security`;
}

function getSupportUrl() {
  const brand = getBranding();
  return brand.supportUrl || 'https://discord.gg/your-server';
}

function getServerName() {
  const brand = getBranding();
  return brand.serverName || 'Server';
}

function replacePlaceholders(text) {
  if (!text) return text;
  const brand = getBranding();
  return text
    .replace(/{serverName}/g, brand.serverName || 'Server')
    .replace(/{supportUrl}/g, brand.supportUrl || 'https://discord.gg/your-server');
}

// ------------------------------------------------------------------
// Discord helpers
// ------------------------------------------------------------------
async function getChannel(id) {
  try { return await clientRef.channels.fetch(id); } catch { return null; }
}
async function getMember(guild, userId) {
  try { return await guild.members.fetch(userId); } catch { return null; }
}
function fmtDate(d) { return `<t:${Math.floor(d.getTime()/1000)}:F>`; }
function truncate(s, max = 1000) { return s ? (s.length > max ? s.slice(0,max)+'...' : s) : 'No content'; }

// ------------------------------------------------------------------
// Logging to staff channel
// ------------------------------------------------------------------
async function logToChannel(logData) {
  if (!configRef.honeypot.logChannelId) return;
  const chan = await getChannel(configRef.honeypot.logChannelId);
  if (!chan?.isTextBased()) return;

  const logColor = getBranding().logColor || '#2B2D31';
  const embed = new EmbedBuilder()
    .setColor(logColor)
    .setTimestamp()
    .setFooter({ text: `${getServerName()} Security Log`, iconURL: clientRef.user.displayAvatarURL() });

  switch (logData.type) {
    case 'honeypot_trigger': {
      const u = logData.user;
      embed.setTitle('Honeypot Triggered')
        .setColor('#FF0000')
        .setThumbnail(u.displayAvatarURL({ dynamic: true }))
        .setDescription(`**User:** ${u.toString()} (${u.tag})`)
        .addFields(
          { name: 'ID', value: u.id, inline: true },
          { name: 'Nickname', value: u.displayName || 'None', inline: true },
          { name: 'Account Created', value: fmtDate(u.createdAt), inline: false },
          { name: 'Joined Server', value: fmtDate(logData.memberJoinedAt || new Date()), inline: false },
          { name: 'Message Content', value: truncate(logData.messageContent), inline: false }
        );
      if (logData.attachments?.length) {
        embed.addFields({ name: 'Attachments', value: logData.attachments.map(a => `[${a.name}](${a.url})`).join('\n').slice(0, 500), inline: false });
      }
      if (logData.embeds?.length) {
        embed.addFields({ name: 'Embeds', value: `${logData.embeds.length} embed(s)`, inline: false });
      }
      if (logData.stickers?.length) {
        embed.addFields({ name: 'Stickers', value: logData.stickers.map(s => s.name).join(', ').slice(0, 500), inline: false });
      }
      if (logData.poll) {
        embed.addFields({ name: 'Poll', value: `Question: ${logData.poll.question || 'Unknown'}`, inline: false });
      }
      const emoji = logData.action === 'ban' ? '🔨' : logData.action === 'kick' ? '👢' : logData.action === 'timeout' ? '⏰' : '⚠️';
      embed.addFields(
        { name: 'Action', value: `${emoji} **${logData.action.toUpperCase()}**`, inline: true },
        { name: 'Reason', value: logData.auditReason || 'Triggered honeypot', inline: false },
        { name: 'Channel', value: `<#${logData.channelId}>`, inline: true },
        { name: 'Guild', value: logData.guildName || 'Unknown', inline: true }
      );
      break;
    }
    case 'warning_created':
      embed.setTitle('Warning Created')
        .setColor('#00FF00')
        .setDescription(`New warning in <#${logData.channelId}>`)
        .addFields({ name: 'ID', value: logData.messageId, inline: true }, { name: 'Action', value: logData.action || 'Created', inline: true });
      break;
    case 'warning_updated':
      embed.setTitle('Warning Updated')
        .setColor('#FFAA00')
        .setDescription(`Warning updated in <#${logData.channelId}>`)
        .addFields(
          { name: 'Old ID', value: logData.oldId || 'Unknown', inline: true },
          { name: 'New ID', value: logData.newId || 'Unknown', inline: true },
          { name: 'Reason', value: logData.reason || 'Config change', inline: false }
        );
      break;
    case 'error':
      embed.setTitle('Error')
        .setColor('#FF0000')
        .setDescription(`**Error:** ${logData.error || 'Unknown'}`)
        .addFields({ name: 'Context', value: logData.context || 'Unknown', inline: false });
      break;
    case 'self_heal':
      embed.setTitle('Self-Heal')
        .setColor('#00AAFF')
        .setDescription(`Self-healing in <#${logData.channelId}>`)
        .addFields(
          { name: 'Action', value: logData.action || 'Unknown', inline: false },
          { name: 'Details', value: logData.details || 'No details', inline: false }
        );
      break;
    default:
      return;
  }
  await chan.send({ embeds: [embed] });
}

// ------------------------------------------------------------------
// DM the user before punishment
// ------------------------------------------------------------------
async function sendDmToUser(user, action, reason) {
  if (!configRef.honeypot.dmBeforePunishment) return;
  const serverName = getServerName();
  const supportUrl = getSupportUrl();
  try {
    await user.send({
      embeds: [new EmbedBuilder()
        .setTitle(`${serverName} Security Alert`)
        .setColor('#FF0000')
        .setDescription(`
You have been ${action} from ${serverName}.

Reason: ${reason}

This action was taken by our automated security system because you interacted with a protected honeypot channel.

If you believe this was an error, please appeal at:
${supportUrl}

This is an automated message. Do not reply to this DM.
        `)
        .setFooter({ text: `${serverName} • Automated Security`, iconURL: clientRef.user.displayAvatarURL() })
        .setTimestamp()
      ]
    });
    console.log(`[DM] Sent to ${user.tag}`);
  } catch (_) {}
}

// ------------------------------------------------------------------
// Create the warning embed
// ------------------------------------------------------------------
async function createWarningEmbed(channel, action = 'Created') {
  try {
    const cfg = configRef.honeypot.warningEmbed;
    const color = getWarningColor();
    const authorName = getAuthorName();
    const footerText = getFooterText();
    const description = replacePlaceholders(cfg.description || 'Warning channel');

    const embed = new EmbedBuilder()
      .setTitle(cfg.title || 'WARNING')
      .setColor(color)
      .setDescription(description)
      .setTimestamp();
    embed.setAuthor({
      name: authorName,
      iconURL: clientRef.user.displayAvatarURL()
    });
    embed.setFooter({
      text: footerText,
      iconURL: clientRef.user.displayAvatarURL()
    });

    const msg = await channel.send({ embeds: [embed] });
    DATA.warningMessageId = msg.id;
    DATA.lastConfigHash = getConfigHash();
    saveData();
    await logToChannel({ type: 'warning_created', channelId: channel.id, messageId: msg.id, action });
    console.log(`[Warning] ${action.toLowerCase()}: ${msg.id}`);
    return msg;
  } catch (error) {
    console.error('[Warning] Failed to create:', error);
    await logToChannel({ type: 'error', error: error.message, context: 'createWarningEmbed' });
    return null;
  }
}

// ------------------------------------------------------------------
// Manage the warning embed (ensure exactly one, update if needed)
// ------------------------------------------------------------------
async function manageWarningEmbed() {
  try {
    const channel = await getChannel(configRef.honeypot.channelId);
    if (!channel?.isTextBased()) {
      console.error('[Honeypot] Channel not found or invalid');
      return;
    }

    let needsUpdate = false;
    let existing = null;
    const currentHash = getConfigHash();

    if (DATA.warningMessageId) {
      try {
        existing = await channel.messages.fetch(DATA.warningMessageId);
        if (existing.embeds.length === 0) {
          needsUpdate = true;
        } else {
          const emb = existing.embeds[0];
          const cfg = configRef.honeypot.warningEmbed;
          const expectedTitle = cfg.title || 'WARNING';
          const expectedColor = getWarningColor();
          const expectedDesc = replacePlaceholders(cfg.description || 'Warning channel');
          if (DATA.lastConfigHash !== currentHash ||
              emb.title !== expectedTitle ||
              emb.color !== expectedColor ||
              emb.description !== expectedDesc) {
            needsUpdate = true;
          }
        }
      } catch (_) {
        needsUpdate = true;
      }
    } else {
      needsUpdate = true;
    }

    // Remove duplicate warning messages
    if (!needsUpdate && existing) {
      const msgs = await channel.messages.fetch({ limit: 50 });
      const duplicates = msgs.filter(m =>
        m.embeds.length > 0 &&
        m.embeds[0].title === (configRef.honeypot.warningEmbed.title || 'WARNING') &&
        m.id !== DATA.warningMessageId
      );
      for (const [id, m] of duplicates) {
        try { await m.delete(); console.log(`[Warning] Deleted duplicate: ${id}`); } catch (_) {}
      }
      if (duplicates.size > 0) {
        try { await existing.delete(); } catch (_) {}
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      if (existing) {
        try { await existing.delete(); } catch (_) {}
      }
      const newMsg = await createWarningEmbed(channel, 'Updated');
      if (newMsg) {
        await logToChannel({
          type: 'warning_updated',
          channelId: channel.id,
          oldId: DATA.warningMessageId || 'None',
          newId: newMsg.id,
          reason: DATA.warningMessageId ? 'Config changed or content mismatch' : 'No existing warning'
        });
      }
    } else if (!existing && !DATA.warningMessageId) {
      await createWarningEmbed(channel, 'Created');
    } else {
      console.log('[Warning] Up to date');
    }
  } catch (error) {
    console.error('[Warning] Manage error:', error);
    await logToChannel({ type: 'error', error: error.message, context: 'manageWarningEmbed' });
  }
}

// ------------------------------------------------------------------
// Purge all messages (except the warning) on startup
// ------------------------------------------------------------------
async function purgeChannel(channel) {
  if (!configRef.honeypot.purgeOnStartup) return;
  try {
    console.log(`[Purge] Cleaning #${channel.name}...`);
    let deleted = 0;
    let fetched;
    do {
      fetched = await channel.messages.fetch({ limit: 100 });
      if (fetched.size === 0) break;
      const toDelete = fetched.filter(m => m.id !== DATA.warningMessageId);
      if (toDelete.size === 0) break;
      try {
        const del = await channel.bulkDelete(toDelete, true);
        deleted += del.size;
      } catch (err) {
        if (err.code === 50034) {
          for (const [id, m] of toDelete) {
            try { await m.delete(); deleted++; await new Promise(r => setTimeout(r, 100)); } catch (_) {}
          }
        } else throw err;
      }
    } while (fetched.size >= 100);
    console.log(`[Purge] Deleted ${deleted} messages`);
    DATA.lastPurge = Date.now();
    saveData();
  } catch (error) {
    console.error('[Purge] Error:', error);
    await logToChannel({ type: 'error', error: error.message, context: 'purgeChannel' });
  }
}

// ------------------------------------------------------------------
// Execute the configured punishment
// ------------------------------------------------------------------
async function executeModeration(user, guild, message) {
  const punishment = configRef.honeypot.punishment;
  const reason = 'Triggered honeypot security channel';
  const member = await getMember(guild, user.id);
  if (!member) return console.warn(`[Mod] Could not find ${user.tag}`);

  // Global staff immunity – each module decides independently.
  const staffRoleId = configRef.staff?.roleId;
  const ignoreStaff = configRef.honeypot.ignoreStaff !== false;
  if (ignoreStaff && staffRoleId && member.roles.cache.has(staffRoleId)) {
    console.log(`[Mod] ${user.tag} has staff role, ignoring (honeypot.ignoreStaff=true)`);
    if (configRef.honeypot.deleteTriggerMessage) {
      try { await message.delete(); } catch (_) {}
    }
    return;
  }

  try {
    await sendDmToUser(user, punishment, reason);
    let actionTaken = punishment;

    switch (punishment) {
      case 'ban':
        try {
          await member.ban({ reason, deleteMessageSeconds: 604800 });
          console.log(`[Mod] Banned ${user.tag}`);
        } catch (err) {
          if (err.message.includes('Missing Permissions')) {
            await member.kick(reason);
            actionTaken = 'kick (fallback)';
            console.log(`[Mod] Kicked ${user.tag} (ban fallback)`);
          } else throw err;
        }
        break;
      case 'kick':
        await member.kick(reason);
        console.log(`[Mod] Kicked ${user.tag}`);
        break;
      case 'timeout':
        await member.timeout(configRef.honeypot.timeoutDuration, reason);
        console.log(`[Mod] Timed out ${user.tag}`);
        break;
      case 'none':
        console.log(`[Mod] No punishment, only logging`);
        break;
      default:
        console.warn(`[Mod] Unknown punishment: ${punishment}`);
    }

    if (configRef.honeypot.deleteTriggerMessage) {
      try { await message.delete(); } catch (_) {}
    }

    await logToChannel({
      type: 'honeypot_trigger',
      user: user,
      memberJoinedAt: member.joinedAt || new Date(),
      messageContent: message.content || 'No content',
      attachments: message.attachments ? Array.from(message.attachments.values()) : [],
      embeds: message.embeds || [],
      stickers: message.stickers ? Array.from(message.stickers.values()) : [],
      poll: message.poll || null,
      action: actionTaken,
      auditReason: reason,
      channelId: message.channel.id,
      guildName: guild.name,
    });

    DATA.processing.add(user.id);
    setTimeout(() => { DATA.processing.delete(user.id); saveData(); }, 5000);
    saveData();
  } catch (error) {
    console.error(`[Mod] Error on ${user.tag}:`, error);
    await logToChannel({ type: 'error', error: error.message, context: 'executeModeration' });
  }
}

// ------------------------------------------------------------------
// Main message handler
// ------------------------------------------------------------------
async function handleHoneypotMessage(message) {
  if (DATA.processing.has(message.author.id)) return;
  if (message.channel.id !== configRef.honeypot.channelId) return;
  if (configRef.honeypot.ignoreBots && message.author.bot) return;
  if (configRef.honeypot.ignoreWebhooks && message.webhookId) return;

  DATA.processing.add(message.author.id);
  saveData();
  try {
    console.log(`[Honeypot] Triggered by ${message.author.tag}`);
    await executeModeration(message.author, message.guild, message);
  } catch (error) {
    console.error('[Honeypot] Handler error:', error);
  } finally {
    setTimeout(() => {
      DATA.processing.delete(message.author.id);
      saveData();
    }, 5000);
  }
}

// ------------------------------------------------------------------
// Register Discord events
// ------------------------------------------------------------------
function registerEvents() {
  clientRef.on('messageCreate', async (message) => {
    if (!message.guild || message.guild.id !== configRef.guildId) return;
    await handleHoneypotMessage(message);
  });

  clientRef.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.guild.id !== configRef.guildId) return;
    if (newMsg.channel.id !== configRef.honeypot.channelId) return;
    if (oldMsg.content === newMsg.content) return;
    let msg = newMsg;
    if (newMsg.partial) {
      try { msg = await newMsg.fetch(); } catch { return; }
    }
    await handleHoneypotMessage(msg);
  });

  clientRef.on('messageDelete', async (message) => {
    if (!message.guild || message.guild.id !== configRef.guildId) return;
    if (message.channel.id !== configRef.honeypot.channelId) return;
    if (DATA.warningMessageId && message.id === DATA.warningMessageId) {
      console.log('[Honeypot] Warning deleted');
      await logToChannel({
        type: 'self_heal',
        channelId: message.channel.id,
        action: 'Warning Deleted',
        details: 'Will recreate on next check'
      });
      DATA.warningMessageId = null;
      saveData();
      setTimeout(async () => { await manageWarningEmbed(); }, 5000);
    }
  });
}

// ------------------------------------------------------------------
// Startup: ready event
// ------------------------------------------------------------------
async function onReady() {
  console.log(`[Bot] Logged in as ${clientRef.user.tag}`);
  console.log(`[Honeypot] Monitoring channel: ${configRef.honeypot.channelId}`);
  console.log(`[Honeypot] Punishment: ${configRef.honeypot.punishment}`);

  try {
    const channel = await getChannel(configRef.honeypot.channelId);
    if (!channel?.isTextBased()) {
      console.error('[Honeypot] Channel not found!');
      return;
    }

    if (configRef.honeypot.purgeOnStartup) {
      await purgeChannel(channel);
    }

    await manageWarningEmbed();

    if (configRef.honeypot.recreateWarning) {
      setInterval(async () => { await manageWarningEmbed(); }, 60000);
      console.log('[Honeypot] Self-healing active (60s interval)');
    }

    console.log('[Honeypot] System ready');
  } catch (error) {
    console.error('[Honeypot] Startup error:', error);
    await logToChannel({ type: 'error', error: error.message, context: 'ready' });
  }
}

// ------------------------------------------------------------------
// Public initialize function – called from index.js
// ------------------------------------------------------------------
function initializeHoneypot(client, config) {
  clientRef = client;
  configRef = config;
  loadData();
  registerEvents();
  clientRef.once('ready', onReady);
}

module.exports = { initializeHoneypot };
