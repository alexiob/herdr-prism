import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
const exec=promisify(execFile);
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
});
test('terminal smoke fails stuck keyboard behavior and terminates its disposable child',{timeout:15000},async(ctx)=>{
 let failure:any;try{await exec(process.execPath,['scripts/smoke.mjs','--entry',resolve('test/fixtures/smoke/keyboard-stuck.mjs')],{timeout:12000});assert.fail('Unresponsive arrows were accepted');}catch(error){failure=error;}
 assert.match(failure.stderr,/terminal smoke failed/i);const pid=/childPid=(\d+)/.exec(failure.stderr)?.[1];
 if(!pid&&process.env.HAT_PTY_TESTS!=='1'&&/not permitted|permission|entry point|not found|No such file/i.test(failure.stderr)){ctx.skip(`PTY unavailable: ${failure.stderr}`);return;}
 assert.ok(pid,'the failure must identify the disposable child');assert.match(failure.stderr,/Down arrow changing selection/);assert.throws(()=>process.kill(Number(pid),0),'the failing smoke must reap its own child');
});
