const C={reset:'\x1b[0m',bold:'\x1b[1m',dim:'\x1b[2m',red:'\x1b[31m',green:'\x1b[32m',yellow:'\x1b[33m',blue:'\x1b[34m',magenta:'\x1b[35m',cyan:'\x1b[36m',white:'\x1b[37m',gray:'\x1b[90m'};
const colorEnabled=process.env.NO_COLOR==null;
const paint=(color,text)=>colorEnabled?`${color}${text}${C.reset}`:text;
function log(label,message,color=C.cyan){console.log(`${paint(color,`[${label}]`)} ${message}`);}
function ok(message){log('OK',message,C.green);}
function info(message){log('INFO',message,C.cyan);}
function boot(message){log('BOOT',message,C.blue);}
function install(message){log('INSTALL',message,C.magenta);}
function warn(message){log('WARN',message,C.yellow);}
function error(message){log('ERROR',message,C.red);}
function rule(){console.log(paint(C.gray,'─'.repeat(72)));}
function banner({version='unknown',node=process.version,platform=`${process.platform}/${process.arch}`,modules='-',database='-',shards='-'}={}){
  const logo=['  RRRR','  R   R','  RRRR','  R R','  R  RR'];
  const details=[
    `${paint(C.bold,'RealmsNetwork Bot')}`,
    `${paint(C.gray,'Version')}   ${version}`,
    `${paint(C.gray,'Node')}      ${node}`,
    `${paint(C.gray,'Platform')}  ${platform}`,
    `${paint(C.gray,'Modules')}   ${modules}`,
    `${paint(C.gray,'Database')}  ${database}`,
    `${paint(C.gray,'Shards')}    ${shards}`
  ];
  console.log('');
  for(let i=0;i<Math.max(logo.length,details.length);i++)console.log(`${paint(C.blue,(logo[i]||'').padEnd(10))} ${details[i]||''}`);
  console.log(`${paint(C.blue,'By THEMPGUY')} ${paint(C.gray,'(C) All rights reserved.')}`);
  rule();
}
function section(title){console.log(`${paint(C.bold,C.magenta)}${paint(C.bold,title)}${C.reset}`);}
module.exports={C,paint,log,ok,info,boot,install,warn,error,rule,banner,section};
