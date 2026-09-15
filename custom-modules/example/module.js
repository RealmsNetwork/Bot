const { SlashCommandBuilder, Events } = require('discord.js');

const commands = [{
  data: new SlashCommandBuilder().setName('jshello').setDescription('Example real JavaScript module command'),
  cooldown: 3,
  execute: async (interaction, client) => {
    await interaction.reply(`Hello ${interaction.user}! Your custom JS module is running on ${client.framework.name}.`);
  }
}];

const listeners = [{
  event: Events.MessageCreate,
  handle: async (message) => {
    if (!message.guild || message.author.bot) return;
    if (message.content.trim().toLowerCase() === '!jshello') await message.reply(`JS event handler online in ${message.guild.name}.`);
  }
}];

async function initialize(client, config, moduleConfig) {
  client.customExample = { config: moduleConfig, startedAt: Date.now() };
}

module.exports = { initialize, commands, listeners };
