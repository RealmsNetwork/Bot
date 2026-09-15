const { SlashCommandBuilder } = require('discord.js');
const commands=[{data:new SlashCommandBuilder().setName('level').setDescription('Show your level'),async execute(i){const xp=await i.client.db.get(i.guildId,`xp:${i.user.id}`,0);const level=Math.floor(Math.sqrt(xp/100));await i.reply(`📈 ${i.user} • Level **${level}** • XP **${xp}**`);} }];
async function initialize(client){client.on('messageCreate',async m=>{if(!m.guild||m.author.bot)return;const now=Date.now();const last=client._xpCooldown?.get(m.author.id)||0;if(now-last<60000)return;client._xpCooldown??=new Map();client._xpCooldown.set(m.author.id,now);await client.db.increment(m.guild.id,`xp:${m.author.id}`,15+Math.floor(Math.random()*11));});}
module.exports={commands,initialize};
