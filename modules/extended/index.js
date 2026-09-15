const { SlashCommandBuilder } = require('discord.js');
const make=(n,d,build,run)=>{const b=new SlashCommandBuilder().setName(n).setDescription(d);build?.(b);return {data:b,execute:run};};
const s=(i,n)=>i.options.getString(n,true);
const num=(i,n)=>i.options.getNumber(n,true);
const commands=[
make('uppercase','Uppercase text',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').toUpperCase())),
make('lowercase','Lowercase text',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').toLowerCase())),
make('length','Count characters',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(`🔢 ${s(i,'text').length} characters`)),
make('wordcount','Count words',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(`🔤 ${s(i,'text').trim().split(/\s+/).filter(Boolean).length} words`)),
make('trim','Trim whitespace',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').trim())),
make('repeat','Repeat text',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addIntegerOption(o=>o.setName('times').setDescription('Times').setMinValue(1).setMaxValue(20).setRequired(true)),i=>i.reply(s(i,'text').repeat(i.options.getInteger('times',true)).slice(0,1900))),
make('reversewords','Reverse word order',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').trim().split(/\s+/).reverse().join(' '))),
make('base64','Encode Base64',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(Buffer.from(s(i,'text')).toString('base64'))),
make('unbase64','Decode Base64',b=>b.addStringOption(o=>o.setName('text').setDescription('Base64').setRequired(true)),i=>{try{i.reply(Buffer.from(s(i,'text'),'base64').toString('utf8').slice(0,1900))}catch{ i.reply('Invalid Base64.')}}),
make('add','Add numbers',b=>b.addNumberOption(o=>o.setName('a').setDescription('A').setRequired(true)).addNumberOption(o=>o.setName('b').setDescription('B').setRequired(true)),i=>i.reply(String(num(i,'a')+num(i,'b')))),
make('subtract','Subtract numbers',b=>b.addNumberOption(o=>o.setName('a').setDescription('A').setRequired(true)).addNumberOption(o=>o.setName('b').setDescription('B').setRequired(true)),i=>i.reply(String(num(i,'a')-num(i,'b')))),
make('multiply','Multiply numbers',b=>b.addNumberOption(o=>o.setName('a').setDescription('A').setRequired(true)).addNumberOption(o=>o.setName('b').setDescription('B').setRequired(true)),i=>i.reply(String(num(i,'a')*num(i,'b')))),
make('divide','Divide numbers',b=>b.addNumberOption(o=>o.setName('a').setDescription('A').setRequired(true)).addNumberOption(o=>o.setName('b').setDescription('B').setRequired(true)),i=>{const b2=num(i,'b');i.reply(b2===0?'Cannot divide by zero.':String(num(i,'a')/b2))}),
make('percent','Calculate percentage',b=>b.addNumberOption(o=>o.setName('value').setDescription('Value').setRequired(true)).addNumberOption(o=>o.setName('percent').setDescription('Percent').setRequired(true)),i=>i.reply(String(num(i,'value')*num(i,'percent')/100))),
make('timestamp','Current Discord timestamp',null,i=>i.reply(`<t:${Math.floor(Date.now()/1000)}:F>`)),
make('uuid','Generate an ID',null,i=>i.reply(require('node:crypto').randomUUID())),
make('mock','MoCk SoMe TeXt',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply([...s(i,'text')].map((c,n)=>n%2?c.toLowerCase():c.toUpperCase()).join(''))),
make('clap','Add claps between words',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').trim().split(/\s+/).join(' 👏 '))),
make('quote','Wrap text as a quote',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(`> ${s(i,'text')}`)),
make('binary','Encode binary',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply([...s(i,'text')].map(c=>c.charCodeAt(0).toString(2).padStart(8,'0')).join(' '))),
make('hex','Encode hexadecimal',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(Buffer.from(s(i,'text')).toString('hex'))),
make('charcode','Show character codes',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply([...s(i,'text')].map(c=>c.charCodeAt(0)).join(', '))),
make('slice','Slice text',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addIntegerOption(o=>o.setName('start').setDescription('Start').setRequired(true)).addIntegerOption(o=>o.setName('end').setDescription('End').setRequired(true)),i=>i.reply(s(i,'text').slice(i.options.getInteger('start',true),i.options.getInteger('end',true)))),
make('replace','Replace text',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addStringOption(o=>o.setName('from').setDescription('From').setRequired(true)).addStringOption(o=>o.setName('to').setDescription('To').setRequired(true)),i=>i.reply(s(i,'text').split(s(i,'from')).join(s(i,'to')).slice(0,1900))),
make('sort','Sort words',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').trim().split(/\s+/).sort((a,b)=>a.localeCompare(b)).join(' '))),
make('dedupe','Remove duplicate words',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply([...new Set(s(i,'text').trim().split(/\s+/))].join(' '))),
make('vowels','Count vowels',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(`🅰️ ${((s(i,'text').match(/[aeiou]/gi)||[]).length)} vowels`)),
make('palindrome','Check palindrome',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>{const x=s(i,'text').toLowerCase().replace(/[^a-z0-9]/g,'');i.reply(x===x.split('').reverse().join('')?'✅ Palindrome':'❌ Not a palindrome')}),
make('randomcase','Randomize letter case',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply([...s(i,'text')].map(c=>Math.random()<.5?c.toLowerCase():c.toUpperCase()).join(''))),
make('emoji','Turn spaces into emoji',b=>b.addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)),i=>i.reply(s(i,'text').trim().split(/\s+/).join(' 🟣 '))),
make('progress','Show a progress bar',b=>b.addIntegerOption(o=>o.setName('value').setDescription('0-100').setMinValue(0).setMaxValue(100).setRequired(true)),i=>{const n=i.options.getInteger('value',true),full=Math.round(n/10);i.reply(`[${'█'.repeat(full)}${'░'.repeat(10-full)}] ${n}%`)}),
make('color','Generate a random color',null,i=>i.reply(`#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`))
];
module.exports={commands};
