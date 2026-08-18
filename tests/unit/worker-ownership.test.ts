import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source=fs.readFileSync(new URL("../../jobs-worker/index.ts",import.meta.url),"utf8");

function functionSource(name:string,nextName:string){
  const start=source.indexOf(`async function ${name}`);
  const end=source.indexOf(`async function ${nextName}`,start+1);
  assert.ok(start>=0,`${name} must exist`);
  assert.ok(end>start,`${nextName} must follow ${name}`);
  return source.slice(start,end);
}

test("every terminal job transition requires the current worker lock",()=>{
  const complete=functionSource("completeJob","blockJob");
  const block=functionSource("blockJob","failJob");
  const fail=functionSource("failJob","heartbeat");
  assert.match(complete,/where id=\$1 and locked_by=\$3 and status='running'/);
  assert.match(block,/where id=\$1 and locked_by=\$6 and status='running'/);
  assert.match(fail,/where id=\$1 and locked_by=\$5 and status='running'/);
  for(const implementation of[complete,block,fail]){
    assert.match(implementation,/returning id/);
    assert.match(implementation,/if\(transition\.rowCount!==1\)return false/);
    assert.match(implementation,/worker_id=\$3 and status='running'/);
  }
});

