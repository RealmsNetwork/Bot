const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { refreshCommands } = require('../../lib/module-loader');

const commands = [
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Show available RealmsNetwork Bot features').addStringOption(o => o.setName('module').setDescription('Show one module')),
    execute: async (interaction, client) => {
      const wanted = interaction.options.getString('module');
      if (wanted) {
        const module = client.modules.get(wanted);
        if (!module) return interaction.reply({ content: `Module \`${wanted}\` is not loaded.`, ephemeral: true });
        const names = Array.from(module.definition?.commands || []).map(x => x.data?.name).filter(Boolean);
        return interaction.reply({ content: `**${module.name}**\nType: ${module.type}\nCommands: ${names.length ? names.map(x => `/${x}`).join(', ') : 'none'}`, ephemeral: true });
      }
      const text = [...client.modules.values()].map(m => `**${m.name}** • ${m.type}`).join('\n') || 'No modules loaded.';
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle(`${client.config.branding?.serverName || 'RealmsNetwork'} Bot`).setDescription(text.slice(0, 4000)).setFooter({ text: `${client.commands.size + client.contextMenus.size} commands • ${client.modules.size} modules` }).setColor(client.config.branding?.embedColor || '#8b5cf6')] });
    }
  },
  {
    data: new SlashCommandBuilder().setName('modules').setDescription('List loaded modules'),
    execute: async (interaction, client) => interaction.reply({ content: [...client.modules.keys()].map(x => `• \`${x}\``).join('\n') || 'None', ephemeral: true })
  },
  {
    data: new SlashCommandBuilder().setName('botstats').setDescription('Show runtime and command statistics'),
    execute: async (interaction, client) => {
      const uptime = Math.floor((Date.now() - client.metrics.startedAt) / 1000);
      return interaction.reply({ content: `Modules: **${client.modules.size}**\nCommands: **${client.commands.size + client.contextMenus.size}**\nExecutions: **${client.metrics.commands}**\nErrors: **${client.metrics.errors}**\nGuilds: **${client.guilds.cache.size}**\nUptime: **${uptime}s**\nPing: **${client.ws.ping}ms**`, ephemeral: true });
    }
  },
  {
    data: new SlashCommandBuilder().setName('reload').setDescription('Refresh command definitions'),
    requiredPermission: PermissionFlagsBits.ManageGuild,
    execute: async (interaction, client) => {
      await refreshCommands(client, client.config);
      return interaction.reply({ content: `Reloaded **${client.commands.size}** slash commands.`, ephemeral: true });
    }
  }
];

module.exports = { commands };
