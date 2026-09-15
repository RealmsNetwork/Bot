require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { loadConfig } = require('./lib/config');
const { loadModules } = require('./lib/module-loader');
const { Collection, Client, GatewayIntentBits } = require('discord.js');
(async()=>{
  if(!process.env.DISCORD_TOKEN||!process.env.DISCORD_CLIENT_ID)throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
  const config=loadConfig(),client=new Client({intents:[GatewayIntentBits.Guilds]});client.config=config;client.commands=new Collection();
  await loadModules(client,config);
  const body=[...client.commands.values()].map(c=>c.data.toJSON());
  const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
  const route=config.commandDeployment?.guildOnly&&config.guildId?Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID,config.guildId):Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route,{body});console.log(`Deployed ${body.length} commands.`);await client.destroy();
})().catch(e=>{console.error(e);process.exit(1);});
