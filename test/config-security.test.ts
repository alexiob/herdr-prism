import {freshPrivateDirectory} from './helpers/private-dir.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as security from '../src/config/safe-file.ts';

test('managed namespace security requires exact trusted Herdr identity and paths',async t=>{
 const dir=await freshPrivateDirectory(join(tmpdir(),'hat-namespace-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const config=join(dir,'config'),state=join(dir,'state'),foreign=join(dir,'foreign');
 await Promise.all([mkdir(config),mkdir(state),mkdir(foreign)]);
 // These are freshly-created fixture directories, explicitly owned by this test.
 // Windows inherits broad parent ACLs; do not ask generic existing-dir admission
 // to silently strip those ACLs as a side effect of namespace verification.
 await Promise.all([security.restrict(config,true),security.restrict(state,true),security.restrict(foreign,true)]);
 const names=['HERDR_PLUGIN_ID','HERDR_PLUGIN_CONFIG_DIR','HERDR_PLUGIN_STATE_DIR'];
 const original=names.map(name=>process.env[name]);t.after(()=>names.forEach((name,i)=>{if(original[i]===undefined)delete process.env[name];else process.env[name]=original[i];}));
 const secure=(security as unknown as {securePluginNamespace?: (config:string,state:string)=>Promise<void>}).securePluginNamespace;
 assert.equal(typeof secure,'function','securePluginNamespace API must exist');
 process.env.HERDR_PLUGIN_ID='foreign';process.env.HERDR_PLUGIN_CONFIG_DIR=config;process.env.HERDR_PLUGIN_STATE_DIR=state;
 await assert.rejects(secure!(config,state),/Herdr plugin identity/);
 process.env.HERDR_PLUGIN_ID='iob.herdr-prism';
 await assert.rejects(secure!(config,foreign),/Herdr plugin namespace/);
 const link=join(dir,'state-link');await symlink(state,link,process.platform==='win32'?'junction':'dir');
 process.env.HERDR_PLUGIN_STATE_DIR=link;
 await assert.rejects(secure!(config,state),/symlink|reparse/i,'Canonical target must not hide a junction/symlink in the trusted environment spelling');
 await assert.rejects(secure!(config,link),/symlink|reparse/i);
 process.env.HERDR_PLUGIN_STATE_DIR=state;
 await secure!(config,state);
 if(process.platform!=='win32'){assert.equal((await stat(config)).mode&0o777,0o700);assert.equal((await stat(state)).mode&0o777,0o700);}
});
