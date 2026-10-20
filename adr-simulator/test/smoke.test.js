import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const port=18089; let child;
test('health and simulator session flow', async (t)=>{
  child=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
  t.after(()=>child?.kill());
  let ready=false; for(let i=0;i<30;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok){ready=true;break;}}catch{} await delay(150);}
  assert.equal(ready,true,'server should start');
  const created=await fetch(`http://127.0.0.1:${port}/api/v1/simulator/sessions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:'success',seed:7})}).then(r=>r.json());
  const sid=created.data.session.id; assert.ok(sid);
  const meters=await fetch(`http://127.0.0.1:${port}/api/v1/simulator/sessions/${sid}/meter-readings?limit=12`).then(r=>r.json()); assert.equal(meters.data.length,12);
  const event=await fetch(`http://127.0.0.1:${port}/api/v1/simulator/sessions/${sid}/events`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetReductionKw:25})}).then(r=>r.json());
  const executed=await fetch(`http://127.0.0.1:${port}/api/v1/simulator/sessions/${sid}/events/${event.data.eventId}/execute`,{method:'POST'}).then(r=>r.json());
  assert.equal(executed.data.eventStatus,'COMPLETED'); assert.equal(executed.data.mv.reliefKw,32);
});
