import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {freshPrivateDirectory} from './helpers/private-dir.ts';
import {metadata} from '../src/providers/metadata.ts';

test('metadata-only Pi ancestors retain their latest bounded session name without loading messages',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'prism-breadcrumb-name-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'worker.jsonl');
 await writeFile(file,[{type:'session',version:3,id:'worker'},{type:'session_info',name:'Original parser'},{type:'message',id:'body',message:{role:'assistant',content:'PRIVATE BODY '.repeat(2000)}},{type:'session_info',name:'Renamed parser'}].map(r=>JSON.stringify(r)+'\n').join(''));
 const result=await metadata('pi',file,1024);assert.equal(result.evidence.title,'Renamed parser');assert.deepEqual(result.evidence.messages,[]);assert.equal(result.tools.size,0);assert.equal(result.usage.size,0);
});
