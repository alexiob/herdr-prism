import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// ConPTY reconstructs screen contents rather than promising byte-for-byte VT
// passthrough. The saved original-screen sentinel must reappear after the actual
// entry leaves its alternate buffer. This wrapper never changes TTY properties,
// stdio methods, raw mode, or the application's arguments.
const [report,entry,...args]=process.argv.slice(2);
if(!report||!entry)throw Error('ConPTY bootstrap requires owned capability report and entry');
const evidence={stdinTTY:process.stdin.isTTY===true,stdoutTTY:process.stdout.isTTY===true,stderrTTY:process.stderr.isTTY===true,rawEnabled:false,rawRestored:false,exitCode:null};
const save=()=>writeFileSync(report,JSON.stringify(evidence));
save();
const observer=setInterval(()=>{if(!evidence.rawEnabled&&process.stdin.isRaw===true){evidence.rawEnabled=true;save();}},10);observer.unref();
process.on('exit',code=>{clearInterval(observer);evidence.rawRestored=evidence.rawEnabled&&process.stdin.isRaw===false;evidence.stdinDestroyed=process.stdin.destroyed===true;evidence.exitCode=code;save();});
process.stdout.write('\x1b[2J\x1b[HPRISM_SAVED_SCREEN');
// Let the real console render the main-buffer contents before the app starts.
await new Promise(resolve=>setTimeout(resolve,100));
process.argv=[process.execPath,entry,...args];
await import(pathToFileURL(entry).href);
