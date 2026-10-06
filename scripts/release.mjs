import { mkdir, readdir, lstat, copyFile, readFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { checkInstall, verifyHelper, supportedPlatforms, requiredFiles, checkedRead } from './check-install.mjs';
const rootDefault=fileURLToPath(new URL('..',import.meta.url));
const documentation=['README.md','LICENSE','THIRD_PARTY_NOTICES.md','docs/install.md','docs/compatibility.md','docs/privacy.md'];
async function copyTree(root,from,to,accept){
 const info=await lstat(from);if(info.isSymbolicLink())throw new Error(`Refusing symlink release input: ${from}`);
 if(info.isDirectory()){await mkdir(to,{recursive:true});for(const child of await readdir(from))await copyTree(root,join(from,child),join(to,child),accept);return;}
 if(!info.isFile())throw new Error(`Non-regular release input: ${from}`);if(accept&&!accept(from))throw new Error(`Unexpected uncompiled release input: ${from}`);
 await checkedRead(root,relative(root,from));await mkdir(dirname(to),{recursive:true});await copyFile(from,to);
}
async function fileIndex(directory,prefix='',files={}){for(const entry of await readdir(join(directory,prefix),{withFileTypes:true})){const path=prefix?prefix+'/'+entry.name:entry.name;if(entry.isDirectory())await fileIndex(directory,path,files);else if(entry.isFile())files[path]=createHash('sha256').update(await readFile(join(directory,path))).digest('hex');else throw new Error('Non-regular staged release input');}return files;}
/** Stages reviewed build output; never downloads or compiles anything. Output must not exist. */
export async function stageRelease({root=rootDefault,output,platforms=[`${process.platform}-${process.arch}`]}={}){
 if(!output)throw new Error('An explicit release --output directory is required');root=resolve(root);output=resolve(output);
 const targets=[...new Set(platforms.includes('all')?supportedPlatforms:platforms)];if(!targets.length||targets.some(target=>!supportedPlatforms.includes(target)))throw new Error('Unsupported release platform selection');
 for(const source of ['dist','companion','docs','scripts','bin','native/sampler/artifacts']){const rel=relative(join(root,source),output);if(rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/')))throw new Error('Release output may not overlap copied input directories');}
 if(output===root)throw new Error('Release output may not replace source root');
 try{await lstat(output);throw new Error('Release output exists; refusing overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
 for(const file of [...requiredFiles,...documentation,'scripts/check-install.mjs'])await checkedRead(root,file);
 const optionalDocs=[];for(const file of ['docs/design/herdr-prism.md','docs/implementation-progress.md','docs/provider-compatibility.md','docs/windows-handoff.md']){try{await checkedRead(root,file);optionalDocs.push(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
 const pkg=JSON.parse(await checkedRead(root,'package.json',1024*1024));if(typeof pkg.name!=='string'||typeof pkg.version!=='string')throw new Error('Source package name/version missing');
 for(const target of targets){const [platform,arch]=target.split('-');if(platform==='darwin'||platform==='win32'){await verifyHelper(root,platform,arch,{artifactDir:'native/sampler/artifacts'});for(const notice of ['COPYRIGHT-library.html','licenses/MIT.txt']){try{await checkedRead(root,join('native/sampler/artifacts',target,'rust-licenses',notice));}catch(error){throw new Error(`Required native license notice missing: ${target}/${notice}: ${error.message}`);}}}}
 await mkdir(dirname(output),{recursive:true});const staging=output+'.hat-stage-'+randomBytes(10).toString('hex');await mkdir(staging,{recursive:false});
 try{
  await copyTree(root,join(root,'dist'),join(staging,'dist'),path=>/\.(js|json)$/.test(path));
  await copyTree(root,join(root,'companion/pi/index.js'),join(staging,'companion/pi/index.js'));
  for(const file of [...documentation,...optionalDocs,'herdr-plugin.toml','scripts/check-install.mjs','scripts/live-install.mjs'])await copyTree(root,join(root,file),join(staging,file));
  await writeFile(join(staging,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,private:true,type:'module',engines:{node:'>=22.13.0'},scripts:{'check-install':'node scripts/check-install.mjs'}},null,2)+'\n');
  for(const target of targets){const [platform,arch]=target.split('-');if(platform==='darwin'||platform==='win32'){await copyTree(root,join(root,'native/sampler/artifacts',target),join(staging,'bin',target),path=>/\/(hat-sampler(?:\.exe)?|sha256\.json)$/.test(path.replaceAll('\\','/'))||/\/rust-licenses\/(COPYRIGHT-library\.html|licenses\/[A-Za-z0-9.-]+\.txt)$/.test(path.replaceAll('\\','/')));if(process.platform!=='win32')await chmod(join(staging,'bin',target,platform==='win32'?'hat-sampler.exe':'hat-sampler'),0o755);}}
  await writeFile(join(staging,'release.json'),JSON.stringify({version:1,name:pkg.name,releaseVersion:pkg.version,platforms:targets.sort(),protocol:22},null,2)+'\n');
  const files=await fileIndex(staging);await writeFile(join(staging,'checksums.json'),JSON.stringify({version:1,algorithm:'sha256',files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)))},null,2)+'\n');
  for(const target of targets){const [platform,arch]=target.split('-');const result=await checkInstall({root:staging,platform,arch});if(!result.ok)throw new Error('Staged installation check failed: '+result.errors.join('; '));}
  // Only the exclusively created staging directory is removed on failure.
  try{await lstat(output);throw new Error('Release output exists; refusing overwrite');}catch(error){if(error.code!=='ENOENT')throw error;}
  await rename(staging,output);return {output,platforms:targets,files:Object.keys(files).length};
 }catch(error){await rm(staging,{recursive:true,force:true});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const options={platforms:[]};for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(!['--root','--output','--platform'].includes(arg)||!process.argv[i+1])throw new Error(`Unknown or incomplete option: ${arg}`);const value=process.argv[++i];if(arg==='--platform')options.platforms.push(value);else options[arg.slice(2)]=value;}
 if(!options.platforms.length)delete options.platforms;console.log(JSON.stringify(await stageRelease(options),null,2));
}
