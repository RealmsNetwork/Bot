// aichat.js
const {GoogleGenerativeAI}=require("@google/generative-ai");

let clientRef=null;
let configRef=null;
let model=null;
const cooldowns=new Map();

function cooldown(id,time){
let now=Date.now();
let last=cooldowns.get(id);
if(last&&(now-last)<time*1000)return true;
cooldowns.set(id,now);
return false;
}

function truncate(text,max){
if(!text)return "";
return text.length<=max?text:text.slice(0,max)+"…";
}

async function safeReply(message,text){
try{await message.reply(text)}catch(e){console.error("[AI Reply]",e.message)}
}

function startTyping(channel){
let stopped=false;
let timer=null;
async function send(){
if(stopped)return;
try{await channel.sendTyping()}catch(e){}
}
send();
timer=setInterval(send,5000);
return()=>{stopped=true;if(timer)clearInterval(timer)};
}

async function handleMessage(message){
try{
if(!configRef?.aichat)return;
if(message.author.bot)return;
if(message.partial)await message.fetch().catch(()=>{});
if(!message.guild)return;
if(configRef.guildId&&message.guild.id!==configRef.guildId)return;
if(message.channelId!==configRef.aichat.channelId)return;

let content=message.content?.trim();
if(!content)return;

let cd=configRef.aichat.cooldownSeconds||5;

if(cooldown(message.author.id,cd)){
await safeReply(message,`⏳ Please wait ${cd}s before sending another message.`);
return;
}

content=truncate(content,configRef.aichat.maxInputLength||2000);

let stop=startTyping(message.channel);

try{
let result=await model.generateContent(content);
let response=await result.response;
let reply=response.text();

if(!reply)reply=configRef.aichat.fallbackMessage||"⚠️ I couldn't generate a response.";

await safeReply(message,truncate(reply,2000));
}catch(e){
console.error("[AI Gemini]",e);
await safeReply(message,"⚠️ AI service is currently unavailable.");
}finally{
stop();
}
}catch(e){console.error("[AI Handler]",e)}
}

function registerEvents(){
try{
clientRef.on("messageCreate",async message=>{
await handleMessage(message);
});
}catch(e){console.error("[AI Events]",e)}
}

function initialize(client,config){
try{
let key=process.env.GEMINI_API_KEY;

if(!key){
console.warn("[AI] GEMINI_API_KEY missing, disabled");
return;
}

if(!config.aichat?.channelId){
console.warn("[AI] aichat.channelId missing, disabled");
return;
}

clientRef=client;
configRef=config;

let genAI=new GoogleGenerativeAI(key);

model=genAI.getGenerativeModel({
model:"gemini-1.5-flash"
});

registerEvents();

console.log("[AI] aichat module loaded");
}catch(e){
console.error("[AI Init]",e);
}
}

module.exports={initialize};
