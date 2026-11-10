// @vitest-environment jsdom
import {it,expect,vi} from 'vitest';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
const {rpc}=vi.hoisted(()=>({rpc:{call:vi.fn()}}));
vi.mock('@bb/plugin-sdk/app',()=>({useRpc:()=>rpc}));
import {RemoteHandoffPanel} from './remote-panel';

it('keeps a preparation failure visible after destination selection and allows retry without starting',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 let failed=true;
 rpc.call.mockImplementation(async(method:string)=>{
  if(method==='remoteTargets')return [{serverId:'synthetic',projectId:'proj_test',label:'Synthetic',available:true,targets:[{hostId:'host_test',hostName:'Synthetic',environmentId:'env_test',path:null}]}];
  if(method==='remotePrepare'){if(failed)throw Error('Synthetic preparation failure');return {snapshotId:'snapshot',title:'Synthetic',eventCount:1,bytes:100,cutoff:1,attachments:[],unavailable:0};}
  if(method==='remoteOptions')return {providers:[],models:[]};
  throw Error('Unexpected mutation');
 });
 const container=document.createElement('div'),root=createRoot(container);document.body.append(container);
 try{
  await act(async()=>root.render(<RemoteHandoffPanel threadId="thr_test" onBack={()=>{}}/>));
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Synthetic preparation failure');
  await act(async()=>{const select=container.querySelector('#remote-server') as HTMLSelectElement;select.value='synthetic';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Synthetic preparation failure');
  const start=()=>[...container.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Copy selected'))!;
  expect(start().disabled).toBe(true);
  failed=false;
  await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Retry preparing history')!.click());
  expect(container.querySelector('[role=alert]')).toBeNull();
  expect(container.textContent).toContain('1 saved events');
  expect(rpc.call.mock.calls.some(([method])=>method==='remoteStart')).toBe(false);
 }finally{await act(async()=>root.unmount());container.remove();}
});

it('enables a small prepared session after choosing a complete destination',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
 rpc.call.mockReset();
 rpc.call.mockImplementation(async(method:string)=>{
  if(method==='remoteTargets')return [{serverId:'synthetic',projectId:'proj_test',label:'Synthetic',available:true,targets:[{hostId:'host_test',hostName:'Synthetic',environmentId:'env_test',path:null}]}];
  if(method==='remotePrepare')return {snapshotId:'snapshot',title:'Synthetic',eventCount:1,bytes:100,cutoff:1,attachments:[],unavailable:0};
  if(method==='remoteOptions')return {providers:[{id:'test-provider',displayName:'Synthetic',available:true}],models:[{model:'test-model',displayName:'Synthetic',isDefault:true,defaultReasoningEffort:null,supportedReasoningEfforts:[]}]};
  throw Error('Unexpected mutation');
 });
 const container=document.createElement('div'),root=createRoot(container);document.body.append(container);
 try{
  await act(async()=>root.render(<RemoteHandoffPanel threadId="thr_test" onBack={()=>{}}/>));
  for(const [id,value] of [['remote-server','synthetic'],['remote-environment','env_test'],['remote-provider','test-provider']]){
   await act(async()=>{const select=container.querySelector('#'+id) as HTMLSelectElement;select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));});
  }
  const start=[...container.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Copy selected'))!;
  expect(start.disabled).toBe(false);
  expect(rpc.call.mock.calls.some(([method])=>method==='remoteStart')).toBe(false);
 }finally{await act(async()=>root.unmount());container.remove();}
});

it('prepares an explicitly selected remote thread without starting it',async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});rpc.call.mockReset();
 rpc.call.mockImplementation(async(method:string,input:any)=>{
  if(method==='remoteTargets')return [{serverId:'synthetic',projectId:'proj_test',label:'Synthetic',available:true,targets:[]}];
  if(method==='remotePrepare')return {snapshotId:'snapshot',sourceThreadId:input.threadId,sourceProjectId:'proj_test',title:'Synthetic',eventCount:1,bytes:100,cutoff:1,attachments:[],unavailable:0};
  throw Error('Unexpected mutation');
 });
 const container=document.createElement('div'),root=createRoot(container);document.body.append(container);
 try{
  await act(async()=>root.render(<RemoteHandoffPanel threadId="thr_primary" upToSeq={4} onBack={()=>{}}/>));
  await act(async()=>{const select=container.querySelector('select')!;select.value='synthetic';select.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{const input=container.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'thr_remote');input.dispatchEvent(new Event('input',{bubbles:true}));});
  const calls=rpc.call.mock.calls.filter(([method])=>method==='remotePrepare');
  expect(calls.at(-1)?.[1]).toEqual({threadId:'thr_remote',source:{serverId:'synthetic',projectId:'proj_test'}});
  expect(container.textContent).toContain('synthetic / proj_test / thr_remote');
  expect(rpc.call.mock.calls.some(([method])=>method==='remoteStart')).toBe(false);
 }finally{await act(async()=>root.unmount());container.remove();}
});
