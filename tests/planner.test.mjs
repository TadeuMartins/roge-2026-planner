import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
vm.runInThisContext(fs.readFileSync('js/planner-model.js','utf8'));
vm.runInThisContext(fs.readFileSync('js/team-store.js','utf8'));
const M = globalThis.PlannerModel;
const event = (id, start='10:00', end='11:00', date='2026-09-21') => ({ id, start, end, date, title:'Sessão '+id, location:'Sala 1' });
const config = { owner:'example', repo:'planner', branch:'main', path:'data/team.json' };
const encode = data => Buffer.from(JSON.stringify(data)).toString('base64');
function backend(initial={version:1,assignments:{}}) {
  let data=structuredClone(initial), sha=1, puts=0, fail=null;
  const fetch=async(url,options) => {
    if(options.method==='PUT'){
      puts++;
      if(fail)return {ok:false,status:fail};
      const body=JSON.parse(options.body);
      if(body.sha!==String(sha))return {ok:false,status:409};
      data=JSON.parse(Buffer.from(body.content,'base64').toString());sha++;
      return {ok:true,json:async()=>({})};
    }
    return {ok:true,json:async()=>({sha:String(sha),content:encode(data)})};
  };
  return {fetch,get data(){return data},get puts(){return puts},set fail(value){fail=value}};
}
test('participant normalization preserves accents and removes duplicate names',()=>{
  assert.deepEqual(M.names([' Ana  Souza ','ana souza','José','']),['Ana Souza','José']);
  assert.throws(()=>M.names(['A'.repeat(81)]));
});
test('team conflicts require same person and true overlap',()=>{
  const events=[event('a'),event('b','10:30','11:30'),event('c','11:00','12:00'),event('d','10:00','11:00','2026-09-22')];
  const records={a:{names:['Ana']},b:{names:['ana','Bruno']},c:{names:['Carlos']},d:{names:['Ana']}};
  assert.equal(M.conflicts(events,records).length,1);
  assert.equal(M.overlaps(events[0],events[2]),false);
});
test('layout gives separate lanes for overlapping sessions and reuses adjacent lanes',()=>{
  const layout=M.layout([event('a','09:00','12:00'),event('b','10:00','11:00'),event('c','11:00','12:00'),event('d','12:00','13:00')]);
  assert.equal(layout[0].lanes,2);assert.equal(layout[1].lane,layout[2].lane);assert.equal(layout[3].lanes,1);
  for(const a of layout)for(const b of layout)if(a!==b&&M.overlaps(a.event,b.event))assert.notEqual(a.lane,b.lane);
});
test('ICS uses UTC, escapes text, folds UTF-8 at 75 bytes and includes team',()=>{
  const e={...event('abc'),title:'Ação; '+ 'energia, '.repeat(30),speakers_raw:'Linha 1\r\nLinha 2'};
  const ics=M.buildICS([e],{abc:{names:['João','Ana']}},new Date('2026-09-18T12:00:00Z'));
  assert.match(ics,/DTSTART:20260921T130000Z/);assert.match(ics,/DTEND:20260921T140000Z/);
  const unfolded=ics.replace(/\r\n /g,'');
  assert.ok(unfolded.includes('Equipe: João\\, Ana'));
  assert.ok(unfolded.includes('Ação\\; energia\\,'));
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
test('ICS uses all-day dates for unknown times and a positive fallback duration',()=>{
  assert.match(M.buildICS([event('a','','')]),/DTEND;VALUE=DATE:20260922/);
  assert.match(M.buildICS([event('b','10:00','')]),/DTEND:20260921T140000Z/);
});
test('shared assignments survive a new client and support multiple names/removal',async()=>{
  const backendState=backend(), writer=new TeamStore(config,backendState.fetch);writer.token='test-only';
  await writer.save(event('a'),['Ana','Bruno'],[]);
  const reader=new TeamStore(config,backendState.fetch);
  assert.deepEqual((await reader.read()).data.assignments.a.names,['Ana','Bruno']);
  await writer.save(event('a'),[],['Ana','Bruno']);
  assert.equal((await reader.read()).data.assignments.a,undefined);
});
test('edits to different events preserve both assignments',async()=>{
  const state=backend(), writer=new TeamStore(config,state.fetch);writer.token='test-only';
  await writer.save(event('a'),['Ana'],[]);await writer.save(event('b'),['Bruno'],[]);
  assert.deepEqual(Object.keys(state.data.assignments),['a','b']);
});
test('same-event concurrent edit fails without overwriting saved names',async()=>{
  const state=backend(), writer=new TeamStore(config,state.fetch);writer.token='test-only';
  await writer.save(event('a'),['Ana'],[]);
  await assert.rejects(writer.save(event('a'),['Bruno'],[]),/Outra pessoa/);
  assert.deepEqual(state.data.assignments.a.names,['Ana']);assert.equal(state.puts,1);
});
test('409 file conflict is retried against latest file without losing other events',async()=>{
  let reads=0,puts=0,payload;
  const fetch=async(url,options)=>{
    if(options.method==='PUT'){puts++;if(puts===1)return {ok:false,status:409};payload=JSON.parse(Buffer.from(JSON.parse(options.body).content,'base64').toString());return {ok:true,json:async()=>({})};}
    reads++;return {ok:true,json:async()=>({sha:String(reads),content:encode({version:1,assignments:reads>1?{b:{names:['Bruno']}}:{}})})};
  };
  const writer=new TeamStore(config,fetch);writer.token='test-only';
  await writer.save(event('a'),['Ana'],[]);
  assert.equal(puts,2);assert.deepEqual(payload.assignments.b.names,['Bruno']);
});
test('failed remote save never reports success or changes authoritative data',async()=>{
  const state=backend(), writer=new TeamStore(config,state.fetch);writer.token='test-only';state.fail=403;
  await assert.rejects(writer.save(event('a'),['Ana'],[]),/permissão/);
  assert.deepEqual(state.data.assignments,{});
});
test('read-only visitors cannot save',async()=>{
  const state=backend(), reader=new TeamStore(config,state.fetch);
  await assert.rejects(reader.save(event('a'),['Ana'],[]),/Conecte/);assert.equal(state.puts,0);
});
