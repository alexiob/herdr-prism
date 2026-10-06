import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,copyFile,chmod,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {peImports,assertWindowsSystemImports,machODependencies,assertMacSystemDependencies} from '../../scripts/check-distribution.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const targets={
 'aarch64-apple-darwin':['darwin','arm64'],
 'x86_64-apple-darwin':['darwin','x64'],
 'x86_64-pc-windows-msvc':['win32','x64'],
 'x86_64-pc-windows-gnu':['win32','x64'],
 'aarch64-unknown-linux-gnu':['linux','arm64'],
 'x86_64-unknown-linux-gnu':['linux','x64'],
};
/** Preserve Cargo's active flag representation and force static MSVC CRT last.
 * https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes */
export function packageEnvironment(env,target){const result={...env};if(!target.endsWith('-windows-msvc'))return result;if(env.CARGO_ENCODED_RUSTFLAGS!==undefined){const existing=env.CARGO_ENCODED_RUSTFLAGS;result.CARGO_ENCODED_RUSTFLAGS=existing+(existing?'\u001f':'')+'-C\u001ftarget-feature=+crt-static';}else{const existing=env.RUSTFLAGS??'';result.RUSTFLAGS=existing+(existing?' ':'')+'-C target-feature=+crt-static';}return result;}
export async function packageNative({target,env=process.env}={}){
const host=execFileSync('rustc',['-vV'],{encoding:'utf8',env}).match(/^host: (.+)$/m)?.[1];
const requested=target??env.CARGO_BUILD_TARGET??host;if(!requested||!targets[requested])throw new Error(`Unsupported release target: ${requested}`);
const [platform,arch]=targets[requested];
if(!['darwin-arm64','darwin-x64','win32-x64','linux-arm64','linux-x64'].includes(`${platform}-${arch}`))throw new Error('Unsupported native release platform');
if(platform==='darwin'&&process.platform!=='darwin')throw new Error('Actual macOS is required to sign and verify a macOS package');
const buildEnv=packageEnvironment(env,requested);
const metadata=JSON.parse(execFileSync('cargo',['metadata','--no-deps','--format-version','1','--locked','--offline','--manifest-path',join(root,'Cargo.toml')],{encoding:'utf8',env:buildEnv}));
const args=['build','--locked','--offline','--release','--manifest-path',join(root,'Cargo.toml'),'--target',requested];
execFileSync('cargo',args,{stdio:'inherit',env:buildEnv});
const executable=`hat-sampler${platform==='win32'?'.exe':''}`;
const source=join(metadata.target_directory,requested,'release',executable);
const directory=join(root,'artifacts',`${platform}-${arch}`);await mkdir(directory,{recursive:true});const artifact=join(directory,executable);await copyFile(source,artifact);if(platform!=='win32')await chmod(artifact,0o755);
let distribution;
if(platform==='darwin'){
 assertMacSystemDependencies(machODependencies(await readFile(artifact)));
 execFileSync('/usr/bin/codesign',['--force','--sign','-','--identifier','dev.iob.herdr-prism.sampler','--timestamp=none',artifact],{stdio:'inherit',env:buildEnv});
 execFileSync('/usr/bin/codesign',['--verify','--strict','--verbose=2',artifact],{stdio:'inherit',env:buildEnv});
 distribution={signature:'ad-hoc-development',notarization:'not-verified',systemDependenciesVerified:true};
}else if(platform==='win32'){
 assertWindowsSystemImports(peImports(await readFile(artifact)));
 distribution={signature:'unsigned-development',crt:requested.endsWith('-windows-msvc')?'static-msvc':'system-runtime-policy',systemDependenciesVerified:true};
}else distribution={usage:'development-helper; production uses TypeScript procfs'};
// The executable statically links Rust's standard library; ship the actual toolchain notices.
const sysroot=execFileSync('rustc',['--print','sysroot'],{encoding:'utf8',env:buildEnv}).trim();
const rustDocs=join(sysroot,'share','doc','rust');
const notices=join(directory,'rust-licenses');
try {
 await readFile(join(rustDocs,'COPYRIGHT-library.html'));
 const licenses=(await readdir(join(rustDocs,'licenses'))).filter(name=>name.endsWith('.txt'));
 if(!licenses.length)throw new Error('Rust license texts missing');
 await mkdir(join(notices,'licenses'),{recursive:true});
 await copyFile(join(rustDocs,'COPYRIGHT-library.html'),join(notices,'COPYRIGHT-library.html'));
 for(const filename of licenses)await copyFile(join(rustDocs,'licenses',filename),join(notices,'licenses',filename));
} catch(error) {throw new Error(`Rust distribution notices unavailable; install rust-docs for this development toolchain before packaging: ${String(error)}`);}
const sha256=createHash('sha256').update(await readFile(artifact)).digest('hex');
await writeFile(join(directory,'sha256.json'),JSON.stringify({version:1,platform,arch,filename:executable,sha256,target:requested,distribution},null,2)+'\n');
return{artifact,sha256,target:requested,distribution};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length>3)throw new Error('Usage: node native/sampler/package.mjs [Rust target]');
 console.log(JSON.stringify(await packageNative({target:process.argv[2]})));
}
