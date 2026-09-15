const { EmbedBuilder } = require('discord.js');
async function initialize(client,config){const c=config.notifications||{};client.on('guildMemberRemove',async m=>{if(!c.leaveChannelId)return;const ch=client.channels.cache.get(c.leaveChannelId);if(ch?.isTextBased())await ch.send({embeds:[new EmbedBuilder().setTitle('Member left').setDescription(`${m.user.tag} left the server.`).setColor(config.branding.embedColor)]}).catch(()=>{});});}
module.exports={initialize};
