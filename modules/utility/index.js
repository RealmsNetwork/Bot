const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('node:os');
const started = Date.now();
const cmd = (name, description, execute) => ({ data: new SlashCommandBuilder().setName(name).setDescription(description), execute });
const commands = [
  cmd('ping','Show bot latency',async i=>i.reply({content:`🏓 ${i.client.ws.ping}ms`})),
  cmd('uptime','Show process uptime',async i=>i.reply(`⏱️ ${Math.floor((Date.now()-started)/1000)}s`)),
  cmd('botinfo','Show bot information',async i=>i.reply({embeds:[new EmbedBuilder().setTitle('RealmsNetwork Bot').setColor(i.client.config.branding.embedColor).addFields({name:'Guilds',value:String(i.client.guilds.cache.size),inline:true},{name:'Commands',value:String(i.client.commands.size),inline:true},{name:'Node',value:process.version,inline:true})]})),
  cmd('userinfo','Show a member',async i=>{const u=i.options.getUser('user')||i.user;const m=i.guild?.members.cache.get(u.id);await i.reply({embeds:[new EmbedBuilder().setTitle(u.tag).setThumbnail(u.displayAvatarURL()).setDescription(m?`Joined: <t:${Math.floor(m.joinedTimestamp/1000)}:R>`:`ID: ${u.id}`).setColor(i.client.config.branding.embedColor)]})}),
  cmd('serverinfo','Show server information',async i=>i.reply({embeds:[new EmbedBuilder().setTitle(i.guild.name).setThumbnail(i.guild.iconURL()).setColor(i.client.config.branding.embedColor).addFields({name:'Members',value:String(i.guild.memberCount),inline:true},{name:'Channels',value:String(i.guild.channels.cache.size),inline:true},{name:'Roles',value:String(i.guild.roles.cache.size),inline:true})]})),
  cmd('avatar','Show a user's avatar',async i=>{const u=i.options.getUser('user')||i.user;await i.reply(u.displayAvatarURL({size:1024}))}),
  cmd('banner','Show a user's banner',async i=>{const u=await (i.options.getUser('user')||i.user).fetch();await i.reply(u.bannerURL({size:1024})||'No banner set.') }),
  cmd('membercount','Show member count',async i=>i.reply(`👥 ${i.guild.memberCount} members`)),
  cmd('channelinfo','Show current channel information',async i=>i.reply(`📺 <#${i.channelId}> • ${i.channel?.type}`)),
  cmd('roleinfo','Show a role',async i=>{const r=i.options.getRole('role');await i.reply(`${r} • ID: ${r.id} • ${r.members.size} members`)}),
  cmd('snowflake','Decode a Discord snowflake',async i=>{const id=i.options.getString('id',true);const ms=Number((BigInt(id)>>22n))+1420070400000;await i.reply(`<t:${Math.floor(ms/1000)}:F> • <t:${Math.floor(ms/1000)}:R>`)}),
  cmd('choose','Choose between options',async i=>{const text=i.options.getString('options',true);const values=text.split('|').map(x=>x.trim()).filter(Boolean);await i.reply(values.length?`🎯 ${values[Math.floor(Math.random()*values.length)]}`:'Give me options separated by `|`')}),
  cmd('roll','Roll a die',async i=>{const max=Math.max(2,Math.min(100000, i.options.getInteger('sides')||6));await i.reply(`🎲 ${1+Math.floor(Math.random()*max)} / ${max}`)}),
  cmd('coinflip','Flip a coin',async i=>i.reply(Math.random()<.5?'🪙 Heads':'🪙 Tails')),
  cmd('systeminfo','Show host statistics',async i=>i.reply(`CPU: ${os.cpus().length} cores\nRAM: ${(os.totalmem()/1073741824).toFixed(1)} GB\nLoad: ${os.loadavg().map(x=>x.toFixed(2)).join(' / ')}`))
];
for (const c of commands) {
  const opts = c.data.name === 'userinfo' || c.data.name === 'avatar' || c.data.name === 'banner' ? c.data.addUserOption(o=>o.setName('user').setDescription('User')) : c.data;
  if (c.data.name === 'roleinfo') c.data.addRoleOption(o=>o.setName('role').setDescription('Role').setRequired(true));
  if (c.data.name === 'snowflake') c.data.addStringOption(o=>o.setName('id').setDescription('Snowflake').setRequired(true));
  if (c.data.name === 'choose') c.data.addStringOption(o=>o.setName('options').setDescription('A|B|C').setRequired(true));
  if (c.data.name === 'roll') c.data.addIntegerOption(o=>o.setName('sides').setDescription('Sides').setMinValue(2).setMaxValue(100000));
}
module.exports = { commands };
