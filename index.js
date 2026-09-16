const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const yaml=require('js-yaml');
const root=__dirname;
const envExample=path.join(root,'.env.example'),envFile=path.join(root,'.env');
const C={reset:'\x1b[0m',bold:'\x1b[1m',dim:'\x1b[2m',red:'\x1b[31m',green:'\x1b[32m',yellow:'\x1b[33m',blue:'\x1b[34m',magenta:'\x1b[35m',cyan:'\x1b[36m',gray:'\x1b[90m'};
const log=(label,message,color=C.cyan)=>console.log(`${color}[${label}]${C.reset} ${message}`);
const ok=message=>log('OK',message,C.green);
const warn=message=>log('WARN',message,C.yellow);
const fail=message=>log('ERROR',message,C.red);
const rule=()=>console.log(`${C.gray}${'─'.repeat(72)}${C.reset}`);
console.log(`${C.bold}${C.magenta}╭────────────────────────────────────────────────────────────────────────╮${C.reset}`);
console.log(`${C.bold}${C.magenta}│${C.reset} ${C.bold}${C.blue}RealmsNetwork Bot Bootstrap${C.reset} ${C.gray}v0.2.0${C.reset}${' '.repeat(32)}${C.bold}${C.magenta}│${C.reset}`);
console.log(`${C.bold}${C.magenta}╰────────────────────────────────────────────────────────────────────────╯${C.reset}`);
console.log(`${C.blue}By THEMPGUY${C.reset} ${C.gray}(C) All rights reserved.${C.reset}`);
rule();
if(!fs.existsSync(envFile)&&fs.existsSync(envExample)){fs.copyFileSync(envExample,envFile);ok('Created .env from .env.example');}
require('dotenv').config({quiet:true});
const exampleConfig=path.join(root,'config.example.yml'),configFile=path.join(root,'config.yml');
if(!fs.existsSync(configFile)&&fs.existsSync(exampleConfig)){fs.copyFileSync(exampleConfig,configFile);ok('Created config.yml from config.example.yml');}
const config=yaml.load(fs.readFileSync(configFile,'utf8'))||{};
const packages=new Map();
function addPackage(spec,source='core'){if(!spec)return;const value=String(spec).trim();if(!value)return;const name=packageName(value);if(!packages.has(name))packages.set(name,{spec:value,source});}
function packageName(spec){if(spec.startsWith('@')){const slash=spec.indexOf('/');const at=spec.indexOf('@',slash);return at===-1?spec:spec.slice(0,at);}return spec.split('@')[0];}
if(fs.existsSync(path.join(root,'package.json'))){try{const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));for(const[name,version]of Object.entries(packageJson.dependencies||{}))addPackage(`${name}@${version}`,'required');}catch(e){warn(`Could not read package.json dependencies: ${e.message}`);}}
if(config.database?.enabled){const provider=String(config.database.primary||'none').toLowerCase();if(provider==='sqlite')addPackage('better-sqlite3@13.0.3','database');if(provider==='mysql')addPackage('mysql2@3.24.4','database');if(provider==='postgres')addPackage('pg@8.23.0','database');if(provider==='mongodb')addPackage('mongodb@7.6.0','database');if(provider==='redis')addPackage('redis@6.2.1','database');}
function moduleDirs(base){if(!fs.existsSync(base))return[];return fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>path.join(base,x.name));}
function readManifest(dir){for(const file of [path.join(dir,'config.yml'),path.join(dir,'module.yml')]){if(!fs.existsSync(file))continue;try{return yaml.load(fs.readFileSync(file,'utf8'))||{};}catch(e){warn(`Invalid module config ${file}: ${e.message}`);}}return{};}
function enabledManifest(manifest){return manifest.enabled===true||manifest.module?.enabled===true;}
let enabledModules=0,enabledDependencies=0;
for(const dir of [...moduleDirs(path.join(root,'modules')),...moduleDirs(path.join(root,'custom-modules'))]){const manifest=readManifest(dir);if(!enabledManifest(manifest))continue;enabledModules++;const dependencies=Array.isArray(manifest.dependencies)?manifest.dependencies:[];for(const spec of dependencies){addPackage(spec,'module');enabledDependencies++;}}
log('BOOT',`Node ${process.version} | ${process.platform}/${process.arch}`);
log('BOOT',`${enabledModules} enabled module(s) | ${enabledDependencies} module dependency declaration(s)`);
log('BOOT',`${packages.size} dependency package(s) required by this configuration`);
function ensurePackage(name,entry){try{require.resolve(name,{paths:[root]});ok(`${entry.source.padEnd(8)} ${entry.spec} already installed`);return true;}catch{}}
function installPackage(entry){log('INSTALL',`${entry.spec} ${C.gray}(${entry.source})${C.reset}`,C.blue);const npm=process.env.npm_execpath||'npm';const args=['install','--no-audit','--no-fund','--save-exact',entry.spec];const command=process.platform==='win32'&&npm.endsWith('.js')?process.execPath:npm;const commandArgs=process.platform==='win32'&&npm.endsWith('.js')?[npm,...args]:args;const result=spawnSync(command,commandArgs,{cwd:root,stdio:'inherit'});if(result.status===0){ok(`Installed ${entry.spec}`);return true;}fail(`Failed to install ${entry.spec}`);return false;}
let installed=0,already=0;
for(const[name,entry]of packages){if(ensurePackage(name,entry)){already++;continue;}if(!installPackage(entry))process.exit(1);installed++;}
log('DEPS',`${already} already present | ${installed} installed | ${packages.size} total`,C.cyan);
if(!process.env.DISCORD_TOKEN||process.env.DISCORD_TOKEN==='YOUR_BOT_TOKEN_HERE'){fail('Set DISCORD_TOKEN in .env');process.exit(1);}
ok('Dependency bootstrap complete');
rule();
const {ShardingManager}=require('discord.js');
async function recommendedShards(){const response=await fetch('https://discord.com/api/v10/gateway/bot',{headers:{Authorization:`Bot ${process.env.DISCORD_TOKEN}`}});if(!response.ok)throw new Error(`Gateway discovery returned HTTP ${response.status}`);const body=await response.json();return Math.max(1,Number(body.shards||1));}
async function start(){const sharding=config.sharding||{};if(sharding.enabled===true){const remote=['redis','mongodb','mysql','postgres'].includes(String(config.database?.primary||'').toLowerCase());if((sharding.autoDetect===true||sharding.totalShards==='auto')&&!remote)throw new Error('Automatic shard detection requires a remote database: redis, mongodb, mysql, or postgres');let total=sharding.totalShards;if(sharding.autoDetect===true)total=await recommendedShards();if(total==null||total==='auto')total=1;log('SHARD',`Launching ${total} shard process(es)`,C.magenta);const manager=new ShardingManager(path.join(root,'main.js'),{token:process.env.DISCORD_TOKEN,totalShards:total,shardList:Array.isArray(sharding.shardList)?sharding.shardList:undefined,respawn:sharding.respawn!==false,mode:'process'});manager.on('shardCreate',shard=>ok(`Spawned shard #${shard.id}`));await manager.spawn();return;}log('START','Launching main process...',C.blue);await require('./main').start();}
start().catch(e=>{fail(`Start failed: ${e?.stack||e?.message||e}`);process.exit(1);});
