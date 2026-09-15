const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const yaml=require('js-yaml');
const root=__dirname;
const envExample=path.join(root,'.env.example'),envFile=path.join(root,'.env');
if(!fs.existsSync(envFile)&&fs.existsSync(envExample)){fs.copyFileSync(envExample,envFile);console.log('[Bootstrap] Created .env');}
require('dotenv').config({quiet:true});
const exampleConfig=path.join(root,'config.example.yml'),configFile=path.join(root,'config.yml');
if(!fs.existsSync(configFile)&&fs.existsSync(exampleConfig)){fs.copyFileSync(exampleConfig,configFile);console.log('[Bootstrap] Created config.yml');}
const config=yaml.load(fs.readFileSync(configFile,'utf8'))||{};
const packages=new Set(['discord.js@14.27.0','dotenv@17.4.2','js-yaml@4.1.0']);
if(config.database?.enabled){const provider=String(config.database.primary||'none').toLowerCase();if(provider==='sqlite')packages.add('better-sqlite3@13.0.3');if(provider==='mysql')packages.add('mysql2@3.24.4');if(provider==='postgres')packages.add('pg@8.23.0');if(provider==='mongodb')packages.add('mongodb@7.6.0');if(provider==='redis')packages.add('redis@6.2.1');}
function moduleDirs(base){if(!fs.existsSync(base))return[];return fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(base,x.name));}
function readManifest(dir){for(const file of [path.join(dir,'config.yml'),path.join(dir,'module.yml')]){if(!fs.existsSync(file))continue;try{return yaml.load(fs.readFileSync(file,'utf8'))||{};}catch(e){console.warn(`[Bootstrap] Invalid module config ${file}: ${e.message}`);}}return{};}
for(const dir of [...moduleDirs(path.join(root,'modules')), ...moduleDirs(path.join(root,'custom-modules'))]){const manifest=readManifest(dir);for(const spec of (Array.isArray(manifest.dependencies)?manifest.dependencies:[]))packages.add(String(spec));}
function packageName(spec){if(!spec.startsWith('@'))return spec.split('@')[0];const slash=spec.indexOf('/');const at=spec.indexOf('@',slash);return at===-1?spec:spec.slice(0,at);}
function ensurePackage(spec){try{require.resolve(packageName(spec));return true;}catch{}console.log(`[Bootstrap] Installing ${spec}`);const npm=process.env.npm_execpath||'npm';const args=['install','--no-audit','--no-fund','--save-exact',spec];const command=process.platform==='win32'&&npm.endsWith('.js')?process.execPath:npm;const commandArgs=process.platform==='win32'&&npm.endsWith('.js')?[npm,...args]:args;const result=spawnSync(command,commandArgs,{cwd:root,stdio:'inherit'});return result.status===0;}
for(const pkg of packages)if(!ensurePackage(pkg)){console.error(`[Bootstrap] Required dependency unavailable: ${pkg}`);process.exit(1);}
if(!process.env.DISCORD_TOKEN||process.env.DISCORD_TOKEN==='YOUR_BOT_TOKEN_HERE'){console.error('[Bootstrap] Set DISCORD_TOKEN in .env');process.exit(1);}
const {ShardingManager}=require('discord.js');
async function recommendedShards(){const response=await fetch('https://discord.com/api/v10/gateway/bot',{headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`}});if(!response.ok)throw new Error(`Gateway discovery returned HTTP ${response.status}`);const body=await response.json();return Math.max(1,Number(body.shards||1));}
async function start(){const sharding=config.sharding||{};if(sharding.enabled===true){const remote=['redis','mongodb','mysql','postgres'].includes(String(config.database?.primary||'').toLowerCase());let total=sharding.totalShards;if(sharding.autoDetect===true){if(!remote)throw new Error('sharding.autoDetect requires a remote database: redis, mongodb, mysql, or postgres');total=await recommendedShards();console.log(`[Shard] Discord recommended ${total} shard(s); remote database mode confirmed.`);}if(total==='auto'||total==null)total='auto';const manager=new ShardingManager(path.join(root,'main.js'),{token:process.env.DISCORD_TOKEN,totalShards:total,shardList:Array.isArray(sharding.shardList)?sharding.shardList:undefined,respawn:sharding.respawn!==false,mode:'process'});manager.on('shardCreate',shard=>console.log(`[Shard] Spawned #${shard.id}`));await manager.spawn();return;}await require('./main').start();}
start().catch(e=>{console.error('[Bootstrap] Start failed:',e);process.exit(1);});
