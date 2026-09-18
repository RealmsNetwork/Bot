const { SlashCommandBuilder } = require('discord.js');
const commands=[
{data:new SlashCommandBuilder().setName('server').setDescription('Show server facts'),async execute(i){await i.reply(`🏠 **${i.guild.name}**\nMembers: ${i.guild.memberCount}\nBoosts: ${i.guild.premiumSubscriptionCount||0}\nCreated: <t:${Math.floor(i.guild.createdTimestamp/1000)}:D>`)}},
{data:new SlashCommandBuilder().setName('icon').setDescription('Show server icon'),async execute(i){await i.reply(i.guild.iconURL({size:1024})||'No server icon.') }},
{data:new SlashCommandBuilder().setName('invite').setDescription('Create an invite for this channel'),permission:require('discord.js').PermissionFlagsBits.CreateInstantInvite,requiredPermission:require('discord.js').PermissionFlagsBits.CreateInstantInvite,botPermissions:[require('discord.js').PermissionFlagsBits.CreateInstantInvite],async execute(i){if(!i.channel.createInvite)return i.reply({content:'Invites are not supported here.',ephemeral:true});const inv=await i.channel.createInvite({maxAge:3600,maxUses:0,reason:'Bot invite command'});await i.reply(`🔗 ${inv.url}`)}},
{data:new SlashCommandBuilder().setName('channels').setDescription('Show channel counts'),async execute(i){const m={};for(const c of i.guild.channels.cache.values())m[c.type]=(m[c.type]||0)+1;await i.reply(Object.entries(m).map(([k,v])=>`${k}: ${v}`).join('\n'))}},
{data:new SlashCommandBuilder().setName('roles').setDescription('Show role count'),async execute(i){await i.reply(`🎭 ${i.guild.roles.cache.size} roles`)}}
];module.exports={commands};
