const fs=require('fs'),path=require('path'),cp=require('child_process');
const log=fs.openSync(path.join(__dirname,'gallery-test.log'),'w');
const child=cp.spawn(path.resolve(__dirname,'../../particle-editor-desktop/node_modules/electron/dist/electron.exe'),[path.join(__dirname,'gallery-smoke.cjs')],{windowsHide:true,stdio:['ignore',log,log]});
child.on('error',e=>{console.error(e);process.exitCode=1;});
child.on('exit',code=>{fs.closeSync(log);console.log('gallery test exit',code);process.exitCode=code||0;});
