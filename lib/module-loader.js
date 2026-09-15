const fs=require('node:fs');
const path=require('node:path');
const yaml=require('js-yaml');
const {buildCommands,buildListeners,loadCustomModule}=require('./custom-dsl');
const root=path.join(__dirname,'..'),moduleRoot=path.join(root,'modules'),customRoot=path.join(root,'custom-modules');
const ADVANCED_TEMPLATE=`# RealmsNetwork module advanced configuration
# Generated when advanced: true in config.yml. This file is safe to edit.
schemaVersion: 1

lifecycle:
  enabled: true
  failFast: false
  reloadable: true
commands:
  enabled: true
  defaultCooldownSeconds: 0
  overrides: {}
prefix:
  enabled: false
  aliases: []
  mentionPrefix: true
permissions:
  defaultGroup: everyone
  allowUsers: []
  denyUsers: []
  allowRoles: []
  denyRoles: []
  allowChannels: []
  denyChannels: []
  requireAdministrator: false
ui:
  enabled: true
  ephemeral: false
  embed: true
  color: inherit
  title: inherit
  footer: inherit
  timestamp: true
  compact: false
logging:
  enabled: true
  level: info
  audit: false
  errors: true
  metrics: true
events:
  enabled: true
  ignoreBots: true
  ignoreWebhooks: true
  ignoredChannels: []
  ignoredRoles: []
limits:
  maxConcurrent: 0
  maxActionsPerEvent: 250
  maxLoopIterations: 100
  maxWaitMs: 30000
  timeoutMs: 15000
storage:
  namespace: inherit
  cache: true
  cacheTtlSeconds: 300
scheduler:
  enabled: true
  timezone: UTC
  maxConcurrentJobs: 2
webhooks:
  enabled: false
  urls: {}
overrides: {}
`;
function readYaml(file,fallback={}){try{return yaml.load(fs.readFileSync(file,'utf8'))||fallback;}catch(e){console.error(`[Config] Failed ${file}:`,e.message);return fallback;}}
function mergeDefaults(defaults,inherited){const out={...defaults,...(inherited||{})};for(const[key,value]of Object.entries(defaults||{}))if(value&&typeof value==='object'&&!Array.isArray(value)&&inherited?.[key]&&typeof inherited[key]==='object')out[key]=mergeDefaults(value,inherited[key]);return out;}
function ensureAdvanced(dir,enabled){const file=path.join(dir,'advanced.yml');if(enabled===true&&!fs.existsSync(file)){fs.writeFileSync(file,ADVANCED_TEMPLATE,'utf8');console.log(`[Config] Created ${file}`);}return enabled===true?readYaml(file,{}):{};}
function ensureModuleConfig(dir,inherited={}){const file=path.join(dir,'config.yml');let config;if(!fs.existsSync(file)){config=mergeDefaults({enabled:false,advanced:false},inherited);fs.writeFileSync(file,yaml.dump(config,{noRefs:true,lineWidth:-1}),'utf8');console.log(`[Config] Created ${file}`);}else config=readYaml(file,{enabled:false,advanced:false});if(typeof config.advanced!=='boolean'){config.advanced=false;fs.writeFileSync(file,yaml.dump(config,{noRefs:true,lineWidth:-1}),'utf8');}const advanced=ensureAdvanced(dir,config.advanced===true);return{config,advanced};}
function moduleFile(dir){return fs.existsSync(path.join(dir,'module.js'))?path.join(dir,'module.js'):path.join(dir,'index.js');}
function validCommand(x){return x?.data?.name&&typeof x.execute==='function';}
function commandConfig(name,advanced){return advanced?.commands?.overrides?.[name]||{};}
function applyCommandConfig(command,advanced){const o=commandConfig(command.data.name,advanced);if(o.enabled===false)return null;if(Number.isFinite(Number(o.cooldownSeconds)))command.cooldown=Math.max(0,Number(o.cooldownSeconds));if(o.permissionKey)command.permissionKey=String(o.permissionKey);if(o.permissionGroup)command.permissionGroup=String(o.permissionGroup);if(o.prefix===true)command.prefix=true;return command;}
function addCommands(client,commands,advanced={}){for(const command of Array.isArray(commands)?commands:[]){if(!validCommand(command))continue;const configured=applyCommandConfig(command,advanced);if(configured)client.commands.set(configured.data.name,configured);}}
function addContextMenus(client,items){for(const item of Array.isArray(items)?items:[])if(validCommand(item))client.contextMenus.set(item.data.name,item);}
async function loadOne(client,name,dir,rootConfig,custom=false){const dsl=custom?loadCustomModule(dir):null;const result=ensureModuleConfig(dir,rootConfig[name]||{});let moduleConfig=result.config;const advanced=result.advanced;if(name==='dashboard'&&rootConfig.adminPanel?.enabled===true)moduleConfig={...moduleConfig,...rootConfig.adminPanel,enabled:true};if(custom&&dsl?.enabled===true)moduleConfig.enabled=true;if(moduleConfig.enabled!==true)return false;try{if(dsl){addCommands(client,buildCommands(dsl),advanced);for(const listener of buildListeners(dsl))client.on(listener.event,(...args)=>listener.handle(...args));client.modules.set(name,{name,config:moduleConfig,advanced,definition:dsl,type:'yaml',dir});return true;}const file=moduleFile(dir);if(!fs.existsSync(file))return false;delete require.cache[require.resolve(file)];const mod=require(file),config={...rootConfig,[name]:moduleConfig};if(typeof mod.initialize==='function')await mod.initialize(client,config,moduleConfig,advanced);addCommands(client,mod.commands,advanced);addContextMenus(client,mod.contextMenus);if(Array.isArray(mod.listeners))for(const listener of mod.listeners)if(listener?.event&&typeof listener.handle==='function')client.on(listener.event,(...args)=>listener.handle(...args,client));client.modules.set(name,{name,config:moduleConfig,advanced,definition:mod,type:'javascript',dir,file});return true;}catch(error){console.error(`[Module] Failed to load ${name}:`,error);if(advanced.lifecycle?.failFast)throw error;return false;}}
function moduleDirectories(base){if(!fs.existsSync(base))return[];return fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>[x.name,path.join(base,x.name)]).sort((a,b)=>a[0].localeCompare(b[0]));}
async function loadCustomModules(client){if(client.config.customModules?.enabled===false)return;for(const[name,dir]of moduleDirectories(customRoot))await loadOne(client,name,dir,client.config,true);}
async function loadModules(client,config){for(const[name,dir]of moduleDirectories(moduleRoot))await loadOne(client,name,dir,config,false);await loadCustomModules(client);}
async function refreshCommands(client,config,silent=false){const next=new Map(),menus=new Map();for(const[name,dir]of[...moduleDirectories(moduleRoot),...moduleDirectories(customRoot)]){const dsl=loadCustomModule(dir),result=ensureModuleConfig(dir,config[name]||{}),local=result.config,advanced=result.advanced;if(name==='dashboard'&&config.adminPanel?.enabled===true)local.enabled=true;if(dsl?.enabled===true)local.enabled=true;if(local.enabled!==true)continue;if(dsl){addCommands({commands:next},buildCommands(dsl),advanced);continue;}const file=moduleFile(dir);if(!fs.existsSync(file))continue;try{delete require.cache[require.resolve(file)];const mod=require(file);addCommands({commands:next},mod.commands,advanced);addContextMenus({contextMenus:menus},mod.contextMenus);}catch(e){console.error(`[Commands] Failed refreshing ${name}:`,e.message);}}client.commands.clear();for(const[name,c]of next)client.commands.set(name,c);client.contextMenus.clear();for(const[name,c]of menus)client.contextMenus.set(name,c);if(!silent)console.log(`[Commands] Refreshed ${client.commands.size+client.contextMenus.size} local commands`);return client.commands;}
module.exports={loadModules,loadCustomModules,refreshCommands,readYaml,ensureModuleConfig,moduleDirectories};
