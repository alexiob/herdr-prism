import {writeFileSync} from 'node:fs';

// Only an explicitly supplied, disposable diagnostic report is written. No env,
// argv, terminal content, transcript, or user configuration enters the report.
const report=process.argv[2];
if(!report)throw Error('Console probe requires its owned report path');
const state={pid:process.pid,stdinTTY:process.stdin.isTTY===true,stdoutTTY:process.stdout.isTTY===true,stderrTTY:process.stderr.isTTY===true,rawModeMethod:typeof process.stdin.setRawMode,initialSize:[process.stdout.columns??null,process.stdout.rows??null],resizes:[],down:false,quit:false};
const save=()=>writeFileSync(report,JSON.stringify(state));
save();
if(!state.stdinTTY||!state.stdoutTTY||!state.stderrTTY||typeof process.stdin.setRawMode!=='function')process.exit(3);
process.stdin.setRawMode(true);state.rawEnabled=process.stdin.isRaw===true;save();
if(!state.rawEnabled)process.exit(4);
process.stdout.write('\x1b[?1049hCONSOLE_PROBE_READY');
process.stdout.on('resize',()=>{state.resizes.push([process.stdout.columns??null,process.stdout.rows??null]);state.resizes=state.resizes.slice(-4);save();});
process.stdin.on('data',data=>{
 if(data.includes(Buffer.from('\x1b[B'))){state.down=true;save();process.stdout.write('CONSOLE_PROBE_DOWN');}
 if(data.includes(113)){state.quit=true;process.stdin.setRawMode(false);state.rawRestored=process.stdin.isRaw===false;save();process.stdout.write('\x1b[?1049l');process.exit(0);}
});
process.stdin.resume();
