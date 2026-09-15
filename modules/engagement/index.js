const { SlashCommandBuilder } = require('discord.js');
const store = new Map();

const afk = new SlashCommandBuilder().setName('afk').setDescription('Set or clear your AFK status').addStringOption(o=>o.setName('reason').setDescription('AFK reason'));
const tag = new SlashCommandBuilder().setName('tag').setDescription('Manage simple server tags').addSubcommand(s=>s.setName('get').setDescription('Get a tag').addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true))).addSubcommand(s=>s.setName('set').setDescription('Set a tag').addStringOption(o=>o.setName('name').setDescription('Tag name').setRequired(true)).addStringOption(o=>o.setName('content').setDescription('Tag content').setRequired(true)));
const commands=[
 {data:afk,execute:async(i)=>{const reason=i.options.getString('reason')||'AFK';store.set(i.user.id,{reason,time:Date.now()});await i.reply(`💤 AFK enabled: **${reason}**`)}},
 {data:tag,permission:8n,execute:async(i,client)=>{const sub=i.options.getSubcommand();const name=i.options.getString('name',true).toLowerCase();const key=`tag:${i.guildId}:${name}`;if(sub==='get'){const v=await client.db.get(i.guildId,key,null);return i.reply(v?`🏷️ **${name}**\n${v}`:'Tag not found.')}const content=i.options.getString('content',true).slice(0,4000);await client.db.set(i.guildId,key,content);await i.reply(`✅ Saved **${name}**.`)}}
];
async function initialize(client){client.on('messageCreate',async m=>{if(!m.guild||m.author.bot)return;const state=store.get(m.author.id);if(state){store.delete(m.author.id);await m.reply(`Welcome back! You were AFK for ${Math.round((Date.now()-state.time)/60000)}m.`).catch(()=>{})}for(const user of m.mentions.users.values()){const s=store.get(user.id);if(s)await m.reply(`💤 ${user} is AFK: ${s.reason}`).catch(()=>{})}})}
module.exports={initialize,commands};
