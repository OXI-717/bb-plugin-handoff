import {describe,it,expect} from 'vitest';
import {captureRemoteSnapshot,createRemoteHandlers} from './remote-handoff';

const request=(seq:number,text:string)=>({threadId:'thr_local',seq,type:'client/turn/requested',data:{initiator:'user',input:[{type:'text',text}]}});
function harness(rows:any[]=[request(1,'first'),request(2,'last')]){
 const calls:any[]=[],store=new Map<string,unknown>();let uploads=0,failCommit=false;
 const bb:any={storage:{kv:{get:async(k:string)=>structuredClone(store.get(k)),set:async(k:string,v:unknown)=>{store.set(k,structuredClone(v));}}},sdk:{
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
 return {bb,calls,rows,store,fail:()=>{failCommit=true;}};
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
  await expect(handlers.remoteStart({...target,snapshotId:value.snapshotId,attachments:[0]})).rejects.toThrow('Attachment changed');
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
  await handlers.remoteStart({...target,snapshotId:preview.snapshotId,attachments:[0]});
  expect(h.calls.filter(c=>c.kind==='file').map(c=>c.args)).toEqual([{projectId:'proj_local',path:'stored.txt'}]);
  const start=h.calls.find(c=>c.method==='handoffBegin');expect(start.input.files.map((f:any)=>f.name)).toEqual(['handoff.md','conversation.jsonl','attachment-1.txt']);
  expect(start.input.serverId).toBe('alpha');expect(start.input.projectId).toBe('proj_alpha');
  expect(start.input.sourceThreadId).toBeUndefined();expect(start.input.parentThreadId).toBeUndefined();
 });
 it('changed snapshot fails before copying any bytes',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});h.rows[0].data.input[0].text='changed';
  await expect(handlers.remoteStart({...target,snapshotId:preview.snapshotId})).rejects.toThrow('Source changed');expect(h.calls.some(c=>c.kind==='rpc')).toBe(false);
 });
 it('lost response cannot repeat creation, even after handoff plugin reload',async()=>{
  const h=harness(),handlers=createRemoteHandlers(h.bb),preview=await handlers.remotePrepare({threadId:'thr_local'});h.fail();
  await expect(handlers.remoteStart({...target,snapshotId:preview.snapshotId})).rejects.toThrow('Connection lost');
  await expect(createRemoteHandlers(h.bb).remoteStart({...target,snapshotId:preview.snapshotId})).rejects.toThrow('already been attempted');
  expect(h.calls.filter(c=>c.method==='handoffCommit')).toHaveLength(1);
 });
});
