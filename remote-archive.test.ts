import {describe,it,expect} from 'vitest';
import {randomBytes,createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {packRemoteArchive,remoteArchiveInstructions,REMOTE_FILE_BYTES} from './remote-archive';

describe('lossless remote archive',()=>{
 it('preserves the existing uncompressed small-file contract',async()=>{
  const bytes=Buffer.from('{"seq":1}\n');const parts=await packRemoteArchive(bytes);
  expect(parts).toEqual([{name:'conversation.jsonl',mimeType:'application/x-ndjson',bytes}]);
  expect(remoteArchiveInstructions(parts)).toContain('Read conversation.jsonl');
 });
 it('packs oversized individual events and multiple chunks without truncation',async()=>{
  const bytes=Buffer.from(JSON.stringify({seq:1,text:randomBytes(5*1024*1024).toString('base64')})+'\n');
  const parts=await packRemoteArchive(bytes);expect(parts.length).toBeGreaterThan(1);
  for(const part of parts){expect(part.bytes.byteLength).toBeLessThan(REMOTE_FILE_BYTES);expect(part.mimeType).toBe('application/json');}
  const envelopes=parts.map(p=>JSON.parse(Buffer.from(p.bytes).toString()));
  envelopes.forEach((p,i)=>{expect(p.index).toBe(i);expect(p.count).toBe(parts.length);});
  const unpacked=gunzipSync(Buffer.from(envelopes.map(p=>p.data).join(''),'base64'));
  expect(unpacked.equals(bytes)).toBe(true);
  expect(createHash('sha256').update(unpacked).digest('hex')).toBe(envelopes[0].sha256);
  expect(remoteArchiveInstructions(parts)).toContain('hashlib.sha256');
 });
});
