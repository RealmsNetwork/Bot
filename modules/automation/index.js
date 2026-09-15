const { Events } = require('discord.js');
async function initialize(client,config){const c=config.automation||{};if(c.responses&&typeof c.responses==='object'){client.on(Events.MessageCreate,async m=>{if(!m.guild||m.author.bot)return;for(const [trigger,response] of Object.entries(c.responses)){if(m.content.toLowerCase()===trigger.toLowerCase()){await m.channel.send(String(response)).catch(()=>{});break;}}});}}
module.exports={initialize};
