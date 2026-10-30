import {createHash} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const compress=promisify(gzip);

export const REMOTE_FILE_BYTES=4*1024*1024;
export const REMOTE_SOURCE_BYTES=128*1024*1024;
export const REMOTE_SOURCE_EVENTS=250000;
export type RemoteArchiveFile={name:string,mimeType:string,bytes:Uint8Array};
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** Keep the federation text-file contract; compression is lossless and local. */
export async function packRemoteArchive(archive:Uint8Array):Promise<RemoteArchiveFile[]>{
 if(archive.byteLength>REMOTE_SOURCE_BYTES)throw Error('Saved history exceeds the 128 MiB preparation budget; no transfer was started');
 if(archive.byteLength<=REMOTE_FILE_BYTES)return [{name:'conversation.jsonl',mimeType:'application/x-ndjson',bytes:archive}];
 const encoded=(await compress(archive)).toString('base64'),chunkChars=3*1024*1024,count=Math.ceil(encoded.length/chunkChars);
 if(count>14)throw Error('Compressed history exceeds the remote transfer capacity; no history was omitted or sent');
 const digest=sha(archive);
 return Array.from({length:count},(_,index)=>({
  name:`conversation-${String(index+1).padStart(3,'0')}.json`,mimeType:'application/json',
  bytes:Buffer.from(JSON.stringify({format:'bb-handoff-gzip-base64-v1',index,count,rawBytes:archive.byteLength,sha256:digest,data:encoded.slice(index*chunkChars,(index+1)*chunkChars)})+'\n'),
 }));
}

export function remoteArchiveInstructions(files:RemoteArchiveFile[]):string{
 if(files[0]?.name==='conversation.jsonl')return 'Read conversation.jsonl in bounded chunks.';
 return [
  'The complete saved history is compressed losslessly in conversation-NNN.json files. Reconstruct conversation.jsonl locally with Python before reading it in bounded chunks. Do not print the encoded data or the entire history.',
  '```python',
  'import base64, gzip, hashlib, json',
  'from pathlib import Path',
  'parts = [json.loads(p.read_text()) for p in sorted(Path(".").glob("conversation-*.json"))]',
  'assert parts and len(parts) == parts[0]["count"]',
  'for i, p in enumerate(parts):',
  '    assert p["format"] == "bb-handoff-gzip-base64-v1" and p["index"] == i',
  '    assert all(p[k] == parts[0][k] for k in ("count", "sha256", "rawBytes"))',
  'packed = base64.b64decode("".join(p["data"] for p in parts), validate=True)',
  'raw = gzip.decompress(packed)',
  'assert len(raw) == parts[0]["rawBytes"] and len(raw) <= 128 * 1024 * 1024',
  'assert hashlib.sha256(raw).hexdigest() == parts[0]["sha256"]',
  'Path("conversation.jsonl").write_bytes(raw)',
  '```',
 ].join('\n');
}
