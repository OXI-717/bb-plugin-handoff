import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
// @ts-expect-error The standalone release gate is also executed directly by Node.
import {checkRelease} from './scripts/check-release.mjs';
const read=(file:string)=>JSON.parse(readFileSync(new URL(file,import.meta.url),'utf8'));
describe('release identity',()=>{
 it('accepts this package and matching immutable tag',()=>{
  const p=read('package.json');expect(()=>checkRelease(p,read('package-lock.json'),`v${p.version}`)).not.toThrow();
 });
 it('rejects identity, description, version and tag drift',()=>{
  for(const mutate of [(p:any)=>p.name='other',(p:any)=>p.bb.name='Handoff',(p:any)=>p.bb.description='Описание',(p:any)=>p.bb.description='x'.repeat(141),(p:any)=>p.version='01.2.3']){
   const p=read('package.json');mutate(p);expect(()=>checkRelease(p,read('package-lock.json'))).toThrow();
  }
  expect(()=>checkRelease(read('package.json'),read('package-lock.json'),'v0.8.2')).toThrow();
  const lock=read('package-lock.json');lock.packages[''].version='0.0.0';expect(()=>checkRelease(read('package.json'),lock)).toThrow();
 });
 it('keeps the main panel title aligned without renaming actions',()=>{
  const app=readFileSync(new URL('app.tsx',import.meta.url),'utf8');
  expect(app).toMatch(/id: "handoff",\s+title: "OXI Handoff"/);
  expect(app).toContain('title: "Hand off from here"');
 });
});
