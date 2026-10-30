import {describe,it,expect,afterEach} from 'vitest';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const stop of cleanups.splice(0))await stop();});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
async function settled(h:any,id:string){await expect.poll(()=>h.store.get(`remote-handoff:${id}`)?.state).toMatch(/^(complete|uncertain)$/);return h.store.get(`remote-handoff:${id}`);}
import {captureRemoteSnapshot,createRemoteHandlers} from './remote-handoff';

const request=(seq:number,text:string)=>({threadId:'thr_local',seq,type:'client/turn/requested',data:{initiator:'user',input:[{type:'text',text}]}});
function harness(rows:any[]=[request(1,'first'),request(2,'last')]){
 const calls:any[]=[],store=new Map<string,unknown>();let uploads=0,failCommit=false;
 const services:Array<(signal:AbortSignal)=>Promise<void>>=[];
 const bb:any={background:{service:(_name:string,service:any)=>{services.push(service.start);}},storage:{kv:{get:async(k:string)=>structuredClone(store.get(k)),set:async(k:string,v:unknown)=>{store.set(k,structuredClone(v));}}},sdk:{
  threads:{get:async()=>({id:'thr_local',projectId:'proj_local',title:'Synthetic source'}),events:{list:async(args:any)=>{calls.push({kind:'events',args});if(args.order==='desc')return rows.slice(-1);return rows.filter(r=>r.seq>Number(args.afterSeq??0)).slice(0,100);}}},
  projects:{attachments:{read:async(args:any)=>{calls.push({kind:'file',args});return {bytes:Buffer.from('data'),sizeBytes:4,mimeType:'text/plain'};}}},
  plugins:{callRpc:async(args:any)=>{
   calls.push({kind:'rpc',...args});
   const result={operationId:'22222222-2222-4222-8222-222222222222',state:'prepared',serverId:'alpha',projectId:'proj_alpha',hostId:'host_alpha',environmentId:'env_alpha',threadId:null,uploaded:uploads};
   if(args.method==='handoffUpload'){uploads++;result.state='ready';result.uploaded=uploads;}
   if(args.method==='handoffCommit'){if(failCommit)throw Error('Connection lost');result.state='complete';(result as any).threadId='thr_remote';}
   return args.outputSchema.parse(result);
  }},
 }};
 return {bb,calls,rows,store,fail:()=>{failCommit=true;},run:()=>{const controller=new AbortController();const done=services.at(-1)!(controller.signal);const stop=async()=>{controller.abort();await done;};cleanups.push(stop);return {abort:()=>controller.abort(),done};}};
}
const target={serverId:'alpha',projectId:'proj_alpha',hostId:'host_alpha',environmentId:'env_alpha',providerId:'codex',model:'model-example',attachments:[],instructions:''};
describe('independent-server handoff',()=>{
 it('resolves native localImage without name/type/size from stored project bytes',async()=>{
  const row=request(1,'image');(row.data.input as any[]).push({type:'localImage',path:'stored.png',sourceProjectId:'proj_local'});
  const h=harness([row]);h.bb.sdk.projects.attachments.read=async()=>({bytes:Buffer.from('synthetic-image-bytes'),sizeBytes:21,mimeType:'image/png'});
  const value=await captureRemoteSnapshot(h.bb,{threadId:'thr_local'});
  expect(value.attachments).toHaveLength(1);expect(value.attachments[0]).toMatchObject({name:'stored.png',path:'stored.png',mimeType:'image/png',sizeBytes:21});
  expect(value.attachments[0].sha256).toMatch(/^[a-f0-9]{64}$/);
 });
 it('canonicalizes JSONL MIME lookup and detects same-size attachment replacement',async()=>{
  const row=request(1,'file');(row.data.input as any[]).push({type:'localFile',path:'stored.jsonl',name:'events.jsonl'});
  const h=harness([row]);let bytes=Buffer.from('{}\n');
  h.bb.sdk.projects.attachments.read=async()=>({bytes,sizeBytes:bytes.length,mimeType:'application/octet-stream'});
  const handlers=createRemoteHandlers(h.bb),value=await handlers.remotePrepare({threadId:'thr_local'});
  expect(value.attachments[0].mimeType).toBe('application/x-ndjson');bytes=Buffer.from('[]\n');
  h.run();await handlers.remoteStart({...target,snapshotId:value.snapshotId,attachments:[0]});
  expect((await settled(h,value.snapshotId)).error).toContain('Attachment changed');
  expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });
 it('bounds local metadata reads and does not scan arbitrary numbers of attachments',async()=>{
  const row=request(1,'files');for(let n=0;n<20;n++)(row.data.input as any[]).push({type:'localFile',path:`file-${n}.txt`});
  const h=harness([row]);const value=await captureRemoteSnapshot(h.bb,{threadId:'thr_local'});
  expect(h.calls.filter(c=>c.kind==='file')).toHaveLength(14);expect(value.attachments).toHaveLength(14);expect(value.unavailable).toBe(6);
 });
 it('captures a bounded saved snapshot with no model, file or remote calls',async()=>{
  const h=harness(Array.from({length:203},(_,i)=>request(i+1,`message ${i}`)));
  const result=await captureRemoteSnapshot(h.bb,{threadId:'thr_local'});
  expect(result.eventCount).toBe(203);expect(result.cutoff).toBe(203);expect(h.calls.every(c=>c.kind==='events')).toBe(true);
  expect(h.calls.filter(c=>c.args.order==='asc').map(c=>c.args.limit)).toEqual(['100','100','100']);
 });
 it('rejects wrong thread identity and missing sequence boundary',async()=>{
  const h=harness();h.rows[0].threadId='thr_other';await expect(captureRemoteSnapshot(h.bb,{threadId:'thr_local'})).rejects.toThrow('identity');
  const missing=harness([request(1,'one'),request(3,'three')]);await expect(captureRemoteSnapshot(missing.bb,{threadId:'thr_local',upToSeq:2})).rejects.toThrow('boundary');
 });
 it('tool payloads and absolute local file references never become readable attachments',async()=>{
  const row=request(1,'hi');(row.data.input as any[]).push({type:'localFile',path:'/private/example.txt',name:'example.txt',mimeType:'text/plain',sizeBytes:4});
  const h=harness([row,{threadId:'thr_local',seq:2,type:'item/completed',data:{item:{type:'toolCall',payload:{type:'localFile',path:'other.txt',name:'other.txt',mimeType:'text/plain',sizeBytes:4}}}}]);
  const value=await captureRemoteSnapshot(h.bb,{threadId:'thr_local'});expect(value.attachments).toEqual([]);expect(value.unavailable).toBe(1);expect(h.calls.some(c=>c.kind==='file')).toBe(false);
 });
 it('only explicitly selected stored project attachments travel; original private paths are not opened',async()=>{
  const row=request(1,'hi');(row.data.input as any[]).push({type:'localFile',sourceProjectId:'proj_local',path:'stored.txt',name:'original.txt',mimeType:'text/plain',sizeBytes:4});
  const h=harness([row]),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  expect(h.calls.filter(c=>c.kind==='file')).toHaveLength(1);
  h.calls.length=0;
  h.run();await handlers.remoteStart({...target,snapshotId:preview.snapshotId,attachments:[0]});await settled(h,preview.snapshotId);
  expect(h.calls.filter(c=>c.kind==='file').map(c=>c.args)).toEqual([{projectId:'proj_local',path:'stored.txt'}]);
  const start=h.calls.find(c=>c.method==='handoffBegin');expect(start.input.files.map((f:any)=>f.name)).toEqual(['handoff.md','conversation.jsonl','attachment-1.txt']);
  expect(start.input.serverId).toBe('alpha');expect(start.input.projectId).toBe('proj_alpha');
  expect(start.input.sourceThreadId).toBeUndefined();expect(start.input.parentThreadId).toBeUndefined();
 });
 it('changed snapshot fails before copying any bytes',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});h.rows[0].data.input[0].text='changed';
  h.run();await handlers.remoteStart({...target,snapshotId:preview.snapshotId});expect((await settled(h,preview.snapshotId)).error).toContain('Source changed');expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });
 it('lost response cannot repeat creation, even after handoff plugin reload',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});h.fail();
  h.run();await handlers.remoteStart({...target,snapshotId:preview.snapshotId});expect((await settled(h,preview.snapshotId)).error).toContain('Connection lost');
  await expect(createRemoteHandlers(h.bb).remoteStart({...target,snapshotId:preview.snapshotId})).rejects.toThrow('already been attempted');
  expect(h.calls.filter(c=>c.method==='handoffCommit')).toHaveLength(1);
 });
 it('acknowledges before slow capture finishes, then reports completion without a second start',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  const gate=deferred(),entered=deferred(),original=h.bb.sdk.threads.events.list;
  h.bb.sdk.threads.events.list=async(args:any)=>{entered.resolve();await gate.promise;return original(args);};
  h.run();
  try{
   expect(await handlers.remoteStart({...target,snapshotId:preview.snapshotId})).toMatchObject({state:'queued',operation:null});
   await entered.promise;
   expect(await handlers.remoteStatus({snapshotId:preview.snapshotId})).toMatchObject({phase:'Checking saved history and selected files',error:null});
   expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
   await expect(handlers.remoteStart({...target,snapshotId:preview.snapshotId})).rejects.toThrow(/progress|attempted/);
  }finally{gate.resolve();}
  expect((await settled(h,preview.snapshotId)).state).toBe('complete');
  expect(h.calls.filter(c=>c.method==='handoffCommit')).toHaveLength(1);
 });
 it('preserves the failed upload phase and operation identity; status never resends',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  const original=h.bb.sdk.plugins.callRpc;
  h.bb.sdk.plugins.callRpc=async(args:any)=>{if(args.method==='handoffUpload'&&args.input.index===1)throw Error('Synthetic upload timeout');return original(args);};
  h.run();await handlers.remoteStart({...target,snapshotId:preview.snapshotId});await settled(h,preview.snapshotId);
  expect(await handlers.remoteStatus({snapshotId:preview.snapshotId})).toMatchObject({state:'uncertain',phase:'Uploading file 2 of 2',error:expect.stringContaining('Synthetic upload timeout'),operation:{operationId:'22222222-2222-4222-8222-222222222222'}});
  await handlers.remoteStatus({snapshotId:preview.snapshotId});
  expect(h.calls.filter(c=>c.method==='handoffUpload')).toHaveLength(1);expect(h.calls.some(c=>c.method==='handoffCommit')).toBe(false);
 });
 it('does not replay queued work after a plugin reload',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  await handlers.remoteStart({...target,snapshotId:preview.snapshotId});
  const reloaded=createRemoteHandlers(h.bb);h.run();
  expect(await reloaded.remoteStatus({snapshotId:preview.snapshotId})).toMatchObject({state:'uncertain',error:expect.stringContaining('restarted')});
  await expect(reloaded.remoteStart({...target,snapshotId:preview.snapshotId})).rejects.toThrow('attempted');
  expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });
 it('stops before the next mutation when disabled during an upload',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  const gate=deferred(),entered=deferred(),original=h.bb.sdk.plugins.callRpc;
  h.bb.sdk.plugins.callRpc=async(args:any)=>{const value=await original(args);if(args.method==='handoffUpload'){entered.resolve();await gate.promise;}return value;};
  const worker=h.run();await handlers.remoteStart({...target,snapshotId:preview.snapshotId});await entered.promise;
  worker.abort();gate.resolve();await worker.done;
  expect((await settled(h,preview.snapshotId)).state).toBe('uncertain');
  expect(h.calls.filter(c=>c.method==='handoffUpload')).toHaveLength(1);expect(h.calls.some(c=>c.method==='handoffCommit')).toBe(false);
 });

 it('fences abort during a saved phase before issuing the remote call',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  const worker=h.run(),original=h.bb.storage.kv.set;
  h.bb.storage.kv.set=async(k:string,v:any)=>{await original(k,v);if(v.phase==='Checking the remote destination')worker.abort();};
  await handlers.remoteStart({...target,snapshotId:preview.snapshotId});await worker.done;
  expect((await settled(h,preview.snapshotId)).state).toBe('uncertain');
  expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });
 it('reads old uncertain snapshots without replay or invented failure detail',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});
  const row=h.store.get(`remote-handoff:${preview.snapshotId}`) as any;row.state='uncertain';
  expect(await handlers.remoteStatus({snapshotId:preview.snapshotId})).toEqual({state:'uncertain',phase:'uncertain',error:null,operation:null});
  expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });

});


describe('large remote history',()=>{
 it('captures over ten thousand events and four MiB, then uploads a lossless packed archive',async()=>{
  const rows=Array.from({length:12001},(_,i)=>request(i+1,'synthetic text '.repeat(40)));
  const h=harness(rows),handlers=createRemoteHandlers(h.bb);
  const value=await handlers.remotePrepare({threadId:'thr_local'});
  expect(value.eventCount).toBe(12001);expect(value.bytes).toBeGreaterThan(4*1024*1024);
  h.run();await handlers.remoteStart({...target,snapshotId:value.snapshotId,attachments:[]});
  expect((await settled(h,value.snapshotId)).state).toBe('complete');
  const begin=h.calls.find(c=>c.method==='handoffBegin');
  expect(begin.input.files[1].name).toBe('conversation-001.json');
  const uploaded=h.calls.find(c=>c.method==='handoffUpload'&&c.input.index===1);
  const part=JSON.parse(Buffer.from(uploaded.input.bytesBase64,'base64').toString());
  const {gunzipSync}=await import('node:zlib');
  const decoded=gunzipSync(Buffer.from(part.data,'base64')).toString();
  expect(decoded).toBe(rows.map(r=>JSON.stringify(r)+'\n').join(''));
 });
});


describe('packed transfer capacity',()=>{
 it('rejects incompressible history before preparing a transfer or making remote calls',async()=>{
  const {randomBytes}=await import('node:crypto');
  const h=harness([request(1,randomBytes(17*1024*1024).toString('base64'))]);
  await expect(createRemoteHandlers(h.bb).remotePrepare({threadId:'thr_local'})).rejects.toThrow('16 MiB');
  expect(h.store.size).toBe(0);
  expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });
});
