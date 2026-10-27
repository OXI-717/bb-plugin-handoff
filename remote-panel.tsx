import {useEffect,useRef,useState} from 'react';
import {useRpc} from '@bb/plugin-sdk/app';
import type {rpcContract} from './server';
import {Button} from './components/ui/button';
import {Label} from './components/ui/label';
import {Textarea} from './components/ui/textarea';

type Server={serverId:string,projectId:string,label:string,available:boolean,targets:Array<{hostId:string,hostName:string,environmentId:string,path:string|null}>};
type Preview={snapshotId:string,sourceThreadId:string,sourceProjectId:string,title:string,eventCount:number,cutoff:number,bytes:number,attachments:Array<{name:string,path:string,mimeType:string,sizeBytes:number}>,unavailable:number};
type Model={model:string,displayName:string,isDefault:boolean,defaultReasoningEffort:string|null,supportedReasoningEfforts:Array<{reasoningEffort:string,description:string}>};
const selectClass='w-full rounded border bg-background p-2 text-sm';
export function RemoteHandoffPanel({threadId,upToSeq,onBack}:{threadId:string,upToSeq?:number,onBack:()=>void}){
 const rpc=useRpc<typeof rpcContract>(),lock=useRef(false);
 const [servers,setServers]=useState<Server[]>([]),[serverId,setServerId]=useState(''),[environmentId,setEnvironmentId]=useState('');
 const [providers,setProviders]=useState<Array<{id:string,displayName:string,available:boolean}>>([]),[providerId,setProviderId]=useState('');
 const [models,setModels]=useState<Model[]>([]),[model,setModel]=useState(''),[effort,setEffort]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null),[selected,setSelected]=useState<number[]>([]),[instructions,setInstructions]=useState('');
 const [error,setError]=useState(''),[stage,setStage]=useState('Loading remote servers…'),[pending,setPending]=useState(false),[attempted,setAttempted]=useState(false);
 const [complete,setComplete]=useState<{projectId:string,threadId:string}|null>(null);
 const server=servers.find(s=>s.serverId===serverId),env=server?.targets.find(e=>e.environmentId===environmentId);
 const target=server&&env?{serverId:server.serverId,projectId:server.projectId,hostId:env.hostId,environmentId:env.environmentId}:null;
 useEffect(()=>{let live=true;rpc.call('remoteTargets',null).then(rows=>{if(live){setServers(rows);setStage(rows.length?'':'No writable federation connections are configured.');}}).catch(e=>{if(live){setError(String(e));setStage('Remote handoff requires the matching federation plugin version.');}});return()=>{live=false;};},[rpc]);
 useEffect(()=>{
  let live=true;setPreview(null);setSelected([]);setAttempted(false);setComplete(null);
  rpc.call('remotePrepare',{threadId,...(upToSeq?{upToSeq}:{})}).then(value=>{if(live)setPreview(value);}).catch(e=>{if(live)setError(String(e));});
  return()=>{live=false;};
 },[rpc,threadId,upToSeq]);
 useEffect(()=>{
  let live=true;setProviders([]);setModels([]);setProviderId('');setModel('');setEffort('');
  if(target)rpc.call('remoteOptions',target).then(value=>{if(live)setProviders(value.providers);}).catch(e=>{if(live)setError(String(e));});
  return()=>{live=false;};
 },[rpc,serverId,environmentId]);
 useEffect(()=>{
  let live=true;setModels([]);setModel('');setEffort('');
  if(target&&providerId)rpc.call('remoteOptions',{...target,providerId}).then(value=>{if(live){setModels(value.models);const first=value.models.find(m=>m.isDefault)??value.models[0];setModel(first?.model??'');setEffort(first?.defaultReasoningEffort??'');}}).catch(e=>{if(live)setError(String(e));});
  return()=>{live=false;};
 },[rpc,serverId,environmentId,providerId]);
 const activeModel=models.find(m=>m.model===model);
 async function start(){
  if(!preview||!target||!providerId||!model||lock.current||attempted)return;
  lock.current=true;setPending(true);setAttempted(true);setError('');setStage('Copying the selected snapshot and files, then creating one remote session…');
  try{
   const value=await rpc.call('remoteStart',{...target,providerId,model,...(effort?{reasoningLevel:effort as 'medium'}:{}),snapshotId:preview.snapshotId,attachments:selected,instructions});
   if(value.threadId){setComplete({projectId:value.projectId,threadId:value.threadId});setStage('Remote session created. Model completion has not been verified.');}
  }catch(e){setError(String(e));setStage('The transfer was not retried. Check its status before creating another.');}
  finally{setPending(false);}
 }
 async function status(){
  if(!preview)return;setError('');
  try{const value=await rpc.call('remoteStatus',{snapshotId:preview.snapshotId});setStage(`Transfer: ${value.operation?.state??value.state}`);if(value.operation?.threadId)setComplete({projectId:value.operation.projectId,threadId:value.operation.threadId});}
  catch(e){setError(String(e));}
 }
 return <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
  <Button variant="outline" onClick={onBack} disabled={pending}>Back to machines on this BB</Button>
  <h2 className="font-semibold">🌐 Hand off to a remote BB</h2>
  <p className="text-sm text-muted-foreground">Copies saved conversation events and the attachments you select. The working directory, credentials and native provider session stay on the source server. Remote machines are not enrolled here.</p>
  <fieldset disabled={pending||attempted} className="flex min-w-0 flex-col gap-3">
   <Label htmlFor="remote-server">Remote server / project</Label>
   <select id="remote-server" className={selectClass} value={serverId} onChange={e=>{setServerId(e.target.value);setEnvironmentId('');setError('');}}>
    <option value="">Choose a remote server</option>{servers.map(s=><option key={s.serverId} value={s.serverId} disabled={!s.available}>{s.label} — {s.projectId}{s.available?'':' (unavailable or read-only)'}</option>)}
   </select>
   <Label htmlFor="remote-environment">Remote machine / existing workspace</Label>
   <select id="remote-environment" className={selectClass} value={environmentId} onChange={e=>setEnvironmentId(e.target.value)}>
    <option value="">Choose a ready remote workspace</option>{server?.targets.map(t=><option key={t.environmentId} value={t.environmentId}>🌐 {server.label} / {t.hostName} — {t.path??t.environmentId}</option>)}
   </select>
   {server?.available&&!server.targets.length&&<p className="text-sm">This project has no ready environment on a connected remote machine. Create one on that server first.</p>}
   <Label htmlFor="remote-provider">Provider on the destination</Label>
   <select id="remote-provider" className={selectClass} value={providerId} onChange={e=>setProviderId(e.target.value)}><option value="">Choose a provider</option>{providers.map(p=><option key={p.id} value={p.id} disabled={!p.available}>{p.displayName}</option>)}</select>
   <Label htmlFor="remote-model">Model on the destination</Label>
   <select id="remote-model" className={selectClass} value={model} onChange={e=>{setModel(e.target.value);setEffort(models.find(m=>m.model===e.target.value)?.defaultReasoningEffort??'');}}><option value="">Choose a model</option>{models.map(m=><option key={m.model} value={m.model}>{m.displayName}</option>)}</select>
   {!!activeModel?.supportedReasoningEfforts.length&&<><Label htmlFor="remote-effort">Reasoning effort</Label><select id="remote-effort" className={selectClass} value={effort} onChange={e=>setEffort(e.target.value)}><option value="">Provider default</option>{activeModel.supportedReasoningEfforts.map(e=><option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></>}
   {preview&&<div className="rounded border p-3 text-sm">
    <p className="font-medium">Source: {preview.title}</p><p>{preview.eventCount} saved events · {Math.ceil(preview.bytes/1024)} KiB · through event {preview.cutoff}</p>
    <p>The recorded history may include private text and tool output. Clicking the button below copies this snapshot to the selected server.</p>
    <p className="mt-2">Attachments (none selected by default):</p>
    {preview.attachments.map((f,i)=><label className="my-1 flex gap-2" key={f.path}><input type="checkbox" checked={selected.includes(i)} onChange={e=>setSelected(current=>e.target.checked?[...current,i]:current.filter(n=>n!==i))}/><span>{f.name} · {Math.ceil(f.sizeBytes/1024)} KiB</span></label>)}
    {!!preview.unavailable&&<p>{preview.unavailable} unsupported references will remain text only. No local paths are read.</p>}
   </div>}
   <Label htmlFor="remote-instructions">Instructions for continuation</Label><Textarea id="remote-instructions" value={instructions} maxLength={8000} onChange={e=>setInstructions(e.target.value)}/>
  </fieldset>
  {target&&<p className="text-sm">Destination: {server!.label} → {target.projectId} → {env!.hostName}. Permissions and execution belong to that remote server.</p>}
  <Button onClick={()=>void start()} disabled={pending||attempted||!preview||!target||!providerId||!model||selected.length>14}>Copy selected context and start remote session</Button>
  {stage&&<p className="text-sm" role="status">{stage}</p>}{error&&<p className="text-sm text-destructive" role="alert">{error}</p>}
  {attempted&&<Button variant="outline" onClick={()=>void status()} disabled={pending}>Check transfer status (does not resend)</Button>}
  {complete&&<a className="underline" href={`/projects/${encodeURIComponent(complete.projectId)}/threads/${encodeURIComponent(complete.threadId)}`}>Open the remote session</a>}
 </div>;
}
