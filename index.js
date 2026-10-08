const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {banner,boot,ok,warn,error,install,info,rule}=require('./lib/logger');
const root=__dirname;
const envExample=path.join(root,'.env.example'),envFile=path.join(root,'.env');
const packageFile=path.join(root,'package.json');
let packageJson={};
try{if(fs.existsSync(packageFile))packageJson=JSON.parse(fs.readFileSync(packageFile,'utf8'));}catch(e){warn(`Could not read package.json: ${e.message}`);}
const version=packageJson.version||'unknown';
if(!fs.existsSync(envFile)&&fs.existsSync(envExample)){fs.copyFileSync(envExample,envFile);ok('Created .env from .env.example');}
const packages=new Map();
function packageName(spec){const value=String(spec).trim();if(value.startsWith('@')){const slash=value.indexOf('/');if(slash===-1)return value;const at=value.indexOf('@',slash);return at===-1?value:value.slice(0,slash+value.slice(slash+1).indexOf('@')+1);}return value.split('@')[0];}
function addPackage(spec,source='module'){if(!spec)return;const value=String(spec).trim();if(!value)return;const name=packageName(value);if(!name)return;if(!packages.has(name))packages.set(name,{spec:value,source});}
function addDependencies(value,source){if(Array.isArray(value))for(const spec of value)addPackage(spec,source);else if(value&&typeof value==='object')for(const[spec,dependencyVersion]of Object.entries(value))addPackage(spec,source);}
addDependencies(packageJson.dependencies,'required');
function resolveInstalled(name){try{require.resolve(name,{paths:[root]});return true;}catch{return false;}}
function installMissing(entries){if(!entries.length)return true;rule();install(`Installing ${entries.length} missing package(s)...`);for(const entry of entries)info(`${entry.spec} [${entry.source}]`);const npm=process.env.npm_execpath||'npm';const args=['install',...entries.map(e=>e.spec)];const result=spawnSync(npm,args,{stdio:'inherit',cwd:root,env:process.env});if(result.status!==0){error(`Dependency install failed with exit code ${result.status}`);return false;}return true;}
let requiredMissing=[];for(const[name,entry]of packages){if(resolveInstalled(name))ok(`${entry.spec} already installed`);else requiredMissing.push(entry);}if(!installMissing(requiredMissing))process.exit(1);
require('dotenv').config({quiet:true});
const {syncEnvSchema}=require('./lib/env-sync');
syncEnvSchema({root,envExample,envFile});
let yaml;try{yaml=require('js-yaml');}catch(e){error(`Required dependency js-yaml is unavailable: ${e.message}`);process.exit(1);}
let config;try{config=require('./lib/config').loadConfig();}catch(e){error(`Could not load config.yml: ${e.message}`);process.exit(1);}
const panelEnabled=config.adminPanel?.enabled===true||config.dashboard?.enabled===true;
if(panelEnabled){addPackage('@tailwindcss/cli@4.3.3','admin-panel');addPackage('tailwindcss@4.3.3','admin-panel');}
function moduleDirs(base){if(!fs.existsSync(base))return[];return fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(base,x.name));}
function readYaml(file){try{return yaml.load(fs.readFileSync(file,'utf8'))||{};}catch(e){warn(`Invalid YAML ${path.relative(root,file)}: ${e.message}`);return{};}
}
let enabledModules=0;
for(const dir of [...moduleDirs(path.join(root,'modules')),...moduleDirs(path.join(root,'custom-modules'))]){const name=path.basename(dir);const manifestFile=fs.existsSync(path.join(dir,'config.yml'))?path.join(dir,'config.yml'):path.join(dir,'module.yml');if(fs.existsSync(manifestFile)){const manifest=readYaml(manifestFile);const isEnabled=(manifest.enabled===true)||(config[name]?.enabled===true);if(isEnabled)enabledModules++;}}
if(config.database?.enabled===true){const provider=String(config.database.primary||'none').toLowerCase();if(provider==='sqlite')addPackage('better-sqlite3@13.0.3','database');if(provider==='mysql')addPackage('mysql2@3.2.5','database');if(provider==='postgres')addPackage('pg@8.16.0','database');if(provider==='mongodb')addPackage('mongodb@6.10.0','database');if(provider==='redis')addPackage('redis@5.0.0','database');}
const shardSetting=config.sharding?.enabled===true?(config.sharding?.auto===true?'auto':'on'):'off';
banner({version,node:process.version,platform:`${process.platform}/${process.arch}`,modules:`${enabledModules} enabled`,database:String(config.database?.enabled===true?config.database?.primary||'none':'none'),sharding:shardSetting});
boot(`Working directory: ${root}`);boot(`Process: ${process.pid} | ${process.execPath}`);boot(`Configuration: ${path.basename(path.join(root,'config.yml'))} | release ${config.release||'unknown'}`);boot(`Booting with ${enabledModules} enabled modules`);rule();
const missing=[];let already=0;for(const[name,entry]of packages){if(resolveInstalled(name)){already++;if(entry.source!=='required')ok(`${entry.spec} already installed`);}else missing.push(entry);}if(missing.length){error(`Missing dependencies: ${missing.map(x=>x.spec).join(', ')}`);process.exit(1);}ok('Dependency bootstrap complete');rule();
const {ShardingManager}=require('discord.js');
const {createShardCoordinator,discoverDiscordShards}=require('./lib/sharding');
let manager=null;
let shuttingDown=false;
function shutdownChildren(signal){if(shuttingDown)return;shuttingDown=true;if(manager?.respawn!==undefined)manager.respawn=false;const children=manager?.shards?Array.from(manager.shards.values()):[];for(const child of children)child.kill(signal||'SIGTERM');}
function shutdownSignal(signal){shutdownChildren(signal);setTimeout(()=>process.exit(signal==='SIGINT'?130:143),5000).unref?.();}
process.once('SIGINT',()=>shutdownSignal('SIGINT'));
process.once('SIGTERM',()=>shutdownSignal('SIGTERM'));
async function start(){
  const sharding=config.sharding||{};
  if(sharding.enabled===true){
    const token=process.env.DISCORD_TOKEN;
    if(!token)throw new Error('DISCORD_TOKEN is missing');
    const providerName=String(config.database?.primary||'none').toLowerCase();
    if(!['mongodb','redis','mysql','postgres'].includes(providerName)){
      error(`[Sharding] Invalid provider: ${providerName}. Requires mongodb, redis, mysql, or postgres.`);
      process.exit(1);
    }
    let total=0;
    try{total=await discoverDiscordShards(token);}catch(e){error(`[Sharding] Discord shard discovery failed: ${e.message}`);process.exit(1);}
    if(!Number.isInteger(total)||total<1){error(`[Sharding] Invalid shard count: ${total}`);process.exit(1);}
    console.log('[Shard Coordinator] Discovering Discord shard count...');
    console.log(`[Shard Coordinator] Discord recommended shards: ${total}`);
    console.log(`[Shard Coordinator] Provider: ${providerName}`);\n    let coordinator;
    try{coordinator=await createShardCoordinator(config,{instanceId:`${require('node:os').hostname()}-${process.pid}`});}catch(e){error(`[Sharding] Coordinator init failed: ${e.message}`);process.exit(1);}
    const active=await coordinator.getActiveShards();
    console.log(`[Shard Coordinator] Active shards: ${active.map((item)=>item.shardId).join(',') || 'none'}`);\n    const claimed=[];
    for(let shardId=0;shardId<total;shardId++){
      try{const okClaim=await coordinator.claimShard(shardId);if(okClaim)claimed.push(shardId);}catch(e){warn(`[Sharding] Failed to claim shard ${shardId}: ${e.message}`);}
    }
    console.log(`[Shard Coordinator] Claimed: ${claimed.join(',') || 'none'}`);\n    if(claimed.length===0){
      error(`[Sharding] No shards claimed. Check database connectivity.`);
      process.exit(1);
    }
    if(claimed.length<total){warn(`[Sharding] Claimed ${claimed.length}/${total} shards (others may be claimed by different instances).`);}
    try{
      const shardingConfig={token,totalShards:total};
      if(sharding.auto===true){shardingConfig.shardList='auto';}else{shardingConfig.shardList=claimed;}
      manager=new ShardingManager('./main.js',shardingConfig);
      manager.on('shardCreate',(shard)=>boot(`[BOOT] Launching shard ${shard.id}`));
      await manager.spawn({amount:Math.max(1,claimed.length)});
    }catch(e){error(`[Sharding] ShardingManager failed: ${e.message}`);process.exit(1);}
    return;
  }
  require('./main.js');
}
start().catch(e=>{error(`Start failed: ${e?.stack||e?.message||e}`);process.exit(1);});
