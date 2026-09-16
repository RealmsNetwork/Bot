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
function packageName(spec){const value=String(spec).trim();if(value.startsWith('@')){const slash=value.indexOf('/');if(slash===-1)return value;const at=value.indexOf('@',slash);return at===-1?value:value.slice(0,at);}return value.split('@')[0].split(/[?#]/)[0];}
function addPackage(spec,source='module'){if(!spec)return;const value=String(spec).trim();if(!value)return;const name=packageName(value);if(!name)return;if(!packages.has(name))packages.set(name,{spec:value,source});}
function addDependencies(value,source){if(Array.isArray(value))for(const spec of value)addPackage(spec,source);else if(value&&typeof value==='object')for(const[spec,dependencyVersion]of Object.entries(value))addPackage(dependencyVersion?`${spec}@${dependencyVersion}`:spec,source);}
addDependencies(packageJson.dependencies,'required');
function resolveInstalled(name){try{require.resolve(name,{paths:[root]});return true;}catch{return false;}}
function installMissing(entries){if(!entries.length)return true;rule();install(`Installing ${entries.length} missing package(s)...`);for(const entry of entries)info(`${entry.spec} [${entry.source}]`);const npm=process.env.npm_execpath||'npm';const npmArgs=['install','--no-save','--no-package-lock','--no-audit','--no-fund',...entries.map(x=>x.spec)];const useNode=String(npm).endsWith('.js');const command=useNode?process.execPath:npm;const commandArgs=useNode?[npm,...npmArgs]:npmArgs;const result=spawnSync(command,commandArgs,{cwd:root,stdio:'inherit'});if(result.error){error(`Dependency installation could not start: ${result.error.message}`);return false;}if(result.status!==0){error(`Dependency installation failed with exit code ${result.status??'unknown'}`);return false;}for(const entry of entries)ok(`Installed ${entry.spec}`);return true;}
let requiredMissing=[];for(const[name,entry]of packages){if(resolveInstalled(name))ok(`${entry.spec} already installed`);else requiredMissing.push(entry);}if(!installMissing(requiredMissing))process.exit(1);
require('dotenv').config({quiet:true});
let yaml;try{yaml=require('js-yaml');}catch(e){error(`Required dependency js-yaml is unavailable: ${e.message}`);process.exit(1);}
let config;try{config=require('./lib/config').loadConfig();}catch(e){error(`Could not load config.yml: ${e.message}`);process.exit(1);}
function moduleDirs(base){if(!fs.existsSync(base))return[];return fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(base,x.name));}
function readYaml(file){try{return yaml.load(fs.readFileSync(file,'utf8'))||{};}catch(e){warn(`Invalid YAML ${path.relative(root,file)}: ${e.message}`);return{};}}
let enabledModules=0;
for(const dir of [...moduleDirs(path.join(root,'modules')),...moduleDirs(path.join(root,'custom-modules'))]){const name=path.basename(dir);const manifestFile=fs.existsSync(path.join(dir,'config.yml'))?path.join(dir,'config.yml'):path.join(dir,'module.yml');const manifest=fs.existsSync(manifestFile)?readYaml(manifestFile):{};const rootEnabled=config[name]?.enabled===true||(name==='dashboard'&&config.adminPanel?.enabled===true);if(!rootEnabled)continue;enabledModules++;addDependencies(manifest.dependencies,'module');if(manifest.advanced===true&&fs.existsSync(path.join(dir,'advanced.yml'))){const advanced=readYaml(path.join(dir,'advanced.yml'));addDependencies(advanced.module?.dependencies,'advanced');addDependencies(advanced.dependencies,'advanced');}}
if(config.database?.enabled===true){const provider=String(config.database.primary||'none').toLowerCase();if(provider==='sqlite')addPackage('better-sqlite3@13.0.3','database');if(provider==='mysql')addPackage('mysql2@3.24.4','database');if(provider==='postgres')addPackage('pg@8.23.0','database');if(provider==='mongodb')addPackage('mongodb@7.6.0','database');if(provider==='redis')addPackage('redis@6.2.1','database');}
const shardSetting=config.sharding?.enabled===true?(config.sharding?.totalShards==='auto'?'auto':String(config.sharding?.totalShards||1)):'off';
banner({version,node:process.version,platform:`${process.platform}/${process.arch}`,modules:`${enabledModules} enabled`,database:String(config.database?.enabled===true?config.database?.primary||'enabled':'disabled'),shards:shardSetting});
boot(`Working directory: ${root}`);boot(`Process: ${process.pid} | ${process.execPath}`);boot(`Configuration: ${path.basename(path.join(root,'config.yml'))} | release ${config.release||'unknown'}`);
const missing=[];let already=0;for(const[name,entry]of packages){if(resolveInstalled(name)){already++;if(entry.source!=='required')ok(`${entry.spec} already installed`);}else missing.push(entry);}if(!installMissing(missing))process.exit(1);info(`Dependencies: ${already} already present | ${missing.length} installed | ${packages.size} total`);
if(!process.env.DISCORD_TOKEN||process.env.DISCORD_TOKEN==='YOUR_BOT_TOKEN_HERE'){error('Set DISCORD_TOKEN in .env');process.exit(1);}ok('Dependency bootstrap complete');rule();
const {ShardingManager}=require('discord.js');
let manager=null;
let shuttingDown=false;
function shutdownChildren(signal){if(shuttingDown)return;shuttingDown=true;if(manager?.respawn!==undefined)manager.respawn=false;const children=manager?.shards?Array.from(manager.shards.values()):[];if(!children.length)return;boot(`Forwarding ${signal} to ${children.length} shard process(es)...`);for(const shard of children){try{if(shard.process&&!shard.process.killed)shard.process.kill(signal);else shard.kill();}catch(e){warn(`Could not stop shard #${shard.id}: ${e.message}`);}}}
function shutdownSignal(signal){shutdownChildren(signal);setTimeout(()=>process.exit(signal==='SIGINT'?130:143),5000).unref?.();}
process.once('SIGINT',()=>shutdownSignal('SIGINT'));
process.once('SIGTERM',()=>shutdownSignal('SIGTERM'));
async function recommendedShards(){const response=await fetch('https://discord.com/api/v10/gateway/bot',{headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`}});if(!response.ok)throw new Error(`Gateway discovery returned HTTP ${response.status}`);const body=await response.json();return Math.max(1,Number(body.shards||1));}
async function start(){const sharding=config.sharding||{};if(sharding.enabled===true){const remote=['redis','mongodb','mysql','postgres'].includes(String(config.database?.primary||'').toLowerCase());if((sharding.autoDetect===true||sharding.totalShards==='auto')&&!remote)throw new Error('Automatic shard detection requires a remote database: redis, mongodb, mysql, or postgres');let total=sharding.totalShards;if(sharding.autoDetect===true)total=await recommendedShards();if(total==null||total==='auto')total=1;boot(`Launching ${total} shard process(es)`);manager=new ShardingManager(path.join(root,'main.js'),{token:process.env.DISCORD_TOKEN,totalShards:total,shardList:Array.isArray(sharding.shardList)?sharding.shardList:undefined,respawn:sharding.respawn!==false,mode:'process'});manager.on('shardCreate',shard=>{ok(`Spawned shard #${shard.id}`);shard.on('death',process=>{if(shuttingDown)return;warn(`Shard #${shard.id} exited with code ${process.exitCode??'unknown'}`);});});await manager.spawn();return;}boot('Launching main process...');await require('./main').start();}
start().catch(e=>{error(`Start failed: ${e?.stack||e?.message||e}`);process.exit(1);});
