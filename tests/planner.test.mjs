import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSeed } from '../scripts/prepare-supabase.mjs';
vm.runInThisContext(fs.readFileSync('js/planner-model.js','utf8'));
vm.runInThisContext(fs.readFileSync('js/team-store.js','utf8'));
const M = globalThis.PlannerModel;
const event = (id, start='10:00', end='11:00', date='2026-09-21') => ({ id, start, end, date, title:'Sessão '+id, location:'Sala 1' });
const config = { url:'https://example.supabase.co/', publishableKey:'sb_publishable_test_only' };
function backend(initial={version:1,assignments:{}}) {
  let data=structuredClone(initial), saves=0, fail=null;
  const calls=[], events=new Map(['a','b'].map(id=>[id,event(id)]));
  const fetch=async(url,options) => {
    calls.push({url,options});
    assert.equal(options.method,'POST');
    const body=JSON.parse(options.body);
    if(url.endsWith('/save_team_assignment')){
      saves++;
      if(fail)return {ok:false,status:fail};
      const {p_event_id:id,p_names:names,p_expected_names:expected}=body;
      if(!events.has(id))return {ok:false,status:404};
      if(JSON.stringify(data.assignments[id]?.names || [])!==JSON.stringify(expected))return {ok:false,status:409};
      if(names.length)data.assignments[id]={names,event:events.get(id),updated_at:'2026-09-18T12:00:00Z'};
      else delete data.assignments[id];
    }else{
      assert.ok(url.endsWith('/get_team_schedule'));
      assert.deepEqual(body,{});
    }
    const snapshot=structuredClone(data);
    return {ok:true,json:async()=>snapshot};
  };
  return {fetch,calls,get data(){return data},get saves(){return saves},set fail(value){fail=value}};
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
test('unconfigured stores expose false and reject read/save without a network request',async()=>{
  const state=backend();
  for(const config of [{},{url:'',publishableKey:''},{url:'https://example.supabase.co',publishableKey:' '},{url:'',publishableKey:'public'}]){
    const store=new TeamStore(config,state.fetch);
    assert.equal(store.configured,false);
    await assert.rejects(store.read(),/Supabase não configurado/);
    await assert.rejects(store.save(event('a'),['Ana'],[]),/Supabase não configurado/);
  }
  assert.equal(state.calls.length,0);
  vm.runInThisContext(fs.readFileSync('js/team-config.js','utf8'));
  assert.match(globalThis.ROGE_TEAM_CONFIG.url,/^https:\/\/[a-z]+\.supabase\.co$/);
  assert.match(globalThis.ROGE_TEAM_CONFIG.publishableKey,/^sb_publishable_/);
});
test('anonymous public roundtrip supports add, update, delete and a fresh client',async()=>{
  const state=backend(), writer=new TeamStore(config,state.fetch), reader=new TeamStore(config,state.fetch);
  assert.equal(writer.configured,true);
  assert.equal('token' in writer,false);assert.equal('authorize' in writer,false);
  assert.deepEqual(await reader.read(),{data:{version:1,assignments:{}}});
  const saved=await writer.save({...event('a'),title:'Untrusted metadata'},[' Ana  Souza ','ana souza','José'],[]);
  assert.deepEqual(saved.assignments.a.names,['Ana Souza','José']);
  assert.deepEqual(saved.assignments.a.event,event('a'));
  assert.deepEqual((await reader.read()).data,saved);
  const updated=await reader.save(event('a'),['Ana Souza','José','Bruno'],saved.assignments.a.names);
  assert.deepEqual(updated.assignments.a.names,['Ana Souza','José','Bruno']);
  assert.deepEqual(await writer.save(event('a'),[],updated.assignments.a.names),{version:1,assignments:{}});
  assert.equal((await reader.read()).data.assignments.a,undefined);
  for(const {url,options} of state.calls){
    assert.ok(url.startsWith('https://example.supabase.co/rest/v1/rpc/'));
    assert.equal(options.headers.apikey,config.publishableKey);
    assert.equal(options.headers.Authorization,undefined);
    assert.equal(options.cache,'no-store');assert.ok(options.signal instanceof AbortSignal);
  }
});
test('edits to different events preserve both assignments',async()=>{
  const state=backend(), writer=new TeamStore(config,state.fetch), other=new TeamStore(config,state.fetch);
  const [,saved]=await Promise.all([writer.save(event('a'),['Ana'],[]),other.save(event('b'),['Bruno'],[])]);
  assert.deepEqual(Object.keys(state.data.assignments),['a','b']);
  assert.deepEqual(saved,state.data);
  assert.equal(state.calls.length,2);
});
test('same-event concurrent edit fails without overwriting saved names',async()=>{
  const state=backend(), writer=new TeamStore(config,state.fetch), other=new TeamStore(config,state.fetch);
  const results=await Promise.allSettled([writer.save(event('a'),['Ana'],[]),other.save(event('a'),['Bruno'],[])]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
  assert.equal(results[1].reason.status,409);assert.match(results[1].reason.message,/Outra pessoa/);
  assert.deepEqual(state.data.assignments.a.names,['Ana']);assert.equal(state.saves,2);
  assert.equal(state.calls.length,2);
  const latest=(await other.read()).data;
  await other.save(event('a'),['Bruno'],latest.assignments.a.names);
  assert.deepEqual(state.data.assignments.a.names,['Bruno']);
});
test('save returns the authoritative full RPC snapshot with no pre/post read',async()=>{
  const snapshot={version:1,assignments:{a:{names:['Ana'],event:event('a')},old:{names:['José'],event:{id:'old',title:'Removed event'}}}};
  let calls=0;
  const fetch=async(url,options)=>{
    calls++;
    assert.equal(url,'https://example.supabase.co/rest/v1/rpc/save_team_assignment');
    assert.deepEqual(JSON.parse(options.body),{p_event_id:'a',p_names:['Ana'],p_expected_names:[]});
    return {ok:true,json:async()=>snapshot};
  };
  assert.deepEqual(await new TeamStore(config,fetch).save(event('a'),[' Ana ','ana'],[]),snapshot);
  assert.equal(calls,1);
});
test('unauthorized and failed saves reject without retry or local success',async()=>{
  for(const status of [400,401,403,404,409,429,500,503]){
    const state=backend(), writer=new TeamStore(config,state.fetch);state.fail=status;
    await assert.rejects(writer.save(event('a'),['Ana'],[]),error=>error.status===status);
    assert.deepEqual(state.data.assignments,{});assert.equal(state.calls.length,1);
  }
});
test('unknown but well-formed event IDs are rejected by the RPC',async()=>{
  const state=backend();
  await assert.rejects(new TeamStore(config,state.fetch).save(event('unknown'),['Ana'],[]),error=>error.status===404);
  assert.deepEqual(state.data.assignments,{});
});
test('legacy public anon JWT uses Bearer as well as apikey',async()=>{
  const state=backend(), key='eyJ.legacy-anon.test-only';
  await new TeamStore({...config,publishableKey:key},state.fetch).read();
  assert.equal(state.calls[0].options.headers.Authorization,'Bearer '+key);
  assert.equal(state.calls[0].options.headers.apikey,key);
});
test('network or invalid response failures propagate without an automatic retry',async()=>{
  for(const response of [null,{version:2,assignments:{}},{version:1,assignments:[]},{version:1,assignments:{a:{names:[null]}}}]){
    const store=new TeamStore(config,async()=>({ok:true,json:async()=>response}));
    await assert.rejects(store.read());
    await assert.rejects(store.save(event('a'),['Ana'],[]));
  }
  let calls=0;
  const writer=new TeamStore(config,async()=>{calls++;throw new Error('Connection lost after possible commit');});
  await assert.rejects(writer.save(event('a'),['Ana'],[]),/Connection lost/);
  assert.equal(calls,1);
  await assert.rejects(new TeamStore(config,async()=>({ok:false,status:403})).read(),error=>error.status===403);
});
test('validation rejects malformed schedules, unsafe arrays, duplicates and limits',async()=>{
  const state=backend(), store=new TeamStore(config,state.fetch);
  for(const data of [undefined,null,[],{}, {version:1,assignments:null},{version:1,assignments:[]},
    {version:1,assignments:{'bad.id':{names:[]}}},{version:1,assignments:{a:null}}])assert.throws(()=>store.validate(data));
  const invalid=[null,undefined,'Ana',[null],[1],[{}],[['Ana']],Array(1),['A'.repeat(81)],['😀'.repeat(41)],['Ana\u0001'],Array.from({length:31},(_,i)=>'Person '+i)];
  for(const names of invalid){
    assert.throws(()=>store.validate({version:1,assignments:{a:{names}}}));
    await assert.rejects(store.save(event('a'),names,[]));
    await assert.rejects(store.save(event('a'),[],names));
  }
  for(const names of [[' Ana '],['Ana','ana'],['']])assert.throws(()=>store.validate({version:1,assignments:{a:{names}}}));
  for(const id of ['',null,12,'a/b','a'.repeat(101)])await assert.rejects(store.save({id},[],[]));
  assert.equal(state.calls.length,0);
  const valid={version:1,assignments:{old:{names:['José']},a:{names:Array.from({length:30},(_,i)=>'N'+i)},b:{names:['A'.repeat(80),'😀'.repeat(40)]}}};
  assert.equal(store.validate(valid),valid);
  assert.deepEqual(store.names([' Ａｎａ\t Souza\ufeff','ana souza','Jose\u0301','José',' ']),['Ana Souza','José']);
});
test('seed is deterministic, includes supplied events and never updates existing names',()=>{
  const events=[event('a'),event('b'),event('new-event')];
  const legacy={version:1,assignments:{a:{names:['Ana']}}};
  const sql=buildSeed(events,legacy);
  assert.equal(buildSeed(events,legacy),sql);
  const rows=JSON.parse(/jsonb_to_recordset\('([\s\S]*)'::jsonb\)/.exec(sql)[1].replaceAll("''","'"));
  assert.equal(rows.length,events.length);
  for(const e of events){
    const row=rows.find(r=>r.event_id===e.id);
    assert.equal(row.seeded_event,true);
    assert.deepEqual(row.event,{id:e.id,title:e.title,date:e.date,start:e.start||'',end:e.end||'',location:e.location||''});
    assert.deepEqual(row.names,legacy.assignments[e.id]?.names||[]);
  }
  assert.match(sql,/on conflict \(event_id\) do nothing/);
  const update=sql.slice(sql.indexOf('update public.team_assignments'));
  assert.doesNotMatch(update,/\bnames\s*=/);
  assert.doesNotMatch(sql,/\b(delete from|truncate)\b/i);
});
test('seed preserves legacy names and orphan metadata and safely quotes SQL data',()=>{
  const legacy={version:1,assignments:{a:{names:['Ana'],event:{id:'a',title:'Stale'}},old:{names:["D'Ávila"],event:{id:'old',title:'Removed'}},empty:{names:[]}}};
  const sql=buildSeed([{...event('a'),title:"Today's \\ stage"}],legacy);
  const rows=JSON.parse(/jsonb_to_recordset\('([\s\S]*)'::jsonb\)/.exec(sql)[1].replaceAll("''","'"));
  assert.deepEqual(rows.map(r=>r.names),[['Ana'],["D'Ávila"]]);
  assert.equal(rows[0].event.title,"Today's \\ stage");
  assert.equal(rows[1].seeded_event,false);assert.equal(rows[1].event.title,'Removed');
  assert.equal(legacy.assignments.a.event.title,'Stale');
  assert.throws(()=>buildSeed([event('a'),event('a')],legacy));
});
test('SQL declares row-locked CAS, safe getter and restricted RPC permissions',()=>{
  const sql=fs.readFileSync('supabase/001_team_store.sql','utf8');
  assert.match(sql,/where event_id = p_event_id and seeded_event for update/);
  assert.match(sql,/current_names is distinct from expected_names[\s\S]*raise sqlstate 'PT409'/);
  assert.match(sql,/if not found then[\s\S]*raise sqlstate 'PT404'/);
  assert.match(sql,/where cardinality\(names\) > 0/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on table public.team_assignments from public, anon, authenticated/);
  assert.match(sql,/revoke all on function public.normalize_team_names\(jsonb\) from public, anon, authenticated/);
  assert.equal((sql.match(/security definer\s+set search_path = ''/g)||[]).length,2);
  assert.equal((sql.match(/grant execute on function/g)||[]).length,2);
  assert.doesNotMatch(sql,/grant (insert|update|delete|all)|create policy/i);
});
