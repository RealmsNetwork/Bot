const { EmbedBuilder } = require('discord.js');
async function initialize(client,config){client.on('guildMemberAdd',async m=>{const ch=m.guild.channels.cache.get(config.welcome?.channelId);if(!ch?.isTextBased())return;const text=(config.welcome.message||'Welcome {user} to {server}!').replaceAll('{user}',m.toString()).replaceAll('{server}',m.guild.name);await ch.send({embeds:[new EmbedBuilder().setDescription(text).setColor(config.branding.embedColor)]});});}
module.exports={initialize};
