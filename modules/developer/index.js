const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const commands=[
{data:new SlashCommandBuilder().setName('modules').setDescription('List loaded commands'),permission:PermissionFlagsBits.ManageGuild,async execute(i){await i.reply(`📦 Loaded commands: **${i.client.commands.size}**`)}},
{data:new SlashCommandBuilder().setName('dbstatus').setDescription('Show database backend'),permission:PermissionFlagsBits.ManageGuild,async execute(i){await i.reply(`🗄️ Database: **${i.client.db.type}**`)}},
{data:new SlashCommandBuilder().setName('reload-config').setDescription('Reload configuration'),permission:PermissionFlagsBits.ManageGuild,async execute(i){await i.reply({content:'Restart the bot to apply module configuration changes.',ephemeral:true})}},
{data:new SlashCommandBuilder().setName('eval').setDescription('Developer evaluation').addStringOption(o=>o.setName('code').setDescription('JavaScript').setRequired(true)),permission:PermissionFlagsBits.Administrator,async execute(i){if(i.user.id!==i.client.config.developer?.ownerId)return i.reply({content:'Developer only.',ephemeral:true});let out;try{out=await eval(i.options.getString('code',true));}catch(e){out=e.stack||e.message}await i.reply({content:`\`\`\`js\n${String(out).slice(0,1900)}\n\`\`\``,ephemeral:true})}}
];module.exports={commands};
