const { SlashCommandBuilder } = require('discord.js');
const make=(data,execute)=>({data,execute});
const commands=[
 make(new SlashCommandBuilder().setName('balance').setDescription('Show your balance').addUserOption(o=>o.setName('user').setDescription('User')),async i=>{const u=i.options.getUser('user')||i.user;const b=await i.client.db.get(i.guildId,`cash:${u.id}`,0);await i.reply(`💰 ${u.tag}: **${b}**`)}),
 make(new SlashCommandBuilder().setName('daily').setDescription('Claim daily coins'),async i=>{const k=`daily:${i.user.id}`,last=await i.client.db.get(i.guildId,k,0),now=Date.now();if(now-last<86400000)return i.reply({content:`⏳ Come back in ${Math.ceil((86400000-(now-last))/3600000)}h.`,ephemeral:true});await i.client.db.set(i.guildId,k,now);const b=await i.client.db.increment(i.guildId,`cash:${i.user.id}`,250);await i.reply(`🎁 +250 coins! Balance: **${b}**`)}),
 make(new SlashCommandBuilder().setName('work').setDescription('Work for coins'),async i=>{const b=await i.client.db.increment(i.guildId,`cash:${i.user.id}`,100+Math.floor(Math.random()*201));await i.reply(`💼 You worked. Balance: **${b}**`)}),
 make(new SlashCommandBuilder().setName('pay').setDescription('Pay another user').addUserOption(o=>o.setName('user').setDescription('User').setRequired(true)).addIntegerOption(o=>o.setName('amount').setDescription('Coins').setMinValue(1).setRequired(true)),async i=>{const u=i.options.getUser('user',true),n=i.options.getInteger('amount',true),b=await i.client.db.get(i.guildId,`cash:${i.user.id}`,0);if(b<n)return i.reply({content:'You cannot afford that.',ephemeral:true});await i.client.db.increment(i.guildId,`cash:${i.user.id}`,-n);await i.client.db.increment(i.guildId,`cash:${u.id}`,n);await i.reply(`💸 Paid **${n}** coins to ${u}.`)}),
 make(new SlashCommandBuilder().setName('economy').setDescription('Show economy backend'),async i=>i.reply(`💾 Storage: **${i.client.db.type}**`))
];
module.exports={commands};
