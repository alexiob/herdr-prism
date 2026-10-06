import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
// @ts-ignore build-only dependency-free distribution utility
const gate:any=await import('../scripts/check-distribution.mjs').catch(()=>({}));
function pe(imports:string[],delayed:string[]=[]){
 const b=Buffer.alloc(0xa00),pe=0x80,opt=pe+24,section=opt+240;b.write('MZ');b.writeUInt32LE(pe,0x3c);b.write('PE\0\0',pe);b.writeUInt16LE(0x8664,pe+4);b.writeUInt16LE(1,pe+6);b.writeUInt16LE(240,pe+20);b.writeUInt16LE(0x20b,opt);b.writeBigUInt64LE(0x140000000n,opt+24);b.writeUInt32LE(0x200,opt+60);b.writeUInt32LE(16,opt+108);b.write('.rdata',section);b.writeUInt32LE(0x800,section+8);b.writeUInt32LE(0x1000,section+12);b.writeUInt32LE(0x800,section+16);b.writeUInt32LE(0x200,section+20);let stringOffset=0x600;
 const name=(value:string)=>{const offset=stringOffset;stringOffset+=b.write(value+'\0',offset);return offset-0x200+0x1000;};
 if(imports.length){b.writeUInt32LE(0x1000,opt+112+8);b.writeUInt32LE((imports.length+1)*20,opt+112+12);imports.forEach((value,i)=>b.writeUInt32LE(name(value),0x200+i*20+12));}
 if(delayed.length){b.writeUInt32LE(0x1100,opt+112+13*8);b.writeUInt32LE((delayed.length+1)*32,opt+112+13*8+4);delayed.forEach((value,i)=>{b.writeUInt32LE(1,0x300+i*32);b.writeUInt32LE(name(value),0x300+i*32+4);});}return b;
}
function macho(paths:string[]){const commands=paths.map(path=>{const size=(24+Buffer.byteLength(path)+1+7)&~7;const b=Buffer.alloc(size);b.writeUInt32LE(0xc);b.writeUInt32LE(size,4);b.writeUInt32LE(24,8);b.write(path+'\0',24);return b;});const h=Buffer.alloc(32);h.writeUInt32LE(0xfeedfacf);h.writeUInt32LE(0x0100000c,4);h.writeUInt32LE(2,12);h.writeUInt32LE(commands.length,16);h.writeUInt32LE(commands.reduce((n,b)=>n+b.length,0),20);return Buffer.concat([h,...commands]);}
test('PE imports and delayed imports accept system libraries and reject redistributable dependencies',()=>{
 assert.equal(typeof gate.peImports,'function','distribution PE inspection API must exist');const imports=gate.peImports(pe(['KERNEL32.dll','ADVAPI32.dll'],['api-ms-win-core-synch-l1-2-0.dll']));assert.deepEqual(imports,['KERNEL32.dll','ADVAPI32.dll','api-ms-win-core-synch-l1-2-0.dll']);gate.assertWindowsSystemImports(imports);
 for(const dll of ['VCRUNTIME140.dll','msvcp140.dll','libgcc_s_seh-1.dll','libwinpthread-1.dll','vendor.dll','C:\\Windows\\kernel32.dll'])assert.throws(()=>gate.assertWindowsSystemImports(gate.peImports(pe(['KERNEL32.dll'],[dll]))),/non-system|redistributable/i);
});
test('malformed PE directories and names cannot conceal imports or read outside file sections',()=>{
 assert.equal(typeof gate.peImports,'function');const b=pe(['kernel32.dll']);b.writeUInt32LE(0xfffffff0,0x200+12);assert.throws(()=>gate.peImports(b),/PE|RVA|import/i);const truncated=pe(['kernel32.dll']);truncated.writeUInt32LE(0xfffffff0,0x98+112+12);assert.throws(()=>gate.peImports(truncated),/PE|import/i);assert.throws(()=>gate.peImports(pe(['kernel32.dll']).subarray(0,300)),/PE|section|truncat/i);
});
test('Mach-O dependencies reject rpath or developer libraries and preserve system path boundaries',()=>{
 assert.equal(typeof gate.machODependencies,'function');const libraries=gate.machODependencies(macho(['/usr/lib/libSystem.B.dylib','/System/Library/Frameworks/Security.framework/Versions/A/Security']));gate.assertMacSystemDependencies(libraries);
 for(const path of ['@rpath/libstd.dylib','/opt/homebrew/lib/libiconv.dylib','/usr/lib/../../opt/libbad.dylib'])assert.throws(()=>gate.assertMacSystemDependencies(gate.machODependencies(macho([path]))),/non-system/i);
 const corrupt=macho(['/usr/lib/libSystem.B.dylib']);corrupt.writeUInt32LE(0xffffffff,36);assert.throws(()=>gate.machODependencies(corrupt),/Mach-O|command|truncat/i);
});
async function artifact(t:any,bytes:Buffer,platform='win32',arch='x64'){const root=await mkdtemp(join(tmpdir(),'hat-distribution-'));t.after(()=>rm(root,{recursive:true,force:true}));const folder=join(root,'artifacts',platform+'-'+arch);await mkdir(folder,{recursive:true});const filename=platform==='win32'?'hat-sampler.exe':'hat-sampler';await writeFile(join(folder,filename),bytes);await chmod(join(folder,filename),0o700);await writeFile(join(folder,'sha256.json'),JSON.stringify({version:1,platform,arch,filename,sha256:createHash('sha256').update(bytes).digest('hex')}));return{root,folder,filename};}
test('distribution checks actual helper integrity before import policy and never treats fixture analysis as execution',async t=>{
 assert.equal(typeof gate.checkDistribution,'function');const f=await artifact(t,pe(['kernel32.dll']));const checked=await gate.checkDistribution({root:f.root,platform:'win32',arch:'x64',artifactDir:'artifacts'});assert.equal(checked.ok,true);assert.equal(checked.nativeExecution,false);assert.deepEqual(checked.dependencies,['kernel32.dll']);await writeFile(join(f.folder,f.filename),pe(['vcruntime140.dll']));const corrupt=await gate.checkDistribution({root:f.root,platform:'win32',arch:'x64',artifactDir:'artifacts'});assert.equal(corrupt.ok,false);assert.match(corrupt.errors.join(' '),/checksum mismatch/);
});
test('MSVC packaging preserves active developer flags and forces static CRT without changing other targets',async()=>{
 // @ts-ignore build-only native packager
 const mod:any=await import('../native/sampler/package.mjs');assert.equal(typeof mod.packageEnvironment,'function');const flags=mod.packageEnvironment({RUSTFLAGS:'-C debuginfo=2',CUSTOM:'keep'},'x86_64-pc-windows-msvc');assert.equal(flags.RUSTFLAGS,'-C debuginfo=2 -C target-feature=+crt-static');assert.equal(flags.CUSTOM,'keep');const encoded='-C\u001flink-arg=literal argument';const env={RUSTFLAGS:'ignored but retained',CARGO_ENCODED_RUSTFLAGS:encoded};const result=mod.packageEnvironment(env,'x86_64-pc-windows-msvc');assert.equal(result.RUSTFLAGS,env.RUSTFLAGS);assert.equal(result.CARGO_ENCODED_RUSTFLAGS,encoded+'\u001f-C\u001ftarget-feature=+crt-static');assert.deepEqual(mod.packageEnvironment(env,'aarch64-apple-darwin'),env);
});
test('actual macOS signing verifies final packaged bytes and reports ad-hoc development without notarization claims',{skip:process.platform!=='darwin'},async t=>{
 assert.equal(typeof gate.checkDistribution,'function');const run=promisify(execFile);const f=await artifact(t,macho(['/usr/lib/libSystem.B.dylib']),'darwin',process.arch);const source=join(f.root,'fixture.c');await writeFile(source,'int main(void){return 0;}\n');const path=join(f.folder,f.filename);await run('/usr/bin/clang',[source,'-o',path]);await run('/usr/bin/codesign',['--force','--sign','-','--identifier','dev.iob.hat.fixture','--timestamp=none',path]);const bytes=await readFile(path);await writeFile(join(f.folder,'sha256.json'),JSON.stringify({version:1,platform:'darwin',arch:process.arch,filename:f.filename,sha256:createHash('sha256').update(bytes).digest('hex')}));const result=await gate.checkDistribution({root:f.root,platform:'darwin',arch:process.arch,artifactDir:'artifacts'});assert.equal(result.ok,true,result.errors.join(' '));assert.equal(result.signing,'ad-hoc-development');assert.equal(result.notarization,'not-verified');await run('/usr/bin/codesign',['--remove-signature',path]);await writeFile(join(f.folder,'sha256.json'),JSON.stringify({version:1,platform:'darwin',arch:process.arch,filename:f.filename,sha256:createHash('sha256').update(await readFile(path)).digest('hex')}));const unsigned=await gate.checkDistribution({root:f.root,platform:'darwin',arch:process.arch,artifactDir:'artifacts'});assert.equal(unsigned.ok,false);assert.match(unsigned.errors.join(' '),/signature|signed|codesign/i);
});
