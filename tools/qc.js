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
try{const cfg=yaml.load(fs.readFileSync(path.join(root,'config.example.yml'),'utf8'));if(cfg.version!==3||cfg.commands?.autoRefresh!==true||cfg.commands?.autoDeploy!==true)throw new Error('V3 command defaults are invalid');if(cfg.customModules?.allowInlineJS!==false)throw new Error('Inline JavaScript must be opt-in');}catch(e){failed++;console.error(`[Root config] ${e.message}`);}
const moduleRoot=path.join(root,'modules');
if(fs.existsSync(moduleRoot))for(const e of fs.readdirSync(moduleRoot,{withFileTypes:true}).filter(x=>x.isDirectory())){const dir=path.join(moduleRoot,e.name);const config=path.join(dir,'config.yml');if(!fs.existsSync(config)){failed++;console.error(`Missing module config.yml: modules/${e.name}`);}if(fs.existsSync(path.join(dir,'config.example.yml'))){failed++;console.error(`Obsolete module config.example.yml: modules/${e.name}`);}}
const customRoot=path.join(root,'custom-modules');
if(fs.existsSync(customRoot))for(const e of fs.readdirSync(customRoot,{withFileTypes:true}).filter(x=>x.isDirectory())){const dir=path.join(customRoot,e.name);if(!fs.existsSync(path.join(dir,'config.yml')))console.warn(`Custom module has no config.yml: custom-modules/${e.name}`);}
console.log(failed?`QC failed: ${failed} issue(s)`:'QC passed');
process.exitCode=failed?1:0;
