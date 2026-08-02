// index.js
const fs=require("fs");
const path=require("path");
const yaml=require("js-yaml");
const CONFIG_PATH=path.join(__dirname,"config.yml");
const CONFIG_EXAMPLE=path.join(__dirname,"config.example.yml");
const ENV_PATH=path.join(__dirname,".env");
const ENV_EXAMPLE=path.join(__dirname,".env.example");

function safeWrite(file,data){
try{const tmp=file+".tmp";fs.writeFileSync(tmp,data,"utf8");fs.renameSync(tmp,file);return true}catch(e){console.error("[Write]",e.message);return false}
}

function backup(file){
try{if(fs.existsSync(file))fs.copyFileSync(file,file+".backup."+Date.now())}catch(e){console.error("[Backup]",e.message)}
}

function merge(a,b){
if(!a||typeof a!=="object"||Array.isArray(a))a={};
for(const k of Object.keys(b)){
if(b[k]&&typeof b[k]==="object"&&!Array.isArray(b[k]))a[k]=merge(a[k],b[k]);
else if(!(k in a))a[k]=b[k];
}
return a;
}

function updateConfig(){
try{
if(!fs.existsSync(CONFIG_EXAMPLE)){console.log("[Config] Missing config.example.yml");return}
let example=yaml.load(fs.readFileSync(CONFIG_EXAMPLE,"utf8"))||{};
if(!fs.existsSync(CONFIG)){safeWrite(CONFIG,yaml.dump(example,{noRefs:true}));console.log("[Config] Created config.yml");return}
let current;
try{current=yaml.load(fs.readFileSync(CONFIG,"utf8"))||{}}catch(e){console.error("[Config] Invalid yaml:",e.message);backup(CONFIG);return}
let old=current.version||0;
let ver=example.version||old;
if(old!==ver){
backup(CONFIG);
let updated=merge(current,example);
updated.version=ver;
safeWrite(CONFIG,yaml.dump(updated,{noRefs:true,lineWidth:-1}));
console.log(`[Config] Updated ${old}->${ver}`);
}
}catch(e){console.error("[Config] Update failed:",e.message)}
}

function updateEnv(){
try{
if(!fs.existsSync(ENV_EXAMPLE)){console.log("[ENV] Missing .env.example");return}
if(!fs.existsSync(ENV)){fs.copyFileSync(ENV_EXAMPLE,ENV);console.log("[ENV] Created .env");return}
let current=fs.readFileSync(ENV,"utf8");
let example=fs.readFileSync(ENV_EXAMPLE,"utf8");
let keys=new Set();
for(let line of current.split("\n")){
line=line.trim();
if(line&&!line.startsWith("#")&&line.includes("="))keys.add(line.split("=")[0].trim());
}
let add=[];
for(let line of example.split("\n")){
let clean=line.trim();
if(!clean||clean.startsWith("#")||!clean.includes("="))continue;
let key=clean.split("=")[0].trim();
if(!keys.has(key))add.push(line);
}
if(add.length){fs.appendFileSync(ENV,"\n"+add.join("\n")+"\n");console.log("[ENV] Added missing keys")}
}catch(e){console.error("[ENV] Update failed:",e.message)}
}

updateConfig();
updateEnv();
require("dotenv").config();

const {Client,GatewayIntentBits,Partials}=require("discord.js");

let CONFIG;
try{CONFIG=yaml.load(fs.readFileSync(CONFIG_PATH,"utf8"));console.log("[Config] Loaded successfully")}catch(e){console.error("[Config] Load failed:",e.message);process.exit(1)}

CONFIG.token=process.env.DISCORD_TOKEN;
if(!CONFIG.token){console.error("[Config] DISCORD_TOKEN missing");process.exit(1)}

const client=new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildModeration,
GatewayIntentBits.GuildMessageReactions,
GatewayIntentBits.DirectMessages
],
partials:[
Partials.Channel,
Partials.Message,
Partials.GuildMember,
Partials.User
]
});

function loadModules(){
try{
const modulesPath=path.join(__dirname,"modules");
if(!fs.existsSync(modulesPath)){console.log("[Modules] No modules folder");return}
const folders=fs.readdirSync(modulesPath,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name);
for(const name of folders){
const modConfig=CONFIG[name];
if(!modConfig||modConfig.enabled===false){console.log(`[Modules] Skip ${name}`);continue}
const file=path.join(modulesPath,name,"index.js");
if(!fs.existsSync(file)){console.warn(`[Modules] Missing ${file}`);continue}
try{
const mod=require(file);
if(typeof mod.initialize==="function"){mod.initialize(client,CONFIG);console.log(`[Modules] Loaded ${name}`)}
}catch(e){console.error(`[Modules] ${name} failed:`,e)}
}
}catch(e){console.error("[Modules] Loader failed:",e)}
}

loadModules();

module.exports={CONFIG,client};

if(require.main===module){
client.login(CONFIG.token).then(()=>console.log("[Bot] Online")).catch(e=>console.error("[Bot] Login failed:",e));
}

process.on("unhandledRejection",e=>console.error("[Unhandled]",e));
process.on("uncaughtException",e=>console.error("[Crash]",e));
