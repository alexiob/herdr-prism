import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore dependency-free acceptance helper
import {assertPreferencesPreserved} from '../scripts/live-update-test.mjs';
const saved={selectedKey:'pi:fixture',pin:true,tab:'Notes',collapsed:[],expanded:[],readers:[['pi:fixture:Notes:lineage',{cursor:3,cursorId:'notes-edit',scroll:2}]]};
const additional=['pi:/synthetic/session.jsonl:Notes:lineage',{cursor:0,cursorId:'notes-edit',scroll:0}];

test('update acceptance allows a fresh default reader while preserving every saved choice',()=>{
 assertPreferencesPreserved({...saved,readers:[additional,...saved.readers]},saved);
});
test('update acceptance rejects a missing or changed saved reader position',()=>{
 assert.throws(()=>assertPreferencesPreserved({...saved,readers:[additional]},saved));
 assert.throws(()=>assertPreferencesPreserved({...saved,readers:[['pi:fixture:Notes:lineage',{cursor:0,cursorId:'notes-edit',scroll:0}],additional]},saved));
});
test('update acceptance rejects changed pinning or nondefault added reader positions',()=>{
 assert.throws(()=>assertPreferencesPreserved({...saved,pin:false},saved));
 assert.throws(()=>assertPreferencesPreserved({...saved,readers:[...saved.readers,['pi:new:Notes:lineage',{cursor:5,cursorId:'other',scroll:7}]]},saved));
});
test('update acceptance rejects duplicate reader identities',()=>{
 assert.throws(()=>assertPreferencesPreserved({...saved,readers:[...saved.readers,...saved.readers]},saved));
});
