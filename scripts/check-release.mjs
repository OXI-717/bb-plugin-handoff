import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export function checkRelease(p, lock, tag) {
  assert.equal(p.name, 'bb-plugin-handoff');
  assert.equal(p.bb.name, 'OXI Handoff');
  assert.match(p.bb.description, /^[\x20-\x7e]{30,140}$/);
  assert.match(p.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(lock.name, p.name);
  assert.equal(lock.packages[''].name, p.name);
  assert.equal(lock.version, p.version);
  assert.equal(lock.packages[''].version, p.version);
  if (tag !== undefined) assert.equal(tag, `v${p.version}`);
}
if (process.argv[1]?.endsWith('/check-release.mjs')) {
  checkRelease(JSON.parse(readFileSync('package.json')), JSON.parse(readFileSync('package-lock.json')),
    process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  console.log('Release identity verified.');
}
