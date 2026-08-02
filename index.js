// index.js
const fs=require("fs");
const path=require("path");
const yaml=require("js-yaml");
const CONFIG_FILE=path.join(__dirname,"config.yml");
const CONFIG_EXAMPLE_FILE=path.join(__dirname,"config.example.yml");
const ENV_FILE=path.join(__dirname,".env");
const ENV_EXAMPLE_FILE=path.join(__dirname,".env.example");

function backup(file){
try{if(fs.existsSync(file))fs.copyFileSync(file,file+".backup."+Date.now())}catch(e){console.error("[Backup]",e.message)}
}
function safeWrite(file,data){
try{let tmp=file+".tmp";fs.writeFileSync(tmp,data,"utf8");fs.renameSync(tmp,file);return true}catch(e){console.error("[Write]",e.message);return false}
}
function merge(a,b){
if(!a||typeof a!=="object"||Array.isArray(a))a={};
for(let k of Object.keys(b)){
if(b[k]&&typeof b[k]==="object"&&!Array.isArray(b[k]))a[k]=merge(a[k],b[k]);
else if(!(k in a))a[k]=b[k];
}
return a;
}
function updateConfig(){
try{
if(!fs.existsSync(CONFIG_EXAMPLE_FILE))return;
let example;
try{example=yaml.load(fs.readFileSync(CONFIG_EXAMPLE_FILE,"utf8"))||{}}catch(e){console.error("[Config Example]",e.message);return}
if(!fs.existsSync(CONFIG_FILE)){safeWrite(CONFIG_FILE,yaml.dump(example,{noRefs:true,lineWidth:-1}));console.log("[Config] Created");return}
let current;
try{current=yaml.load(fs.readFileSync(CONFIG_FILE,"utf8"))||{}}catch(e){console.error("[Config] Invalid:",e.message);backup(CONFIG_FILE);return}
let old=current.version||0;
let ver=example.version||old;
if(old!==ver){
backup(CONFIG_FILE);
let updated=merge(current,example);
updated.version=ver;
safeWrite(CONFIG_FILE,yaml.dump(updated,{noRefs:true,lineWidth:-1}));
console.log(`[Config] Updated ${old}->${ver}`);
}
}catch(e){console.error("[Config Update]",e.message)}
}
function updateEnv(){
try{
if(!fs.existsSync(ENV_EXAMPLE_FILE))return;
if(!fs.existsSync(ENV_FILE)){fs.copyFileSync(ENV_EXAMPLE_FILE,ENV_FILE);console.log("[ENV] Created");return}
let current=fs.readFileSync(ENV_FILE,"utf8");
let example=fs.readFileSync(ENV_EXAMPLE_FILE,"utf8");
let keys=new Set();
for(let line of current.split("\n")){let x=line.trim();if(x&&!x.startsWith("#")&&x.includes("="))keys.add(x.split("=")[0].trim())}
let add=[];
for(let line of example.split("\n")){
let x=line.trim();
if(!x||x.startsWith("#")||!x.includes("="))continue;
let key=x.split("=")[0].trim();
if(!keys.has(key))add.push(line);
}
if(add.length){fs.appendFileSync(ENV_FILE,"\n"+add.join("\n")+"\n");console.log("[ENV] Added",add.length,"keys")}
}catch(e){console.error("[ENV Update]",e.message)}
}
updateConfig();
updateEnv();
require("dotenv").config();
const {Client,GatewayIntentBits,Partials}=require("discord.js");
let CONFIG;
try{CONFIG=yaml.load(fs.readFileSync(CONFIG_FILE,"utf8"))||{};console.log("[Config] Loaded")}catch(e){console.error("[Config Load]",e.message);process.exit(1)}
CONFIG.token=process.env.DISCORD_TOKEN;
if(!CONFIG.token){console.error("[Config] DISCORD_TOKEN missing");process.exit(1)}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildModeration,GatewayIntentBits.GuildMessageReactions,GatewayIntentBits.DirectMessages],partials:[Partials.Channel,Partials.Message,Partials.GuildMember,Partials.User]});
function loadModules(){
try{
let folder=path.join(__dirname,"modules");
if(!fs.existsSync(folder))return;
for(let dir of fs.readdirSync(folder,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name)){
let cfg=CONFIG[dir];
if(!cfg||cfg.enabled===false){console.log("[Modules] Skip",dir);continue}
let file=path.join(folder,dir,"index.js");
if(!fs.existsSync(file))continue;
try{let mod=require(file);if(typeof mod.initialize==="function"){mod.initialize(client,CONFIG);console.log("[Modules] Loaded",dir)}}catch(e){console.error("[Module]",dir,e)}
}
}catch(e){console.error("[Modules Loader]",e)}
}
loadModules();
module.exports={CONFIG,client};
if(require.main===module)client.login(CONFIG.token).then(()=>console.log("[Bot] Online")).catch(e=>console.error("[Login]",e));
process.on("unhandledRejection",e=>console.error("[Unhandled]",e));
process.on("uncaughtException",e=>console.error("[Crash]",e));
