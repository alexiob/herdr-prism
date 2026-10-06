import {mkdir,writeFile,readFile,lstat,readdir,chmod,appendFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=fileURLToPath(new URL('..',import.meta.url));const exec=promisify(execFile);
// Digests verified from official GitHub release asset metadata on2026-10-06.
const assets={
 'darwin-arm64':['herdr-macos-aarch64','5173a3e0ae42d5d1ab7ebfa5d5e6329f7c3d23f8e1a3677c7ce3231da2884157'],
 'darwin-x64':['herdr-macos-x86_64','db62d548ff3e832b087a96b1894a08d26be3905f1830309cd556783f215d4054'],
 'linux-arm64':['herdr-linux-aarch64','4de7aa3e25678812e92960de64f7c2aaa1bca1f0f80a3c5e559837e231e1f5c0'],
 'linux-x64':['herdr-linux-x86_64','18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7'],
 'win32-x64':['herdr-windows-x86_64.zip','c75b1fa49f7a3ba4b8b11789912a6147e4214a3b6fd3556d0f80076c8887d795']
};
export async function herdrTestBin({output=path.join(root,'artifacts/herdr-test-bin'),platform=process.platform,arch=process.arch}={}){
 const selected=assets[platform+'-'+arch];if(!selected)throw Error('Unsupported Herdr test platform');
 const [name,expected]=selected;const url='https://github.com/herdrdev/herdr/releases/download/v0.9.3/'+name;
 const directory=path.resolve(output);await mkdir(directory,{recursive:true,mode:0o700});const dir=await lstat(directory);if(!dir.isDirectory()||dir.isSymbolicLink())throw Error('Unsafe test binary directory');
 const archive=path.join(directory,name);let bytes;
 try{const info=await lstat(archive);if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024)throw Error('Unsafe cached test binary');bytes=await readFile(archive);}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch(url);if(!response.ok)throw Error(`Herdr test download HTTP${response.status}`);if(Number(response.headers.get('content-length')??0)>64*1024*1024)throw Error('Herdr test archive too large');bytes=Buffer.from(await response.arrayBuffer());}
 if(bytes.length>64*1024*1024||createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('Pinned Herdr test asset checksum mismatch');
 await writeFile(archive,bytes,{mode:0o700});let binary=archive;
 if(platform==='win32'){
  const extracted=path.join(directory,'extracted');const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extracted)} -Force`],{windowsHide:true,timeout:30000});
  const candidates=[];const visit=async(dir,depth=0)=>{if(depth>4)throw Error('Unexpected test archive depth');for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('Test archive symlink');if(entry.isDirectory())await visit(file,depth+1);else if(entry.isFile()&&entry.name.toLowerCase()==='herdr.exe')candidates.push(file);}};await visit(extracted);if(candidates.length!==1)throw Error('Expected exactly one Herdr executable');binary=candidates[0];
 }else await chmod(binary,0o700);
 if(platform===process.platform&&arch===process.arch){const version=(await exec(binary,['--version'],{encoding:'utf8',timeout:10000,windowsHide:true})).stdout.trim();if(version!=='herdr 0.9.3')throw Error('Unexpected pinned Herdr version');}
 const proof={binary,version:'0.9.3',platform,arch,source:url,sha256:expected};await writeFile(path.join(directory,'source.json'),JSON.stringify(proof,null,2)+'\n',{mode:0o600});
 if(process.env.GITHUB_ENV&&platform===process.platform&&arch===process.arch)await appendFile(process.env.GITHUB_ENV,`HERDR_BIN_PATH=${binary}\n`);
 return proof;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const key=process.argv[i].slice(2);if(!['output','platform','arch'].includes(key)||!process.argv[i+1])throw Error('Use --output DIR [--platform NAME --arch ARCH]');options[key]=process.argv[++i];}
 try{console.log(JSON.stringify(await herdrTestBin(options),null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}
