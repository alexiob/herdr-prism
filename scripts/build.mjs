import ts from 'typescript';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
async function build(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const source = path.join(dir, entry.name);
    if (entry.isDirectory()) { await build(source); continue; }
    if (source.endsWith('.json')) { const target=source.replace(/^src[\\/]/,'dist/');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(source));continue; }
    if (!source.endsWith('.ts')) continue;
    const target = source.replace(/^src[\\/]/, 'dist/').replace(/\.ts$/, '.js');
    const result = ts.transpileModule(await readFile(source, 'utf8'), { fileName: source, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true, removeComments: false } });
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, result.outputText);
  }
}
await build('src');
try { const source='companion/pi/index.ts';const result=ts.transpileModule(await readFile(source,'utf8'),{fileName:source,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,rewriteRelativeImportExtensions:true}});await writeFile('companion/pi/index.js',result.outputText); } catch (error) { if(error.code!=='ENOENT')throw error; }
console.log('Compiled dependency-free ESM in dist/');
