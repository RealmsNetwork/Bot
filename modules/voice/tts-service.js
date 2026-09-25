const { createHash } = require('node:crypto');
const { EdgeTTS } = require('node-edge-tts');

const TRUSTED_CLIENT_TOKEN='6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION='143.0.3650.75';
const VOICE_LIST_URL='https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken='+TRUSTED_CLIENT_TOKEN;
const cache={at:0,voices:[]};

function secMsGec(){
  const ticks=BigInt(Math.floor(Date.now()/1000)+11644473600)*10000000n;
  const rounded=ticks-(ticks%3000000000n);
  return createHash('sha256').update(String(rounded)+TRUSTED_CLIENT_TOKEN,'ascii').digest('hex').toUpperCase();
}

async function listVoices(force=false){
  if(!force&&cache.voices.length&&Date.now()-cache.at<21600000)return cache.voices;
  const url=VOICE_LIST_URL+'&Sec-MS-GEC='+secMsGec()+'&Sec-MS-GEC-Version=1-'+CHROMIUM_FULL_VERSION;
  const r=await fetch(url,{headers:{
    Accept:'*/*',
    'Accept-Language':'en-US,en;q=0.9',
    'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+CHROMIUM_FULL_VERSION.split('.')[0]+'.0.0.0 Safari/537.36 Edg/'+CHROMIUM_FULL_VERSION.split('.')[0]+'.0.0.0'
  }});
  if(!r.ok)throw new Error('Edge voices API HTTP '+r.status);
  const data=await r.json();
  cache.voices=Array.isArray(data)?data.filter(v=>v?.ShortName||v?.Name):[];
  cache.at=Date.now();
  return cache.voices;
}

function languageList(voices){
  const map=new Map();
  for(const v of voices||[]){
    const locale=String(v.Locale||'').trim();
    const code=locale.split('-')[0].toLowerCase();
    if(!code)continue;
    if(!map.has(code))map.set(code,{code,name:code.toUpperCase(),locales:new Set()});
    map.get(code).locales.add(locale);
  }
  return [...map.values()].map(x=>({...x,locales:[...x.locales].sort()})).sort((a,b)=>a.code.localeCompare(b.code));
}

function rateValue(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n===100)return 'default';
  return (n>100?'+':'')+(n-100)+'%';
}

function volumeValue(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n===100)return 'default';
  return (n>100?'+':'')+(n-100)+'%';
}

async function synthesize(text,file,settings={}){
  const voice=settings.voice||'en-US-AriaNeural';
  const lang=settings.lang||voice.match(/^[a-z]{2,3}-[A-Z]{2}/)?.[0]||'en-US';
  const tts=new EdgeTTS({
    voice,
    lang,
    outputFormat:settings.outputFormat||'audio-24khz-96kbitrate-mono-mp3',
    saveSubtitles:settings.saveSubtitles===true,
    rate:rateValue(settings.rate),
    pitch:settings.pitch||'default',
    volume:volumeValue(settings.volume),
    timeout:Math.max(5000,Number(settings.timeout||15000))
  });
  await tts.ttsPromise(String(text),file);
  return file;
}

module.exports={listVoices,languageList,synthesize,rateValue,volumeValue};
