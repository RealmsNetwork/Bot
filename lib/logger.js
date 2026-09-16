const C={reset:'\x1b[0m',bold:'\x1b[1m',dim:'\x1b[2m',black:'\x1b[30m',red:'\x1b[31m',green:'\x1b[32m',yellow:'\x1b[33m',blue:'\x1b[34m',magenta:'\x1b[35m',cyan:'\x1b[36m',white:'\x1b[37m',gray:'\x1b[90m'};
const colorEnabled=process.env.NO_COLOR==null;
const paint=(color,text)=>colorEnabled?`${color}${text}${C.reset}`:text;
function log(label,message,color=C.cyan){console.log(`${paint(color,`[${label}]`)} ${message}`);}
function ok(message){log('OK',message,C.green);}
function info(message){log('INFO',message,C.cyan);}
function boot(message){log('BOOT',message,C.blue);}
function install(message){log('INSTALL',message,C.magenta);}
function warn(message){log('WARN',message,C.yellow);}
function error(message){log('ERROR',message,C.red);}
function rule(char='─',length=76){console.log(paint(C.gray,char.repeat(length)));}
function banner({version='unknown',node=process.version,platform=`${process.platform}/${process.arch}`,modules='scanning',database='pending',shards='pending'}={}){
  const logo=[
    '████████████████',
    '██████████████████',
    '████████    ███████',
    '████████    ███████',
    '██████████████████',
    '████████████████',
    '████████    ███████',
    '████████     ██████',
    '████████      █████',
    '████████       ████',
    '████████        ███'
  ];
  const details=[
    paint(C.bold,paint(C.magenta,'REALMSNETWORK BOT')),
    `${paint(C.gray,'Version')}    ${version}`,
    `${paint(C.gray,'Runtime')}    ${node}`,
    `${paint(C.gray,'Platform')}   ${platform}`,
    `${paint(C.gray,'Modules')}    ${modules}`,
    `${paint(C.gray,'Database')}   ${database}`,
    `${paint(C.gray,'Shards')}     ${shards}`
  ];
  const width=76;
  console.log('');
  console.log(paint(C.magenta,`╭${'─'.repeat(width-2)}╮`));
  console.log(`${paint(C.magenta,'│')} ${paint(C.bold,C.white,'REALMSNETWORK')} ${paint(C.gray,'/')} ${paint(C.blue,'BOT')} ${' '.repeat(width-28)}${paint(C.magenta,'│')}`);
  console.log(paint(C.magenta,`├${'─'.repeat(width-2)}┤`));
  for(let i=0;i<logo.length;i++){
    const left=paint(C.black,'█')+paint(C.magenta,logo[i])+paint(C.black,'█');
    const text=details[i]||'';
    console.log(`${paint(C.magenta,'│')} ${left}  ${text}${' '.repeat(Math.max(1,width-3-logo[i].length-2-(i<details.length?String(details[i]).replace(/\x1b\[[0-9;]*m/g,'').length:0)))}${paint(C.magenta,'│')}`);
  }
  console.log(paint(C.magenta,`├${'─'.repeat(width-2)}┤`));
  console.log(`${paint(C.magenta,'│')} ${paint(C.blue,'◆')} ${paint(C.bold,C.blue,'By THEMPGUY')} ${paint(C.gray,'•')} ${paint(C.white,'RealmsNetwork')} ${paint(C.gray,'•')} ${paint(C.gray,'All rights reserved.')}${' '.repeat(24)}${paint(C.magenta,'│')}`);
  console.log(`${paint(C.magenta,'│')} ${paint(C.gray,'Starting your network. Stay legendary.')}${' '.repeat(41)}${paint(C.magenta,'│')}`);
  console.log(paint(C.magenta,`╰${'─'.repeat(width-2)}╯`));
  console.log('');
}
function section(title){console.log(`${paint(C.bold,C.magenta)}${title}${C.reset}`);}
module.exports={C,paint,log,ok,info,boot,install,warn,error,rule,banner,section};
