const fs=require('node:fs');
const path=require('node:path');
const yaml=require('js-yaml');
const root=path.join(__dirname,'..');
const configFile=path.join(root,'config.yml');
const exampleFile=path.join(root,'config.example.yml');
const moduleRoot=path.join(root,'modules');
function deepMerge(base,extra){const out={...(base||{})};for(const[key,value]of Object.entries(extra||{})){if(value&&typeof value==='object'&&!Array.isArray(value))out[key]=deepMerge(out[key],value);else out[key]=value;}return out;}
function backup(file){if(!fs.existsSync(file))return;const backup=`${file}.backup.${Date.now()}`;fs.copyFileSync(file,backup);console.log(`[Config] Backup created: ${path.basename(backup)}`);}
function write(file,data){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,data,'utf8');fs.renameSync(tmp,file);}
const legacyAliases={aichat:'ai',honeypot:'security',commandDeployment:'commands'};
function migrate(config){
  const next={...(config||{})};
  if(next.commandDeployment&&!next.commands)next.commands=next.commandDeployment;
  if(next.aichat&&!next.ai)next.ai=next.aichat;
  if(next.honeypot&&!next.security)next.security=next.honeypot;
  if(next.sharding && typeof next.sharding==='object'){
    const sharding=next.sharding;
    const legacy = sharding.totalShards!==undefined || sharding.shardList!==undefined || sharding.maxConcurrency!==undefined || sharding.autoDetect!==undefined;
    if(legacy){
      sharding.enabled = sharding.enabled !== false;
      sharding.auto = true;
      sharding.coordination = 'auto';
      sharding.heartbeatInterval = sharding.heartbeatInterval ?? 30000;
      sharding.timeout = sharding.timeout ?? 120000;
      delete sharding.totalShards;
      delete sharding.shardList;
      delete sharding.maxConcurrency;
      delete sharding.autoDetect;
    }
    next.sharding = sharding;
  }
  return next;
}
function migrateModuleConfigs(config){if(!fs.existsSync(moduleRoot))return false;let changed=false;for(const[oldName,newName]of Object.entries(legacyAliases)){const data=config[oldName];if(!data||typeof data!=='object')continue;const target=config[newName]||{};config[newName]=deepMerge(target,data);delete config[oldName];changed=true;}return changed;}
function loadConfig(){if(!fs.existsSync(configFile)){if(!fs.existsSync(exampleFile))throw new Error('config.example.yml is missing');fs.copyFileSync(exampleFile,configFile);console.log('[Config] Created config.yml from config.example.yml');}
const raw=fs.readFileSync(configFile,'utf8');
const config=raw.trim()?yaml.load(raw)||{}:{};
const migrated=migrate(config);
const dirty=JSON.stringify(migrated)!==JSON.stringify(config);
if(dirty){backup(configFile);write(configFile,yaml.dump(migrated,{lineWidth:-1}));console.log('[Config] Migrated config.yml to sharding-safe schema');}
return migrated;}
module.exports={loadConfig,migrate,deepMerge,migrateModuleConfigs};
