const fs=require('node:fs');
const path=require('node:path');
const yaml=require('js-yaml');
const {buildCommands,buildListeners,loadCustomModule}=require('./custom-dsl');
const root=path.join(__dirname,'..'),moduleRoot=path.join(root,'modules'),customRoot=path.join(root,'custom-modules');
const ADVANCED_TEMPLATE=`# RealmsNetwork Bot advanced module configuration
# This file is safe to edit independently from config.yml.
schemaVersion: 2
module:
  enabled: true
  mode: production
  environmentOverrides: {}
  failFast: false
  reloadable: true
  hotReloadListeners: false
  dependencies: []
  optionalDependencies: []
  featureFlags: {}
lifecycle:
  initialize: true
  ready: true
  destroy: true
  reload: true
  restartOnFailure: false
  restartLimit: 3
  restartWindowSeconds: 300
  startupTimeoutMs: 30000
  shutdownTimeoutMs: 15000
commands:
  enabled: true
  registerSlash: true
  registerContextMenus: true
  registerPrefix: true
  defaultCooldownSeconds: 0
  defaultPermissionGroup: everyone
  defaultPermissionKey: null
  defaultEphemeral: false
  deferReplies: false
  nsfw: false
  dmPermission: true
  deletePrefixTrigger: false
  aliases: {}
  disabled: []
  overrides: {}
prefix:
  enabled: false
  prefixes: []
  aliases: {}
  mentionPrefix: true
  caseSensitive: false
  stripWhitespace: true
  allowDM: false
  requireGuild: true
  errorMessage: inherit
permissions:
  mode: merge
  defaultGroup: everyone
  allowUsers: []
  denyUsers: []
  allowRoles: []
  denyRoles: []
  allowChannels: []
  denyChannels: []
  ownerBypass: inherit
  requireAdministrator: false
  commandPermissions: {}
  roleGroups:
    owner: []
    manager: []
    admin: []
    moderator: []
    helper: []
ui:
  enabled: true
  style: branded
  ephemeral: false
  compact: false
  embeds: true
  buttons: true
  selects: true
  modals: true
  timestamps: true
  color: inherit
  accentColor: inherit
  title: inherit
  footer: inherit
  footerIcon: inherit
  thumbnail: null
  image: null
  author: inherit
  showBranding: true
  showModuleName: false
  errorStyle: branded
  successStyle: branded
  pagination:
    enabled: true
    pageSize: 10
    timeoutSeconds: 120
responses:
  success: inherit
  error: inherit
  permissionDenied: inherit
  cooldown: inherit
  notFound: inherit
  noResults: inherit
  loading: inherit
  confirmation: inherit
  deleteAfterSeconds: 0
  mentionUser: true
embeds:
  defaults:
    color: inherit
    footer: inherit
    timestamp: true
  templates: {}
components:
  customIds: {}
  buttons: {}
  selects: {}
  modals: {}
  collectors:
    timeoutSeconds: 120
    idleSeconds: 0
listeners:
  enabled: true
  ignoreBots: true
  ignoreWebhooks: true
  ignoredChannels: []
  allowedChannels: []
  allowedRoles: []
  guildOnly: true
  eventOverrides: {}
rateLimits:
  enabled: true
  globalPerUser: 0
  globalPerGuild: 0
  globalPerChannel: 0
  commandPerUser: {}
  eventPerUser: {}
  burst: 1
  windowSeconds: 60
cooldowns:
  persistent: false
  scope: user
  defaultSeconds: 0
  commands: {}
  events: {}
scheduler:
  enabled: true
  timezone: UTC
  maxConcurrentJobs: 2
  catchUp: false
  jobs: {}
storage:
  namespace: inherit
  persistent: true
  cache: true
  cacheTtlSeconds: 300
  cacheMaxEntries: 1000
  compress: false
  encrypt: false
  indexes: []
cache:
  enabled: true
  ttlSeconds: 300
  maxEntries: 1000
  staleWhileRevalidate: false
http:
  enabled: true
  timeoutMs: 15000
  maxResponseBytes: 5242880
  retries: 2
  retryDelayMs: 500
  allowedHosts: []
  headers: {}
  userAgent: RealmsNetwork-Bot/0.2
webhooks:
  enabled: false
  urls: {}
  defaultHeaders: {}
  timeoutMs: 10000
  retries: 2
logging:
  enabled: true
  level: info
  audit: false
  commandExecutions: true
  eventExecutions: false
  errors: true
  metrics: true
  channelId: ""
  webhookUrl: ""
  includeUser: true
  includeGuild: true
  includeArguments: false
analytics:
  enabled: true
  commandUsage: true
  errors: true
  latency: true
  retentionDays: 30
health:
  enabled: true
  readiness: true
  liveness: true
  dependencyChecks: true
  intervalSeconds: 30
performance:
  maxConcurrent: 0
  maxActionsPerEvent: 1000
  maxLoopIterations: 1000
  maxWaitMs: 120000
  timeoutMs: 30000
  queueWhenBusy: true
  queueLimit: 100
security:
  allowInlineJS: false
  allowHTTP: true
  allowWebhooks: false
  allowEval: false
  allowFileSystem: false
  allowChildProcess: false
  allowedDomains: []
  redactSecrets: true
localization:
  enabled: true
  defaultLocale: en-US
  fallbackLocale: en-US
  locales: {}
branding:
  enabled: true
  inheritRoot: true
  serverName: inherit
  botName: inherit
  prefix: inherit
  color: inherit
  footer: inherit
  supportUrl: inherit
  iconUrl: inherit
  logoUrl: inherit
sharding:
  compatible: true
  shardLocalOnly: false
  aggregateMetrics: true
  leaderOnlyJobs: false
hooks:
  beforeCommand: []
  afterCommand: []
  onError: []
  onLoad: []
  onUnload: []
  onReady: []
overrides: {}
`;
function readYaml(file,fallback={}){try{return yaml.load(fs.readFileSync(file,'utf8'))||fallback;}catch(e){console.error(`[Config] Failed ${file}:`,e.message);return fallback;}}
function mergeDefaults(defaults,inherited){const out={...defaults,...(inherited||{})};for(const[key,value]of Object.entries(defaults||{}))if(value&&typeof value==='object'&&!Array.isArray(value)&&inherited?.[key]&&typeof inherited[key]==='object')out[key]=mergeDefaults(value,inherited[key]);return out;}
function ensureAdvanced(dir,enabled=true){const file=path.join(dir,'advanced.yml');if(enabled===true&&!fs.existsSync(file)){fs.writeFileSync(file,ADVANCED_TEMPLATE,'utf8');console.log(`[Config] Created ${file}`);}return enabled===true?readYaml(file,{}):{};}
function ensureModuleConfig(dir,inherited={}){const file=path.join(dir,'config.yml');const defaultsFile=path.join(dir,'defaults.yml');const defaults=fs.existsSync(defaultsFile)?readYaml(defaultsFile,{}):{};const localInherited={...inherited};delete localInherited.enabled;let config;if(fs.existsSync(file))config=readYaml(file,{advanced:false});else config={};const before=yaml.dump(config,{noRefs:true,lineWidth:-1});config=mergeDefaults(defaults,config);config=mergeDefaults(config,localInherited);if(Object.prototype.hasOwnProperty.call(config,'enabled'))delete config.enabled;if(typeof config.advanced!=='boolean')config.advanced=false;const after=yaml.dump(config,{noRefs:true,lineWidth:-1});if(!fs.existsSync(file)||before!==after){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,after,'utf8');console.log(`[Config] Synchronized ${file}${fs.existsSync(defaultsFile)?' with defaults':''}`);}const advancedFile=ensureAdvanced(dir,true);const advanced=config.advanced===true?advancedFile:{};return{config,advanced};}
function moduleFile(dir){return fs.existsSync(path.join(dir,'module.js'))?path.join(dir,'module.js'):path.join(dir,'index.js');}
function validCommand(x){return x?.data?.name&&typeof x.execute==='function';}
function commandConfig(name,advanced){return advanced?.commands?.overrides?.[name]||{};}
function applyCommandConfig(command,advanced){const o=commandConfig(command.data.name,advanced);if(o.enabled===false)return null;if(Number.isFinite(Number(o.cooldownSeconds)))command.cooldown=Math.max(0,Number(o.cooldownSeconds));if(o.permissionKey)command.permissionKey=String(o.permissionKey);if(o.permissionGroup)command.permissionGroup=String(o.permissionGroup);if(o.prefix===true)command.prefix=true;if(o.ephemeral===true)command.ephemeral=true;if(o.defer===true)command.defer=true;if(o.requireGuild===true)command.requireGuild=true;if(o.requireGuild===false)command.requireGuild=false;if(Array.isArray(o.botPermissions))command.botPermissions=o.botPermissions;else if(command.requiredPermission&&!command.botPermissions)command.botPermissions=[command.requiredPermission];if(o.nsfw===true)command.nsfw=true;return command;}
function addCommands(client,commands,advanced={}){for(const command of Array.isArray(commands)?commands:[]){if(!validCommand(command))continue;const configured=applyCommandConfig(command,advanced);if(configured)client.commands.set(configured.data.name,configured);}}
function addContextMenus(client,items){for(const item of Array.isArray(items)?items:[])if(validCommand(item))client.contextMenus.set(item.data.name,item);}
function rootModuleEnabled(name,rootConfig){if(name==='honeypot')return false;if(name==='security')return rootConfig.security?.enabled===true||rootConfig.honeypot?.enabled===true;if(name==='dashboard')return rootConfig.dashboard?.enabled===true||rootConfig.adminPanel?.enabled===true;return rootConfig[name]?.enabled===true;}
async function loadOne(client,name,dir,rootConfig,custom=false){const dsl=custom?loadCustomModule(dir):null;const inherited=name==='honeypot'&&rootConfig.security?.enabled!==true?rootConfig.honeypot||{}:rootConfig[name]||{};const result=ensureModuleConfig(dir,inherited);let moduleConfig=result.config;const advanced=result.advanced;if(name==='dashboard'&&rootConfig.adminPanel?.enabled===true)moduleConfig={...moduleConfig,...rootConfig.adminPanel};if(moduleConfig.enabled!==undefined)delete moduleConfig.enabled;if(!rootModuleEnabled(name,rootConfig))return false;try{if(dsl){addCommands(client,buildCommands(dsl),advanced);for(const listener of buildListeners(dsl))client.on(listener.event,(...args)=>listener.handle(...args));client.modules.set(name,{name,config:moduleConfig,advanced,definition:dsl,type:'yaml',dir});return true;}const file=moduleFile(dir);if(!fs.existsSync(file))return false;delete require.cache[require.resolve(file)];const mod=require(file),config={...rootConfig,[name]:moduleConfig};if(name==='security'&&rootConfig.honeypot?.enabled===true&&rootConfig.security?.enabled!==true)config.security=moduleConfig;if(typeof mod.initialize==='function')await mod.initialize(client,config,moduleConfig,advanced);addCommands(client,mod.commands,advanced);addContextMenus(client,mod.contextMenus);if(Array.isArray(mod.listeners))for(const listener of mod.listeners)if(listener?.event&&typeof listener.handle==='function')client.on(listener.event,(...args)=>listener.handle(...args,client));client.modules.set(name,{name,config:moduleConfig,advanced,definition:mod,type:'javascript',dir,file});return true;}catch(error){console.error(`[Module] Failed to load ${name}:`,error);if(advanced.lifecycle?.failFast)throw error;return false;}}
function moduleDirectories(base){if(!fs.existsSync(base))return[];return fs.readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>[x.name,path.join(base,x.name)]).sort((a,b)=>a[0].localeCompare(b[0]));}
async function loadCustomModules(client){if(client.config.customModules?.enabled===false)return;for(const[name,dir]of moduleDirectories(customRoot))await loadOne(client,name,dir,client.config,true);}
async function loadModules(client,config){for(const[name,dir]of moduleDirectories(moduleRoot))await loadOne(client,name,dir,config,false);await loadCustomModules(client);}
async function refreshCommands(client,config,silent=false){const next=new Map(),menus=new Map();for(const[name,dir]of[...moduleDirectories(moduleRoot),...moduleDirectories(customRoot)]){const dsl=loadCustomModule(dir),inherited=name==='honeypot'&&config.security?.enabled!==true?config.honeypot||{}:config[name]||{},result=ensureModuleConfig(dir,inherited),local=result.config,advanced=result.advanced;if(name==='dashboard'&&config.adminPanel?.enabled===true)Object.assign(local,config.adminPanel);if(Object.prototype.hasOwnProperty.call(local,'enabled'))delete local.enabled;if(!rootModuleEnabled(name,config))continue;if(dsl){addCommands({commands:next},buildCommands(dsl),advanced);continue;}const file=moduleFile(dir);if(!fs.existsSync(file))continue;try{delete require.cache[require.resolve(file)];const mod=require(file);addCommands({commands:next},mod.commands,advanced);addContextMenus({contextMenus:menus},mod.contextMenus);}catch(e){console.error(`[Commands] Failed refreshing ${name}:`,e.message);}}client.commands.clear();for(const[name,c]of next)client.commands.set(name,c);client.contextMenus.clear();for(const[name,c]of menus)client.contextMenus.set(name,c);if(!silent)console.log(`[Commands] Refreshed ${client.commands.size+client.contextMenus.size} local commands`);return client.commands;}
module.exports={ADVANCED_TEMPLATE,loadModules,loadCustomModules,refreshCommands,readYaml,ensureModuleConfig,ensureAdvanced,moduleDirectories};
