import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkInstall,checkedRead,verifyHelper,supportedPlatforms} from './check-install.mjs';
const exec=promisify(execFile);
const rootDefault=fileURLToPath(new URL('..',import.meta.url));
function range(bytes,offset,size,label){if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset>bytes.length-size)throw new Error(`Truncated or invalid ${label}`);}
function cString(bytes,offset,end,label){range(bytes,offset,1,label);const limit=Math.min(end,offset+1024);let stop=offset;while(stop<limit&&bytes[stop]!==0)stop++;if(stop===limit||stop===offset)throw new Error(`Invalid or unterminated ${label}`);const value=bytes.subarray(offset,stop);if(value.some(c=>c<0x20||c>0x7e))throw new Error(`Invalid ASCII ${label}`);return value.toString('ascii');}

// Original bounded reader of the Microsoft PE32+ import and delay-import layouts.
// https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
function peLayout(bytes){
 range(bytes,0,64,'PE DOS header');if(bytes.toString('ascii',0,2)!=='MZ')throw new Error('Invalid PE DOS signature');
 const start=bytes.readUInt32LE(0x3c);range(bytes,start,24,'PE header');if(bytes.toString('ascii',start,start+4)!=='PE\0\0'||bytes.readUInt16LE(start+4)!==0x8664)throw new Error('Expected Windows x64 PE executable');
 const count=bytes.readUInt16LE(start+6),optional=start+24,size=bytes.readUInt16LE(start+20);range(bytes,optional,size,'PE optional header');
 if(size<112||bytes.readUInt16LE(optional)!==0x20b||count<1||count>96)throw new Error('Invalid PE32+ optional header or sections');
 const directoryCount=bytes.readUInt32LE(optional+108);if(directoryCount<14||directoryCount>64||112+directoryCount*8>size)throw new Error('Invalid PE data directories');
 const table=optional+size;range(bytes,table,count*40,'PE section table');const headers=bytes.readUInt32LE(optional+60);if(headers<table+count*40||headers>bytes.length)throw new Error('Invalid PE header size');
 const sections=[];for(let i=0;i<count;i++){const at=table+i*40;const section={rva:bytes.readUInt32LE(at+12),rawSize:bytes.readUInt32LE(at+16),raw:bytes.readUInt32LE(at+20)};range(bytes,section.raw,section.rawSize,'PE section data');sections.push(section);}
 const map=(rva,size=1)=>{if(!Number.isSafeInteger(rva)||rva<0||rva+size>0x100000000)throw new Error('Invalid PE RVA');if(rva<headers&&rva+size<=headers){range(bytes,rva,size,'PE header RVA');return{offset:rva,end:headers};}const matches=sections.filter(s=>rva>=s.rva&&rva+size<=s.rva+s.rawSize);if(matches.length!==1)throw new Error('Unmapped or ambiguous PE RVA');const s=matches[0],offset=s.raw+rva-s.rva;range(bytes,offset,size,'PE RVA');return{offset,end:s.raw+s.rawSize};};
 const directory=index=>({address:bytes.readUInt32LE(optional+112+index*8),size:bytes.readUInt32LE(optional+116+index*8)});
 return{map,directory,imageBase:bytes.readBigUInt64LE(optional+24)};
}
export function peImports(bytes){
 const {map,directory,imageBase}=peLayout(bytes),names=[];
 for(const [index,stride]of [[1,20],[13,32]]){
  const entry=directory(index);if(!entry.address&&!entry.size)continue;if(!entry.address||entry.size<stride||entry.size>1024*1024)throw new Error('Invalid PE import directory size');const block=map(entry.address,entry.size);let terminated=false;
  for(let offset=0;offset+stride<=entry.size;offset+=stride){const at=block.offset+offset;if(bytes.subarray(at,at+stride).every(c=>c===0)){terminated=true;break;}if(names.length>=256)throw new Error('PE import count exceeds limit');let nameRva=bytes.readUInt32LE(at+(index===1?12:4));if(index===13){const attributes=bytes.readUInt32LE(at);if(attributes>1)throw new Error('Invalid PE delayed import attributes');if(attributes===0){const relative=BigInt(nameRva)-imageBase;if(relative<0n||relative>0xffffffffn)throw new Error('Invalid legacy PE delayed import VA');nameRva=Number(relative);}}const name=map(nameRva);names.push(cString(bytes,name.offset,name.end,'PE import DLL name'));}
  if(!terminated)throw new Error('Unterminated PE import directory');
 }
 return[...new Set(names)];
}
const windowsLibraries=new Set(['kernel32.dll','kernelbase.dll','ntdll.dll','advapi32.dll','bcrypt.dll','bcryptprimitives.dll','crypt32.dll','userenv.dll','ws2_32.dll','psapi.dll','user32.dll','gdi32.dll','ole32.dll','oleaut32.dll','shell32.dll','shlwapi.dll','secur32.dll','rpcrt4.dll','dbghelp.dll','msvcrt.dll']);
export function assertWindowsSystemImports(imports){for(const name of imports){const dll=name.toLowerCase();if(!windowsLibraries.has(dll)&&!/^api-ms-win-(?:core|security|eventing|service|rtcore|devices|networking|shell)-[a-z0-9-]+-l\d+-\d+-\d+\.dll$/.test(dll))throw new Error(`Non-system or redistributable Windows DLL import: ${name}`);}}

export function machODependencies(bytes){
 range(bytes,0,32,'Mach-O header');if(bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(12)!==2)throw new Error('Expected thin little-endian Mach-O executable');
 const count=bytes.readUInt32LE(16),size=bytes.readUInt32LE(20);if(count>4096)throw new Error('Mach-O command count exceeds limit');range(bytes,32,size,'Mach-O load commands');const end=32+size;let offset=32;const dependencies=[];
 for(let i=0;i<count;i++){range(bytes,offset,8,'Mach-O command');const command=bytes.readUInt32LE(offset),length=bytes.readUInt32LE(offset+4);if(length<8||length%8!==0||offset+length>end)throw new Error('Invalid Mach-O load command size');if(command===0x27)throw new Error('Non-system Mach-O dyld environment command refused');if([0xc,0x80000018,0x8000001f,0x80000023,0x20,0x8000001c].includes(command)){const minimum=command===0x8000001c?12:24;if(length<minimum)throw new Error('Truncated Mach-O dependency command');const name=bytes.readUInt32LE(offset+8);if(name<minimum||name>=length)throw new Error('Invalid Mach-O dependency name offset');dependencies.push(cString(bytes,offset+name,offset+length,'Mach-O dependency'));}offset+=length;}
 if(offset!==end)throw new Error('Mach-O load command count/size mismatch');return[...new Set(dependencies)];
}
export function assertMacSystemDependencies(paths){for(const path of paths){const normalized=posix.normalize(path);if(path!==normalized||!path.startsWith('/usr/lib/')&&!path.startsWith('/System/Library/'))throw new Error(`Non-system macOS dynamic dependency: ${path}`);}}
async function macSignature(path){
 if(process.platform!=='darwin')throw new Error('Actual macOS is required for codesign signature verification');
 try{await exec('/usr/bin/codesign',['--verify','--strict','--verbose=2',path],{timeout:10000,maxBuffer:1024*1024});const displayed=await exec('/usr/bin/codesign',['--display','--verbose=4',path],{timeout:10000,maxBuffer:1024*1024});const text=displayed.stdout+'\n'+displayed.stderr;if(/^Signature=adhoc$/m.test(text))return'ad-hoc-development';if(/^Authority=Developer ID Application:/m.test(text)){// Verify Apple's chain and Developer ID certificate extensions, not a subject-name claim.
 await exec('/usr/bin/codesign',['--verify','--strict','--test-requirement','=anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',path],{timeout:10000,maxBuffer:1024*1024});return'developer-id';}return'certificate-development';}
 catch(error){throw new Error(`macOS codesign signature verification failed: ${error.message}`,{cause:error});}
}
/** Build/release inspection only: never signs, launches helpers, installs or downloads. */
export async function checkDistribution({root=rootDefault,platform=process.platform,arch=process.arch,artifactDir='bin'}={}){
 root=resolve(root);const result={version:1,ok:false,root,platform,arch,hostPlatform:process.platform,hostArch:process.arch,nativeExecution:false,checkedAt:new Date().toISOString(),errors:[],checks:[]};
 try{
  if(!supportedPlatforms.includes(`${platform}-${arch}`))throw new Error(`Unsupported distribution platform: ${platform}-${arch}`);
  if(platform==='linux'){if(artifactDir!=='bin')throw new Error('Linux production distribution uses compiled procfs; it has no packaged native helper');const install=await checkInstall({root,platform,arch});if(!install.ok)throw new Error(install.errors.join('; '));result.backend='procfs';result.signing='not-applicable';result.checks.push('compiled-release-integrity');}
  else{
   result.helper=await verifyHelper(root,platform,arch,{artifactDir});result.checks.push('helper-sha256','executable-architecture');const bytes=await checkedRead(root,`${artifactDir}/${platform}-${arch}/${platform==='win32'?'hat-sampler.exe':'hat-sampler'}`);
   if(platform==='win32'){result.dependencies=peImports(bytes);assertWindowsSystemImports(result.dependencies);const certificate=peLayout(bytes).directory(4);if(certificate.address||certificate.size){range(bytes,certificate.address,certificate.size,'PE certificate');result.signing='signature-present-unverified';}else result.signing='unsigned-development';result.checks.push('normal-and-delayed-pe-imports','windows-system-dependency-policy');}
   else{result.dependencies=machODependencies(bytes);assertMacSystemDependencies(result.dependencies);result.signing=await macSignature(result.helper.path);result.notarization='not-verified';result.checks.push('mach-o-system-dependencies','codesign-verify-strict');}
   if(artifactDir==='bin'){const install=await checkInstall({root,platform,arch});if(!install.ok)throw new Error(install.errors.join('; '));result.checks.push('compiled-release-integrity');}
  }
  result.ok=true;
 }catch(error){result.errors.push(error.message);}
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(!['--root','--platform','--arch','--artifact-dir'].includes(arg)||!process.argv[i+1])throw new Error(`Unknown or incomplete distribution option: ${arg}`);options[arg==='--artifact-dir'?'artifactDir':arg.slice(2)]=process.argv[++i];}
 const result=await checkDistribution(options);console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}
