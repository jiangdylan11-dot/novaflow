// Keep Windows GUI-process output and completion attached to the test runner.
const {spawn}=require('node:child_process');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(process.env.NOVAFLOW_TEST_ELECTRON||require('electron'),process.argv.slice(2),{env,windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
