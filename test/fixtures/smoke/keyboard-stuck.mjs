// Deliberately broken interactive fixture: accepts Tab, ignores arrows and never voluntarily exits.
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('\x1b[?1049h[Overview]');
process.stdin.on('data',data=>{if(data.includes(9))process.stdout.write('\x1b[3;1H[Agents]');});
