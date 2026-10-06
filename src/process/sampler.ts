import {LinuxSampler} from './linux.ts';
import {NativeSampler} from './native-helper.ts';
import type {SampleBatch} from '../model/types.ts';
export interface ProcessSampler {sample():Promise<SampleBatch>;close():Promise<void>;}
export interface SamplerOptions {platform?:string;helperPath?:string;helperArgs?:string[];procRoot?:string;intervalMs?:number;clockTicks?:number;pageSize?:number;}
export function createSampler(options:SamplerOptions={}):ProcessSampler{const platform=options.platform??process.platform;if(platform==='linux')return new LinuxSampler(options);if(platform==='darwin'||platform==='macos'||platform==='win32'||platform==='windows')return new NativeSampler(options.helperPath,options.intervalMs,options.helperArgs);throw new Error(`Unsupported process platform: ${platform}`);}
