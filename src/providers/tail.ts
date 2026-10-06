import {open} from 'node:fs/promises';
import {object} from './common.ts';
export interface TailRecord {record:Record<string,any>;offset:number;}
/** A bounded byte reader. A line is committed only after its newline arrives. */
export class JsonlTail {
 offset=0;pending=Buffer.alloc(0);lineOffset=0;discard=false;generation=0;contentRevision=0;
 fileId='';prefix=Buffer.alloc(0);anchor=Buffer.alloc(0);
 max:number;
 constructor(maxRecordBytes:number) {this.max=maxRecordBytes;}
 async read(path:string,consume:(entry:TailRecord)=>void,reset:()=>void,diagnostic:(text:string)=>void):Promise<void> {
 const file=await open(path,'r');try{
 const stat=await file.stat();if(!stat.isFile())throw new Error('transcript is not a regular file');const id=`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
 const prefix=Buffer.alloc(Math.min(256,stat.size));await file.read(prefix,0,prefix.length,0);
 const anchor=Buffer.alloc(Math.min(32,this.offset));if(anchor.length)await file.read(anchor,0,anchor.length,this.offset-anchor.length);
 const replaced=this.fileId&&(id!==this.fileId||stat.size<this.offset||!prefix.subarray(0,this.prefix.length).equals(this.prefix)||!anchor.equals(this.anchor));
 if(replaced){this.offset=0;this.pending=Buffer.alloc(0);this.discard=false;this.lineOffset=0;this.generation++;this.contentRevision++;reset();}
 this.fileId=id;this.prefix=prefix;
 const block=this.offset<stat.size?Buffer.alloc(Math.min(65536,this.max+1)):Buffer.alloc(0);
 // A refresh reads a finite snapshot of the file, even if the writer is busy.
 while(this.offset<stat.size){const {bytesRead}=await file.read(block,0,Math.min(block.length,stat.size-this.offset),this.offset);if(!bytesRead)break;
 const chunk=block.subarray(0,bytesRead);let start=0;
 for(let i=0;i<chunk.length;i++){if(chunk[i]!==10)continue;const piece=chunk.subarray(start,i);this.accept(piece,consume,diagnostic);this.offset+=i-start+1;this.lineOffset=this.offset;start=i+1;}
 const last=chunk.subarray(start);if(last.length){this.append(last,diagnostic);this.offset+=last.length;}
 }
 this.anchor=Buffer.alloc(Math.min(32,this.offset));if(this.anchor.length)await file.read(this.anchor,0,this.anchor.length,this.offset-this.anchor.length);
 }finally{await file.close();}
 }
 append(piece:Buffer,diagnostic:(text:string)=>void){if(this.discard)return;if(this.pending.length+piece.length>this.max){this.pending=Buffer.alloc(0);this.discard=true;this.contentRevision++;diagnostic('oversize JSONL record omitted (record byte limit)');return;}this.pending=Buffer.concat([this.pending,piece]);}
 accept(piece:Buffer,consume:(entry:TailRecord)=>void,diagnostic:(text:string)=>void){this.append(piece,diagnostic);if(!this.discard&&this.pending.length){this.contentRevision++;try{const parsed=JSON.parse(this.pending.toString('utf8'));if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw new Error();consume({record:object(parsed),offset:this.lineOffset});}catch{diagnostic('malformed JSONL record omitted');}}this.pending=Buffer.alloc(0);this.discard=false;}
}
