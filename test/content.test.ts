import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {Message} from '../src/model/types.ts';
const api = await import('../src/content/index.ts').catch(()=>({})) as any;
const message=(id:string,text:string,timestamp=10,complete=true):Message=>({id,text,role:'assistant',timestamp,complete,source:'fixture'});
test('messages directed to another agent never replace user ACTION lists or create user refs',async()=>{
 const inter:Message={...message('between','ACTION: Deploy\nSee `src/private.ts`'),kind:'inter-agent',author:'parent',recipient:'child'};const list=new api.TodoList();list.update([message('chat','ACTION: Review'),inter]);assert.equal(list.items.length,1);assert.equal(list.items[0].text,'Review');assert.deepEqual(await api.extractRefs([inter],'/repo'),[]);
});
test('refs retain earlier provenance under latest mention and resolve message cwd, Unicode, spaces, Windows drives and URL lines',async t=>{
 assert.equal(typeof api.extractRefs,'function','deterministic refs exist');const root=await mkdtemp(join(tmpdir(),'hat-refs-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'é file.ts'),'hello');
 const refs=await api.extractRefs([{...message('a','See [source](<é file.ts:12>) and https://example.com/a.'),cwd:root},message('b','Again [source](<é file.ts:12>) and `C:\\Work\\日本 語.ts:42`.\n[unsafe](javascript:alert(1))\n```\n[example](fake.ts)\n```'),{...message('u','[user](user.ts)'),role:'user'}],root);
 const file=refs.find((r:any)=>r.target===join(root,'é file.ts'));assert.equal(file.messageId,'b');assert.equal(file.line,12);assert.equal(file.exists,true);assert.deepEqual(file.sources.map((s:any)=>s.messageId),['a','b']);assert.equal(refs.find((r:any)=>r.target==='C:\\Work\\日本 語.ts').line,42);assert.ok(refs.some((r:any)=>r.target==='https://example.com/a'));assert.ok(!refs.some((r:any)=>/fake|javascript|user.ts/.test(r.target)));
});
test('refs edited markers require successful explicit tool evidence and preserve mentioned versus edited distinction',async()=>{
 assert.equal(typeof api.extractRefs,'function');const refs=await api.extractRefs([{...message('a','See `src/a.ts` and `src/b.ts`.'),cwd:'/repo',tools:[{id:'t',name:'apply_patch',status:'done',editedPaths:['src/a.ts']},{id:'e',name:'Edit',status:'error',editedPaths:['src/b.ts']}]}],'/wrong');assert.equal(refs.find((r:any)=>r.target==='/repo/src/a.ts').edited,true);assert.equal(refs.find((r:any)=>r.target==='/repo/src/b.ts').edited,false);
});
test('reference-free prose stays empty while relative Markdown and sanitized delimiters remain attributable',async()=>{
 const plain=message('plain','Controlled fixture '+'.'.repeat(3900));assert.deepEqual(await api.extractRefs(Array.from({length:200},(_,i)=>({...plain,id:String(i)})),'/repo'),[]);
 const refs=await api.extractRefs([message('markdown','[file](README.md)'),message('colored','[file]\u001b[31m(README.md)'),message('inline','`file.ts`'),message('prose','Inspect src/file.ts')],'/repo');
 const readme=refs.find((r:any)=>r.target==='/repo/README.md');assert.equal(readme.messageId,'colored');assert.deepEqual(readme.sources.map((s:any)=>s.messageId),['markdown','colored']);assert.ok(refs.some((r:any)=>r.target==='/repo/file.ts'));assert.ok(refs.some((r:any)=>r.target==='/repo/src/file.ts'));
});
test('ACTION complete lists preserve no-report, ignore fences and streams, explicitly clear and diagnose mixed reports',()=>{
 assert.equal(typeof api.TodoList,'function','explicit ACTION list reducer exists');const todo=new api.TodoList();assert.equal(todo.status,'not_reported');
 todo.update([message('a','ACTION: Run `npm test`\nACTION: Review changes',100)]);assert.equal(todo.items.length,2);const first=todo.items[0];todo.toggle(first.id);todo.update([message('b','No actions here',200),message('c','```\nACTION: Example\n```',300),message('d','ACTION: unfinished',400,false)]);assert.equal(todo.items.length,2);assert.equal(todo.pendingCount,1);
 todo.update([message('e','ACTION: none\nACTION: mixed',500)]);assert.equal(todo.items.length,2);assert.match(todo.diagnostics.at(-1),/mixed/i);
 todo.update([message('f','ACTION: none',600)]);assert.equal(todo.status,'empty');assert.equal(todo.items.length,0);
 todo.update([message('g','ACTION: Run `npm test`',700)]);assert.equal(todo.items[0].checked,true);assert.equal(todo.items[0].firstSeen,100);assert.equal(todo.items[0].firstMessageId,'a');assert.equal(todo.sourceMessageId,'g');assert.equal(todo.items[0].repeated,true);
});
test('To-do state persists local checking and provenance without merging case-sensitive command requests',()=>{
 assert.equal(typeof api.TodoList,'function');const todo=new api.TodoList();todo.update([message('a','ACTION: Run `Deploy`',1)]);todo.toggle(todo.items[0].id);const json=JSON.parse(JSON.stringify(todo.toJSON()));const restored=new api.TodoList();restored.restore(json);restored.update([message('a','ACTION: Run `Deploy`',1),message('b','ACTION: Run `deploy`',2)]);assert.equal(restored.items[0].checked,false);restored.update([message('c','ACTION: Run   `Deploy`',3)]);assert.equal(restored.items[0].checked,true);assert.equal(restored.items[0].firstMessageId,'a');restored.toggle(restored.items[0].id);assert.equal(restored.pendingCount,1);
});
test('disabled and unavailable To-do reporting retain distinct statuses and partial messages do not replace a complete list',()=>{
 assert.equal(typeof api.TodoList,'function');const todo=new api.TodoList({enabled:false});todo.update([message('m','ACTION: Run',1)]);assert.equal(todo.status,'disabled');assert.equal(todo.items.length,0);const other=new api.TodoList();other.setAvailability(false);assert.equal(other.status,'source_unavailable');other.setAvailability(true);assert.equal(other.status,'not_reported');
});
test('refs accept plain paths and UNC/newline file links while ACTION requires explicit completed messages',async()=>{
 const refs=await api.extractRefs([message('a','Changed src/main.ts:9. See [odd](<dir/a\nb.ts>) and `\\\\server\\share\\é.ts:2`.'),{...message('b','[excluded](unknown.ts)'),complete:undefined}],'/repo');assert.ok(refs.some((r:any)=>r.target==='/repo/src/main.ts'&&r.line===9));assert.ok(refs.some((r:any)=>r.target==='/repo/dir/a\nb.ts'));assert.ok(refs.some((r:any)=>r.target==='\\\\server\\share\\é.ts'&&r.line===2));
 const todo=new api.TodoList();todo.update([{...message('a','ACTION: unknown'),complete:undefined}]);assert.equal(todo.status,'not_reported');
});
test('refs group targets under latest mention ahead of older message groups',async()=>{
 const refs=await api.extractRefs([message('old','`src/a.ts` and `src/b.ts`'),message('new','`src/a.ts`')],'/repo');assert.deepEqual(refs.map((r:any)=>r.messageId),['new','old']);
});
test('To-do preserves significant inline command whitespace and flags a repeated completed request',()=>{
 const todo=new api.TodoList();todo.update([message('a','ACTION: Run `echo "two  spaces"`')]);todo.toggle(todo.items[0].id);todo.update([message('b','ACTION: Run   `echo "two  spaces"`')]);assert.equal(todo.items[0].checked,true);assert.equal(todo.items[0].repeated,true);todo.update([message('c','ACTION: Run `echo "two spaces"`')]);assert.equal(todo.items[0].checked,false);
});
test('unknown message cwd does not fabricate relative refs in the plugin checkout',async()=>{
 const refs=await api.extractRefs([message('a','`src/a.ts` [absolute](/known/a.ts) https://example.com/a'),{...message('b','`src/b.ts`'),cwd:'/known'}]);assert.ok(!refs.some((r:any)=>r.target.endsWith('/src/a.ts')));assert.ok(refs.some((r:any)=>r.target==='/known/src/b.ts'));assert.ok(refs.some((r:any)=>r.target==='/known/a.ts'));assert.ok(refs.some((r:any)=>r.target==='https://example.com/a'));
});
