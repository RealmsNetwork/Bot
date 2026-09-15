const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const yaml=require('js-yaml');
const root=path.join(__dirname,'..');
function walk(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','data','cache','logs','runtime','backups'].includes(e.name))continue;const p=path.join(dir,e.name);e.isDirectory()?out.push(...walk(p)):out.push(p);}return out;}
let failed=0;
for(const file of walk(root)){
  if(file.endsWith('.js')){const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){failed++;console.error(r.stderr||`Syntax error: ${file}`);}}
  if(file.endsWith('.yml')||file.endsWith('.yaml')){try{yaml.load(fs.readFileSync(file,'utf8'));}catch(e){failed++;console.error(`YAML error: ${file}: ${e.message}`);}}
}
try{const cfg=yaml.load(fs.readFileSync(path.join(root,'config.example.yml'),'utf8'));if(cfg.version!==4||cfg.commands?.autoRefresh!==true||cfg.commands?.autoDeploy!==true)throw new Error('V4 command defaults are invalid');if(cfg.customModules?.allowInlineJS!==false)throw new Error('Inline JavaScript must be opt-in');if(cfg.database?.primary!=='sqlite')throw new Error('SQLite must be the default local database');if(cfg.sharding?.autoDetect!==false)throw new Error('Automatic shard detection must be opt-in');if(!/^0\.1\./.test(String(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version)))throw new Error('First public release must be v0.1.x');}catch(e){failed++;console.error(`[Root config] ${e.message}`);}
const moduleRoot=path.join(root,'modules');
if(fs.existsSync(moduleRoot))for(const e of fs.readdirSync(moduleRoot,{withFileTypes:true}).filter(x=>x.isDirectory())){const dir=path.join(moduleRoot,e.name);const configFile=path.join(dir,'config.yml');if(!fs.existsSync(configFile)){failed++;console.error(`Missing module config.yml: modules/${e.name}`);continue;}try{const cfg=yaml.load(fs.readFileSync(configFile,'utf8'))||{};if(Object.prototype.hasOwnProperty.call(cfg,'advanced')&&typeof cfg.advanced!=='boolean'){failed++;console.error(`Module advanced flag must be boolean when present: modules/${e.name}/config.yml`);}if(cfg.advanced===false&&fs.existsSync(path.join(dir,'advanced.yml')))console.warn(`advanced.yml exists while advanced=false: modules/${e.name}`);}catch(e){failed++;console.error(`Module config error: modules/${e.name}: ${e.message}`);}if(fs.existsSync(path.join(dir,'config.example.yml'))){failed++;console.error(`Obsolete module config.example.yml: modules/${e.name}`);}}
const customRoot=path.join(root,'custom-modules');
if(fs.existsSync(customRoot))for(const e of fs.readdirSync(customRoot,{withFileTypes:true}).filter(x=>x.isDirectory())){const dir=path.join(customRoot,e.name);if(!fs.existsSync(path.join(dir,'config.yml')))console.warn(`Custom module has no config.yml: custom-modules/${e.name}`);}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(!pkg.dependencies?.['better-sqlite3']){failed++;console.error('package.json is missing better-sqlite3');}
console.log(failed?`QC failed: ${failed} issue(s)`:'QC passed');
process.exitCode=failed?1:0;
