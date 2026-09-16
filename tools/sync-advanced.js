const fs=require('node:fs');
const path=require('node:path');
const {ADVANCED_TEMPLATE}=require('../lib/module-loader');
const roots=[path.join(__dirname,'..','modules'),path.join(__dirname,'..','custom-modules')];
let created=0;
for(const root of roots){if(!fs.existsSync(root))continue;for(const entry of fs.readdirSync(root,{withFileTypes:true})){if(!entry.isDirectory())continue;const dir=path.join(root,entry.name),file=path.join(dir,'advanced.yml');if(!fs.existsSync(file)){fs.writeFileSync(file,ADVANCED_TEMPLATE,'utf8');created++;console.log(`[Advanced] Created ${path.relative(path.join(__dirname,'..'),file)}`);}}}
console.log(`[Advanced] ${created} file(s) created; existing files preserved.`);
