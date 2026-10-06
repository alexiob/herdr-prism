import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const exec=promisify(execFile);
test('ConPTY bootstrap preserves entry argv and real pipe capabilities without fabricating TTY or raw mode',async t=>{
 const directory=await mkdtemp(resolve(tmpdir(),'prism-console-bootstrap-'));t.after(()=>rm(directory,{recursive:true,force:true}));const entry=resolve(directory,'entry.mjs'),report=resolve(directory,'report.json');
 await writeFile(entry,"process.stdout.write('FIXTURE_ARGV '+JSON.stringify(process.argv.slice(1)));\n");
 const {stdout}=await exec(process.execPath,['scripts/smoke/conpty-bootstrap.mjs',report,entry,'fixture-argument'],{timeout:3000});assert.match(stdout,/PRISM_SAVED_SCREEN/);assert.ok(stdout.endsWith('FIXTURE_ARGV '+JSON.stringify([entry,'fixture-argument'])));
 const evidence=JSON.parse(await readFile(report,'utf8'));assert.equal(evidence.stdinTTY,false);assert.equal(evidence.stdoutTTY,false);assert.equal(evidence.rawEnabled,false);assert.equal(evidence.rawRestored,false);assert.equal(evidence.exitCode,0);
});
test('raw-keyboard fixture fails closed with console-handle diagnostics when launched through pipes',async()=>{
 await assert.rejects(exec(process.execPath,[resolve('test/fixtures/smoke/keyboard-stuck.mjs')],{timeout:3000}),(error:any)=>{
  assert.equal(error.code,1);assert.match(error.stderr,/SMOKE_CONSOLE stdin=false stdout=false stderr=false rawMode=undefined/);
  assert.doesNotMatch(error.stderr,/TypeError|setRawMode is not a function/);return true;
 });
});
test('terminal smoke rejects a one-shot stdout renderer instead of accepting it as PTY interaction',async()=>{
 await assert.rejects(exec(process.execPath,['scripts/smoke.mjs','--entry',resolve('test/fixtures/smoke/noninteractive.mjs')],{timeout:15000}),(error:any)=>{assert.match(error.stderr,/terminal smoke failed/i);assert.doesNotMatch(error.stderr,/MODULE_NOT_FOUND/);return true;});
});
test('required terminal smoke records real resize, keyboard and clean exit evidence',{skip:process.env.HAT_PTY_TESTS!=='1',timeout:30000},async()=>{
 const {stdout}=await exec(process.execPath,['scripts/smoke.mjs'],{timeout:25000});const result=JSON.parse(stdout.trim().split('\n').at(-1)!);
 assert.equal(result.ok,true);assert.equal(result.transport,process.platform==='win32'?'ConPTY':'PTY');assert.equal(result.keyboard,true);assert.equal(result.resize,true);assert.equal(result.exitCode,0);assert.equal(result.eof,true);assert.deepEqual(result.sizes,[[80,24],[26,12],[80,24]]);
 if(process.platform==='win32'){assert.equal(result.screenRestored,true);assert.equal(result.rawRestored,true);assert.equal(typeof result.alternateEnterForwarded,'boolean');assert.equal(typeof result.alternateExitForwarded,'boolean');}
});
test('terminal smoke fails stuck keyboard behavior and terminates its disposable child',{timeout:15000},async(ctx)=>{
 let failure:any;try{await exec(process.execPath,['scripts/smoke.mjs','--entry',resolve('test/fixtures/smoke/keyboard-stuck.mjs')],{timeout:12000});assert.fail('Unresponsive arrows were accepted');}catch(error){failure=error;}
 assert.match(failure.stderr,/terminal smoke failed/i);const pid=/childPid=(\d+)/.exec(failure.stderr)?.[1];
 if(!pid&&process.env.HAT_PTY_TESTS!=='1'&&/not permitted|permission|entry point|not found|No such file/i.test(failure.stderr)){ctx.skip(`PTY unavailable: ${failure.stderr}`);return;}
 assert.ok(pid,'the failure must identify the disposable child');assert.match(failure.stderr,/Down arrow changing selection/);assert.throws(()=>process.kill(Number(pid),0),'the failing smoke must reap its own child');
});
