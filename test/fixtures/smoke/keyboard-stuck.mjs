// Deliberately broken interactive fixture: accepts Tab, ignores arrows and never voluntarily exits.
// Report handle capabilities only, so a broken console attachment cannot look like an arrow failure.
const consoleDiagnostic=`SMOKE_CONSOLE stdin=${process.stdin.isTTY===true} stdout=${process.stdout.isTTY===true} stderr=${process.stderr.isTTY===true} rawMode=${typeof process.stdin.setRawMode}`;
if(process.stdin.isTTY!==true||process.stdout.isTTY!==true||process.stderr.isTTY!==true||typeof process.stdin.setRawMode!=='function'){
 process.stderr.write(consoleDiagnostic+'\n');process.exit(1);
}
process.stdin.setRawMode(true);
if(process.stdin.isRaw!==true){process.stderr.write(consoleDiagnostic+' enabledRaw=false\n');process.exit(1);}
process.stdin.resume();
process.stdout.write('\x1b[?1049h[Overview]');
process.stdin.on('data',data=>{if(data.includes(9))process.stdout.write('\x1b[3;1H[Agents]');});
