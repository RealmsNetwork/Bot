const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
function walk(dir) { const out=[]; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { if (['node_modules','.git','data','cache'].includes(e.name)) continue; const p=path.join(dir,e.name); e.isDirectory()?out.push(...walk(p)):out.push(p); } return out; }
let failed=0;
for (const file of walk(root)) {
  if (file.endsWith('.js')) { const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'}); if(r.status!==0){failed++;console.error(r.stderr||`Syntax error: ${file}`);} }
  if (file.endsWith('.yml')||file.endsWith('.yaml')) { try{yaml.load(fs.readFileSync(file,'utf8'));}catch(e){failed++;console.error(`YAML error: ${file}: ${e.message}`);} }
}
try { const cfg=yaml.load(fs.readFileSync(path.join(root,'config.example.yml'),'utf8')); if(cfg.version!==3||cfg.commands?.autoRefresh!==true) throw new Error('V3 config defaults are invalid'); } catch(e){ failed++; console.error(`[Config] ${e.message}`); }
console.log(failed ? `QC failed: ${failed} issue(s)` : 'QC passed');
process.exitCode=failed?1:0;
