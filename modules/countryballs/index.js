const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const BALLS = ['United States','Canada','Mexico','Brazil','Argentina','United Kingdom','France','Germany','Italy','Spain','Japan','South Korea','China','Australia','India','Egypt','South Africa','Nigeria','Turkey','Poland'];
const rarity = name => { const n = BALLS.indexOf(name); if (n < 3) return 'Legendary'; if (n < 8) return 'Epic'; if (n < 14) return 'Rare'; return 'Common'; };

async function profile(db, guildId, userId) { return db.get(guildId, `balls:${userId}`, { coins: 0, collection: {} }); }
async function initialize(client) { client.countryballs = { balls: BALLS, profile }; }

const roll = new SlashCommandBuilder().setName('ball').setDescription('Countryballs').addSubcommand(s=>s.setName('roll').setDescription('Roll a Countryball'))
  .addSubcommand(s=>s.setName('profile').setDescription('View your collection'))
  .addSubcommand(s=>s.setName('dex').setDescription('View the full ball dex'))
  .addSubcommand(s=>s.setName('leaderboard').setDescription('View collectors leaderboard'));
const commands = [{ data: roll, execute: async (i, client) => {
  const sub=i.options.getSubcommand(); const db=i.client.db; const p=await profile(db,i.guildId,i.user.id);
  if(sub==='roll'){ const ball=BALLS[Math.floor(Math.random()*BALLS.length)]; p.collection[ball]=(p.collection[ball]||0)+1; p.coins=Math.max(0,p.coins-10); await db.set(i.guildId,`balls:${i.user.id}`,p); return i.reply({embeds:[new EmbedBuilder().setColor(client.config.branding.embedColor).setTitle('🌎 Countryball Roll').setDescription(`You rolled **${ball}**\nRarity: **${rarity(ball)}**\nCopies: **${p.collection[ball]}**`).setFooter({text:'10 coins per roll'})]}); }
  if(sub==='profile'){ const entries=Object.entries(p.collection).sort((a,b)=>b[1]-a[1]); return i.reply(`🌎 ${i.user} owns **${entries.reduce((n,[,v])=>n+v,0)}** balls across **${entries.length}** countries.\n${entries.slice(0,15).map(([k,v])=>`• ${k}: ${v}`).join('\n')||'No balls yet.'}`); }
  if(sub==='dex') return i.reply(`🌎 **Countryball Dex (${BALLS.length})**\n${BALLS.map(x=>`${rarity(x)==='Legendary'?'🟡':rarity(x)==='Epic'?'🟣':rarity(x)==='Rare'?'🔵':'⚪'} ${x}`).join('\n')}`);
  return i.reply('🌎 Leaderboards are stored through the configured persistence backend and can be extended with scheduled rankings.');
}}];
module.exports={initialize,commands};
