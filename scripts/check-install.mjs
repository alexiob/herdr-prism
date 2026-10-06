import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const supportedPlatforms = ['darwin-arm64','darwin-x64','win32-x64','linux-arm64','linux-x64'];
export const requiredFiles = ['herdr-plugin.toml','package.json','dist/entrypoints/action.js','dist/entrypoints/startup.js','dist/entrypoints/event.js','dist/entrypoints/inspector.js','dist/entrypoints/detail.js','dist/herdr/protocol.json','companion/pi/index.js','dist/config/index.js','dist/config/safe-file.js','scripts/check-install.mjs','scripts/live-install.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function inside(root,path){const rel=relative(root,path);return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'));}
export async function checkedRead(root,file,limit=64*1024*1024){
 const base=await realpath(root),path=resolve(root,file);if(!inside(base,await realpath(path)))throw new Error(`Artifact escapes installation: ${file}`);
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`Not a regular release file: ${file}`);if(stat.size>limit)throw new Error(`Artifact exceeds ${limit} bytes: ${file}`);return readFile(path);
}
function executableIdentity(bytes,platform,arch){
 if(platform==='darwin')return bytes.length>=8&&bytes.readUInt32LE(0)===0xfeedfacf&&bytes.readUInt32LE(4)===(arch==='arm64'?0x0100000c:0x01000007);
 if(platform==='win32'){if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')return false;const offset=bytes.readUInt32LE(0x3c);return offset<=bytes.length-6&&bytes.toString('ascii',offset,offset+4)==='PE\0\0'&&bytes.readUInt16LE(offset+4)===0x8664;}
 return false;
}
/** Validates checksums and platform identity; it does not execute the helper. */
export async function verifyHelper(root,platform,arch,{artifactDir='bin'}={}){
 if(!['darwin-arm64','darwin-x64','win32-x64'].includes(`${platform}-${arch}`))throw new Error(`Unsupported native helper architecture: ${platform}-${arch}`);
 const directory=join(artifactDir,`${platform}-${arch}`),filename=platform==='win32'?'hat-sampler.exe':'hat-sampler';
 let metadata;try{metadata=JSON.parse(await checkedRead(root,join(directory,'sha256.json'),65536));}catch(error){throw new Error(`Helper checksum manifest missing or invalid for ${platform}-${arch}: ${error.message}`);}
 if(metadata.version!==1||metadata.platform!==platform||metadata.arch!==arch||metadata.filename!==filename||typeof metadata.sha256!=='string'||!/^[a-f0-9]{64}$/.test(metadata.sha256))throw new Error(`Helper manifest identity/architecture mismatch: ${platform}-${arch}`);
 const file=join(directory,filename);let bytes;try{bytes=await checkedRead(root,file);}catch(error){throw new Error(`Native helper missing: ${error.message}`);}
 const digest=sha(bytes);if(digest!==metadata.sha256)throw new Error(`Native helper checksum mismatch: ${platform}-${arch}`);
 if(!executableIdentity(bytes,platform,arch))throw new Error(`Native helper executable architecture mismatch: ${platform}-${arch}`);
 if(process.platform!=='win32'&&((await lstat(join(root,file))).mode&0o111)===0)throw new Error(`Native helper is not executable: ${file}`);
 return {path:resolve(root,file),sha256:digest,platform,arch};
}
function validNode(version){const match=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);return !!match&&(Number(match[1])>22||Number(match[1])===22&&Number(match[2])>=13);}
export async function checkInstall({root=fileURLToPath(new URL('..',import.meta.url)),platform=process.platform,arch=process.arch,nodeVersion=process.versions.node}={}){
 root=resolve(root);const errors=[];const result={ok:false,root,platform,arch,nodeVersion,errors};
 if(!validNode(nodeVersion))errors.push(`Node.js >=22.13.0 is required; found ${nodeVersion}`);
 if(!supportedPlatforms.includes(`${platform}-${arch}`))errors.push(`Unsupported release platform: ${platform}-${arch}`);
 for(const file of requiredFiles){try{await checkedRead(root,file);}catch(error){errors.push(`Required compiled release file ${file}: ${error.message}`);}}
 try{const pkg=JSON.parse(await checkedRead(root,'package.json',1024*1024));if(pkg.type!=='module')errors.push('Release package.json must declare type=module');if(pkg.dependencies&&Object.keys(pkg.dependencies).length)errors.push('Runtime npm dependencies are not supported');}catch(error){errors.push(`Invalid package.json: ${error.message}`);}
 try{const protocol=JSON.parse(await checkedRead(root,'dist/herdr/protocol.json',2*1024*1024));if(protocol.protocol!==22||!protocol.schemas?.request)errors.push('Compiled protocol-22 schema is missing or incompatible');else result.protocol=22;}catch(error){errors.push(`Invalid compiled protocol schema: ${error.message}`);}
 if(platform==='darwin'||platform==='win32'){try{result.helper=await verifyHelper(root,platform,arch);}catch(error){errors.push(error.message);}}
 try{
  const checksumPath=join(root,'checksums.json');let exists=true;try{await lstat(checksumPath);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
  if(!exists){try{await lstat(join(root,'release.json'));throw new Error('Release checksum index missing');}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(exists){const index=JSON.parse(await checkedRead(root,'checksums.json',1024*1024));if(index.version!==1||!index.files||typeof index.files!=='object'||Array.isArray(index.files)||Object.keys(index.files).length>4096)throw new Error('Invalid release checksum index');for(const file of requiredFiles)if(!(file in index.files))throw new Error(`Release checksum index omits ${file}`);for(const [file,digest] of Object.entries(index.files)){if(!file||file.includes('\\')||isAbsolute(file)||file.split('/').some(part=>part==='..'||!part)||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new Error('Invalid release checksum entry');if(sha(await checkedRead(root,file))!==digest)errors.push(`Release file checksum mismatch: ${file}`);}}
 }catch(error){errors.push(`Release checksum verification failed: ${error.message}`);}
 result.ok=errors.length===0;return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(!['--root','--platform','--arch'].includes(arg)||!process.argv[i+1])throw new Error(`Unknown or incomplete option: ${arg}`);options[arg.slice(2)]=process.argv[++i];}
 const result=await checkInstall(options);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
