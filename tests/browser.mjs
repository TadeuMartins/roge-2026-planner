import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export async function runBrowserTests({ chromium, root = process.cwd(), executablePath } = {}) {
  const shared = { data: {version:1,assignments:{}}, reads:0, writes:[], failNextSave:false };
  const fixtureOrigin = 'https://fixture.supabase.co';
  function seed(assignments = {}) {
    shared.data = {version:1,assignments:structuredClone(assignments)};
    shared.failNextSave = false;
  }
  const server = http.createServer(async(req,res) => {
    try {
      const path = new URL(req.url,'http://localhost').pathname;
      if(path.includes('..')) throw new Error('Invalid path');
      const file = path === '/' ? '/index.html' : path;
      const types = {html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',png:'image/png',webp:'image/webp',pdf:'application/pdf'};
      res.setHeader('Content-Type',types[file.split('.').at(-1)] || 'text/plain');
      res.end(await fs.readFile(root+file));
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const errors = [];
  const regressions = [];
  const screenshots = [];
  let mockedWrites = 0;
  async function mock(route) {
    const req = route.request();
    assert.equal(req.method(),'POST');
    assert.equal(req.headers().apikey,'sb_publishable_fixture');
    assert.equal(req.headers().authorization,undefined,'Publishable key must not be sent as a bearer token');
    assert.match(req.headers()['content-type'],/application\/json/);
    const body=req.postDataJSON();
    if(new URL(req.url()).pathname==='/rest/v1/rpc/get_team_schedule') {
      assert.deepEqual(body,{});
      shared.reads++;
    } else {
      assert.deepEqual(Object.keys(body).sort(),['p_event_id','p_expected_names','p_names']);
      assert.equal(typeof body.p_event_id,'string');
      for(const names of [body.p_names,body.p_expected_names]) {
        assert.ok(Array.isArray(names));
        assert.ok(names.every(name=>typeof name==='string'));
      }
      shared.writes.push(body);
      if(shared.failNextSave) {
        shared.failNextSave=false;
        return route.fulfill({status:503,json:{message:'Fixture save failure'}});
      }
      if(JSON.stringify(body.p_expected_names)!==JSON.stringify(shared.data.assignments[body.p_event_id]?.names || [])) {
        return route.fulfill({status:409,json:{message:'Fixture same-event conflict'}});
      }
      if(body.p_names.length)shared.data.assignments[body.p_event_id]={names:[...body.p_names]};
      else delete shared.data.assignments[body.p_event_id];
      mockedWrites++;
    }
    return route.fulfill({json:structuredClone(shared.data)});
  }
  async function open(options={}, fixtureEvents, {configured=true,clock=false}={}) {
    const ctx=await browser.newContext({...options,serviceWorkers:'block'});
    // Only local assets and the two in-memory RPCs are allowed; never contact a real service.
    await ctx.route('**/*',async route=>{
      const target=new URL(route.request().url());
      if(configured && target.origin===fixtureOrigin && ['/rest/v1/rpc/get_team_schedule','/rest/v1/rpc/save_team_assignment'].includes(target.pathname)) {
        try { return await mock(route); }
        catch(error) { errors.push(error.message);return route.fulfill({status:500,json:{}}); }
      }
      if(target.origin!==url){errors.push('Blocked external request: '+target.href);return route.abort();}
      if(target.pathname==='/js/team-config.js')return route.fulfill({contentType:'text/javascript',body:'globalThis.ROGE_TEAM_CONFIG = '+JSON.stringify(configured?{url:fixtureOrigin,publishableKey:'sb_publishable_fixture'}:{})+';'});
      if(fixtureEvents && target.pathname==='/data/events.json')return route.fulfill({json:{events:fixtureEvents}});
      return route.continue();
    });
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
    page.setDefaultTimeout(10000);
    page.on('console',message=>{
      if(message.type()!=='error')return;
      if(message.location().url===fixtureOrigin+'/rest/v1/rpc/save_team_assignment' && /^Failed to load resource: the server responded with a status of (409|503)\b/.test(message.text()))return;
      errors.push(message.text());
    });
    if(clock)await page.clock.install();
    await page.goto(url);
    await page.waitForFunction(configured=>document.querySelectorAll('.event').length>0 && document.querySelector('#teamSync').textContent.includes(configured?'atualizada':'Edição indisponível'),configured);
    return page;
  }
  const card=(page,id)=>page.locator(`.event[data-id="${id}"]`);
  async function advanced(page,open=true) {
    const panel=page.locator('#advancedFilters');
    if(await panel.evaluate(el=>el.open)!==open)await panel.locator('summary').click();
  }
  async function clearDiscovery(page) {
    assert.equal(await page.locator('#listView').isVisible(),true,'Clear discovery from the events view');
    const clear=page.locator('#clearFilters');
    if(await clear.isVisible())await clear.click();
    assert.equal(await page.locator('#filterCount').textContent(),'0');
    for(const selector of ['#filterCount','#clearFilters','#activeFilters']) {
      assert.equal(await page.locator(selector).isVisible(),false,`${selector} is hidden without active discovery filters`);
    }
    assert.equal(await page.locator('#activeFilters button').count(),0);
  }
  async function renderedIds(page,selector,attribute) {
    return page.locator(selector).evaluateAll((elements,key)=>elements.map(el=>el.getAttribute(key)).sort(),attribute);
  }
  async function checkExport(page,expected) {
    const selected=await renderedIds(page,'#teamAgenda [data-agenda-event]','data-agenda-event');
    assert.deepEqual([...new Set(selected)].sort(),[...expected].sort(),'Rendered personal/team agenda matches expected events');
    const downloadPromise=page.waitForEvent('download');
    await page.locator('#exportTeam').click();
    const download=await downloadPromise;
    const ics=(await fs.readFile(await download.path(),'utf8')).replace(/\r?\n[ \t]/g,'');
    const exported=[...ics.matchAll(/^UID:(.+)@roge2026-planner\r?$/gm)].map(match=>match[1]).sort();
    assert.deepEqual(exported,[...new Set(selected)].sort(),'Export contains exactly the selected events, once each');
    assert.equal((ics.match(/BEGIN:VEVENT/g)||[]).length,expected.length);
    return ics;
  }
  async function checkCompact(page,width) {
    assert.equal(await page.locator('#advancedFilters').evaluate(el=>el.open),false,'Advanced filters start collapsed');
    const summary=await page.locator('#advancedFilters > summary').innerText();
    if(!/^Filtros\b/.test(summary))regressions.push(`${width}px: collapsed advanced summary must say Filtros; got ${JSON.stringify(summary)}`);
    assert.equal(await page.locator('#filterCount').textContent(),'0');
    for(const selector of ['#filterCount','#clearFilters','#activeFilters'])assert.equal(await page.locator(selector).isVisible(),false,`${selector} starts hidden`);
    const height=await page.locator('.discovery-controls').evaluate(el=>el.getBoundingClientRect().height);
    const max=width===1440?110:170;
    if(height>max)regressions.push(`${width}px: collapsed discovery controls height ${height.toFixed(2)}px exceeds ${max}px`);
    assert.equal(await page.locator('.roge-logo').evaluate(image=>image.complete && image.naturalWidth>0),true,'Local logo must load');
    assert.equal(await page.locator('.roge-logo').evaluate(image=>new URL(image.src).origin===location.origin),true,'Logo source must be local');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`List overflows at ${width}px`);
  }
  async function saved(page,id,names) {
    await card(page,id).locator('.team-inline-form').waitFor({state:'detached'});
    assert.deepEqual(await card(page,id).locator('.participant-badge').allTextContents(),names);
    assert.match(await card(page,id).locator('.team-editor-status').innerText(),/salvos para todos/);
    assert.deepEqual(shared.data.assignments[id]?.names || [],names);
  }
  async function checkCalendarWidths(page,count,label) {
    assert.equal(await page.locator('.calendar-event').count(),count);
    const widths=await page.locator('.calendar-event').evaluateAll(elements=>elements.map(el=>el.getBoundingClientRect().width));
    const minimum=Math.min(...widths);
    if(minimum<150)regressions.push(`${label}: calendar button minimum width ${minimum.toFixed(2)}px, expected >=150px (${count} events)`);
    if(!await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))regressions.push(label+': calendar causes page overflow');
  }
  async function screenshot(page,name,selector) {
    if(!process.env.PLANNER_SCREENSHOT_DIR)return;
    const directory=process.env.PLANNER_SCREENSHOT_DIR;
    assert.ok((await fs.stat(directory)).isDirectory(),'Screenshot directory must already exist');
    const file=path.join(directory,name+'.png');
    await page.evaluate(()=>document.activeElement?.blur());
    if(selector)await page.locator(selector).screenshot({path:file});
    else await page.screenshot({path:file});
    screenshots.push(file);
  }
  async function checkFloor(page,floor) {
    await page.locator(`[data-map-floor=${floor}]`).click();
    await page.locator('#mapImage').scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{
      const image=document.querySelector('#mapImage');
      return image.complete && image.naturalWidth>0 && document.querySelector('#mapPlane').clientWidth>0;
    });
    assert.equal(await page.locator(`[data-map-floor=${floor}]`).getAttribute('aria-pressed'),'true');
    assert.match(await page.locator('#mapImage').getAttribute('src'),floor==='ground'?/planta-geral-riocentro\.webp$/:/congresso-segundo-andar\.png$/);
    assert.match(await page.locator('#mapOriginal').getAttribute('href'),floor==='ground'?/\.pdf$/:/\.png$/);
    const expectedPins=await page.evaluate(floor=>ROGE_MAP_PLACES.filter(place=>place.floor===floor).map(place=>place.id).sort(),floor);
    assert.ok(expectedPins.length>0,'Floor data must contain confirmed places');
    assert.deepEqual(await renderedIds(page,'#mapPins .map-pin','data-map-place'),expectedPins,'Every current floor place has exactly one pin');
    await page.locator('#mapFit').click();
    assert.equal(await page.locator('#mapZoomLabel').innerText(),'100%');
    assert.equal(await page.locator('#mapZoomOut').isDisabled(),true);
    const width=await page.locator('#mapPlane').evaluate(el=>el.getBoundingClientRect().width);
    await page.locator('#mapZoomIn').click();
    assert.equal(await page.locator('#mapZoomLabel').innerText(),'140%');
    assert.ok(await page.locator('#mapPlane').evaluate(el=>el.getBoundingClientRect().width)>width);
    await page.locator('#mapZoomOut').click();
    assert.equal(await page.locator('#mapZoomLabel').innerText(),'100%');
    await page.locator('#mapZoomIn').click();await page.locator('#mapFit').click();
    assert.equal(await page.locator('#mapZoomLabel').innerText(),'100%');
    assert.equal(await page.locator('#mapViewport').evaluate(el=>{
      const plane=document.querySelector('#mapPlane');
      return plane.clientWidth<=el.clientWidth && plane.clientHeight<=el.clientHeight && el.scrollLeft===0 && el.scrollTop===0;
    }),true,'Fit must contain the floor and reset scrolling');
  }
  try {
    const page=await open({viewport:{width:1440,height:1000}});
    const count=await page.locator('.event').count();
    assert.equal(count,JSON.parse(await fs.readFile(path.join(root,'data/events.json'),'utf8')).events.length);
    await checkCompact(page,1440);
    await page.locator('#search').fill('CERIMÔNIA DE ABERTURA');assert.equal(await page.locator('.event').count(),1);
    await page.locator('#search').fill('');
    await page.locator('.event .star').first().click();assert.equal(await page.locator('#mineCount').innerText(),'1');
    await advanced(page);
    await page.locator('#onlyMine').check();assert.equal(await page.locator('.event').count(),1);await page.locator('#onlyMine').uncheck();
    await page.locator('.discovery-aside details').filter({has:page.locator('#exhibitorSearch')}).locator('summary').click();
    await page.locator('#exhibitorSearch').fill('Siemens');assert.ok((await page.locator('#exhibitors').innerText()).toLowerCase().includes('siemens'));
    await page.locator('#editRadarBtn').click();const before=await page.locator('#stakeholderPrefs').inputValue();await page.locator('#stakeholderPrefs').fill('Changed');await page.locator('#radarForm button[value=cancel]').click();await page.locator('#editRadarBtn').click();assert.equal(await page.locator('#stakeholderPrefs').inputValue(),before);await page.locator('#radarForm button[value=cancel]').click();
    const assignedId=await page.locator('.event').first().getAttribute('data-id');
    await card(page,assignedId).locator('.assign').click();
    assert.equal(await page.locator('dialog[open]').count(),0,'Card editing must be inline, without a modal');
    assert.match(await card(page,assignedId).locator('.team-editor-status').innerText(),/Edição pública, sem login/);
    assert.equal(await card(page,assignedId).locator('.team-save').isEnabled(),true);
    await card(page,assignedId).locator('.team-participant-input').fill('Ana Souza\nBruno Lima');
    await card(page,assignedId).locator('.team-save').click();
    await saved(page,assignedId,['Ana Souza','Bruno Lima']);
    assert.deepEqual(shared.writes.at(-1),{p_event_id:assignedId,p_names:['Ana Souza','Bruno Lima'],p_expected_names:[]});
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.participant-badge').length===2);assert.equal(await page.locator('#mineCount').innerText(),'1');
    await page.locator('button[data-view=calendar]').click();
    assert.equal(await page.locator('#calendarMode').inputValue(),'summary');
    await page.locator('#schedulePerson').selectOption('ana souza');
    const ics=await checkExport(page,[assignedId]);
    assert.match(ics,/Equipe: Ana Souza/);assert.match(ics,/DTSTART:20260921T124500Z/);
    await page.locator('[data-agenda-event]').click();assert.equal(await page.locator('#eventModal').isVisible(),true);await page.locator('#modalClose').click();
    await page.locator('#calendarMode').selectOption('week');await checkCalendarWidths(page,1,'Desktop assigned-only calendar');
    await page.locator('button[data-view=map]').click();
    for(const floor of ['ground','upper']) {
      await checkFloor(page,floor);
    }
    const mobile=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    assert.deepEqual(await card(mobile,assignedId).locator('.participant-badge').allTextContents(),['Ana Souza','Bruno Lima']);
    assert.equal(await mobile.locator('#mineCount').innerText(),'0','New device sees shared names, not another device favorites');
    await mobile.locator('button[data-view=calendar]').click();assert.equal(await mobile.locator('#calendarMode').inputValue(),'summary');assert.match(await mobile.locator('#teamAgenda').innerText(),/Ana Souza/);
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    for(const width of [390,320]) {
      await mobile.setViewportSize({width,height:844});
      await mobile.locator('button[data-view=calendar]').click();await mobile.locator('#calendarMode').selectOption('week');
      await checkCalendarWidths(mobile,1,`Mobile ${width}px assigned-only calendar`);
      await mobile.locator('button[data-view=map]').click();
      for(const floor of ['ground','upper']) {
        await checkFloor(mobile,floor);
        assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Map ${floor} overflows at ${width}px`);
      }
      await mobile.locator('button[data-view=list]').click();
      assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`List overflows at ${width}px`);
    }
    await mobile.locator('button[data-view=calendar]').click();
    // Rendering untrusted participant text must never create an HTML element.
    shared.data.assignments[assignedId].names=['<img src=x onerror=alert(1)>'];
    await mobile.locator('#refreshTeam').click();await mobile.waitForFunction(()=>document.querySelector('.calendar-event').textContent.includes('<img'));
    assert.equal(await mobile.locator('.participant-badges img').count(),0);
    assert.equal(await mobile.locator('.calendar-event img').count(),0);
    await mobile.locator('#calendarMode').selectOption('summary');
    assert.match(await mobile.locator('#teamAgenda').innerText(),/<img src=x onerror=alert\(1\)>/);
    assert.equal(await mobile.locator('#teamAgenda img').count(),0,'Summary must render untrusted names as text');
    await mobile.locator('button[data-view=list]').click();
    assert.deepEqual(await card(mobile,assignedId).locator('.participant-badge').allTextContents(),['<img src=x onerror=alert(1)>']);
    await card(mobile,assignedId).locator('.assign').click();
    assert.equal(await card(mobile,assignedId).locator('.team-participant-input').inputValue(),'<img src=x onerror=alert(1)>');
    assert.equal(await card(mobile,assignedId).locator('img').count(),0);
    await mobile.context().close();await page.context().close();

    // Fixed locations, dates and overlaps make expected coverage independent of production assignments.
    const fixtures=[
      {id:'fixture-a',title:'Fixture Alpha',date:'2026-09-21',start:'10:00',end:'11:00',location:'CONGRESSO - SALA PLENÁRIA A'},
      {id:'fixture-b',title:'Fixture Beta',date:'2026-09-21',start:'10:30',end:'11:30',location:'CONGRESSO - SALA 1'},
      {id:'fixture-c',title:'Fixture Gamma',date:'2026-09-21',start:'12:00',end:'13:00',location:'CONGRESSO - SALA PLENÁRIA A'},
      {id:'fixture-d',title:'Fixture Delta',date:'2026-09-22',start:'10:00',end:'11:00',location:'CONGRESSO - SALA 1'},
      {id:'fixture-e',title:'Fixture Unknown One',date:'2026-09-21',start:'10:00',end:'11:00',location:'TECHNICAL STAGE 2'},
      {id:'fixture-f',title:'Fixture Unknown Two',date:'2026-09-22',start:'12:00',end:'13:00',location:'Another unconfirmed fixture location'},
      {id:'fixture-g',title:'Fixture Unassigned Ground',date:'2026-09-22',start:'12:00',end:'13:00',location:'CONGRESSO - SALA PLENÁRIA A'}
    ].map(e=>({...e,type:'Congresso',speakers:[]}));
    const places={'fixture-a':'plenary-a','fixture-b':'room1','fixture-c':'plenary-a','fixture-d':'room1','fixture-g':'plenary-a'};
    seed({'fixture-a':{names:['Ana Souza']},'fixture-b':{names:['Ana Souza','Bruno Lima']},'fixture-c':{names:['Bruno Lima']},'fixture-d':{names:['Ana Souza']}});
    const fixturePage=await open({viewport:{width:1440,height:1000}},fixtures);
    const ids=list=>list.map(e=>e.id).sort();
    const scheduled=['fixture-a','fixture-b','fixture-c','fixture-d'];
    async function checkMap(expected) {
      const unmapped=expected.filter(e=>!places[e.id]);
      for(const [floor,place] of [['ground','plenary-a'],['upper','room1']]) {
        await fixturePage.locator(`[data-map-floor=${floor}]`).click();
        const onFloor=expected.filter(e=>places[e.id]===place);
        const totals=(await fixturePage.locator('#mapCoverage').innerText()).match(/\d+/g).map(Number);
        assert.deepEqual(totals,[onFloor.length,expected.length-unmapped.length-onFloor.length,unmapped.length],`Map coverage on ${floor}`);
        assert.deepEqual(await renderedIds(fixturePage,'#mapUnmappedEvents .map-session','data-map-event'),ids(unmapped));
        assert.equal(await fixturePage.locator('#mapUnmapped').isVisible(),unmapped.length>0);
        assert.equal(parseInt(await fixturePage.locator('#mapUnmappedSummary').innerText(),10),unmapped.length);
        await fixturePage.locator(`#mapPlaces [data-map-place=${place}]`).click();
        assert.deepEqual(await renderedIds(fixturePage,'#mapSchedule .map-session','data-map-event'),ids(onFloor),`Selected ${place} schedule`);
      }
    }
    await fixturePage.locator('button[data-view=calendar]').click();
    assert.equal(await fixturePage.locator('#calendarMode').inputValue(),'summary');
    assert.deepEqual(await fixturePage.locator('.agenda-person > h3').allTextContents(),['Ana Souza','Bruno Lima']);
    assert.equal(await fixturePage.locator('[data-agenda-event="fixture-b"]').count(),2,'Shared event appears under each attending person');
    await checkExport(fixturePage,scheduled);
    await fixturePage.locator('#schedulePerson').selectOption('ana souza');
    await checkExport(fixturePage,['fixture-a','fixture-b','fixture-d']);
    await fixturePage.locator('#scheduleDay').selectOption('2026-09-22');
    await checkExport(fixturePage,['fixture-d']);
    await fixturePage.locator('#schedulePerson').selectOption('bruno lima');
    assert.equal(await fixturePage.locator('#calendarEmpty').isVisible(),true);
    assert.equal(await fixturePage.locator('#exportTeam').isDisabled(),true);
    await fixturePage.locator('#scheduleDay').selectOption('');
    await checkExport(fixturePage,['fixture-b','fixture-c']);
    await fixturePage.locator('#schedulePerson').selectOption('ana souza');

    // Every discovery filter may hide all cards, but never the selected person's agenda.
    const discoveryCases=[
      ['search',async()=>fixturePage.locator('#search').fill('no matching discovery event')],
      ['radar',async()=>fixturePage.locator('[data-radar=technology]').click()],
      ['favorites',async()=>fixturePage.locator('#onlyMine').check()],
      ['unassigned',async()=>fixturePage.locator('#coverageFilter').selectOption('unassigned')]
    ];
    for(const [label,apply] of discoveryCases) {
      await fixturePage.locator('button[data-view=list]').click();await advanced(fixturePage);
      await clearDiscovery(fixturePage);await apply();
      assert.equal(await card(fixturePage,'fixture-a').count(),0,`${label} excludes personal event from discovery`);
      await fixturePage.locator('button[data-view=calendar]').click();
      assert.equal(await fixturePage.locator('#schedulePerson').inputValue(),'ana souza');
      await checkExport(fixturePage,['fixture-a','fixture-b','fixture-d']);
      await fixturePage.locator('button[data-view=map]').click();await checkMap(fixtures);
    }
    await fixturePage.locator('button[data-view=list]').click();await advanced(fixturePage);
    await clearDiscovery(fixturePage);
    for(const [coverage,expectedIds] of [['assigned',scheduled],['unassigned',['fixture-e','fixture-f','fixture-g']],['conflicts',['fixture-a','fixture-b']]]) {
      await fixturePage.locator('#coverageFilter').selectOption(coverage);
      assert.deepEqual(await renderedIds(fixturePage,'.event','data-id'),[...expectedIds].sort(),`Discovery ${coverage}`);
    }
    await clearDiscovery(fixturePage);
    await fixturePage.locator('#dayFilter').selectOption('2026-09-21');
    await fixturePage.locator('button[data-view=calendar]').click();
    await fixturePage.locator('#scheduleDay').selectOption('2026-09-22');
    await checkExport(fixturePage,['fixture-d']);
    await fixturePage.locator('button[data-view=map]').click();
    await fixturePage.locator('#mapDay').selectOption('2026-09-22');
    await checkMap(fixtures.filter(e=>e.date==='2026-09-22'));
    assert.equal(await fixturePage.locator('#dayFilter').inputValue(),'2026-09-21');
    await fixturePage.locator('#mapDay').selectOption('2026-09-21');
    assert.equal(await fixturePage.locator('#scheduleDay').inputValue(),'2026-09-22');
    await fixturePage.locator('#mapDay').selectOption('');
    await fixturePage.locator('[data-map-floor=ground]').click();
    await fixturePage.locator('#mapPlaces [data-map-place=plenary-a]').click();
    await fixturePage.locator('#mapSearch').fill('Fixture Gamma');
    assert.deepEqual(await renderedIds(fixturePage,'#mapSchedule .map-session','data-map-event'),['fixture-c']);
    await fixturePage.locator('#mapSearch').fill('Ana Souza');
    assert.deepEqual(await renderedIds(fixturePage,'#mapSchedule .map-session','data-map-event'),['fixture-a']);
    await fixturePage.locator('#mapSearch').fill('Fixture Beta');
    assert.equal(await fixturePage.locator('#mapSchedule .map-session').count(),0,'Selected place remains available with an empty filtered schedule');
    await fixturePage.locator('[data-map-floor=upper]').click();
    assert.equal(await fixturePage.locator('#mapSearch').inputValue(),'Fixture Beta','Floor switch preserves map search');
    await fixturePage.locator('#mapPlaces [data-map-place=room1]').click();
    assert.deepEqual(await renderedIds(fixturePage,'#mapSchedule .map-session','data-map-event'),['fixture-b']);
    await fixturePage.locator('#mapDay').selectOption('2026-09-22');

    await fixturePage.locator('button[data-view=list]').click();await advanced(fixturePage);
    await fixturePage.locator('#search').fill('Fixture');await fixturePage.locator('#dayFilter').selectOption('2026-09-22');
    await fixturePage.locator('#typeFilter').selectOption('Congresso');
    await advanced(fixturePage,false);
    assert.equal(await fixturePage.locator('#filterCount').isVisible(),true);
    assert.equal(await fixturePage.locator('#filterCount').innerText(),'3','Summary counts all three active discovery filters');
    const chips=fixturePage.locator('#activeFilters');
    assert.equal(await chips.isVisible(),true,'Active chips remain visible while advanced controls are collapsed');
    assert.equal(await chips.getByRole('button').count(),3);
    assert.match(await chips.innerText(),/Fixture/);assert.match(await chips.innerText(),/Congresso/);
    await chips.getByRole('button',{name:'Remover filtro: Congresso',exact:true}).click();
    assert.equal(await fixturePage.locator('#typeFilter').inputValue(),'');
    assert.equal(await fixturePage.locator('#search').inputValue(),'Fixture');
    assert.equal(await fixturePage.locator('#dayFilter').inputValue(),'2026-09-22');
    assert.equal(await fixturePage.locator('#filterCount').innerText(),'2');
    assert.equal(await chips.getByRole('button').count(),2);
    await advanced(fixturePage);
    await fixturePage.locator('#priorityFilter').selectOption('P4');
    await fixturePage.locator('#locationFilter').selectOption(fixtures[0].location);await fixturePage.locator('#personFilter').selectOption('Ana Souza');
    await fixturePage.locator('#coverageFilter').selectOption('assigned');await fixturePage.locator('#onlyMine').check();
    await fixturePage.locator('[data-radar=technology]').click();await fixturePage.locator('#smartChips .chip').first().click();
    assert.equal(await fixturePage.locator('#smartChips .chip.active').count(),1);
    assert.equal(await fixturePage.locator('[data-radar=technology]').getAttribute('class'),'radar-card active');
    await clearDiscovery(fixturePage);
    for(const id of ['search','dayFilter','typeFilter','priorityFilter','locationFilter','personFilter','coverageFilter'])assert.equal(await fixturePage.locator('#'+id).inputValue(),'',`Clear discovery ${id}`);
    assert.equal(await fixturePage.locator('#scheduleDay').inputValue(),'2026-09-22','Discovery clear does not reset schedule');
    assert.equal(await fixturePage.locator('#schedulePerson').inputValue(),'ana souza');
    assert.equal(await fixturePage.locator('#onlyMine').isChecked(),false);
    assert.equal(await fixturePage.locator('.radar-card.active').getAttribute('data-radar'),'all');
    assert.equal(await fixturePage.locator('#smartChips .chip.active').count(),0);
    assert.deepEqual(await renderedIds(fixturePage,'.event','data-id'),ids(fixtures));
    assert.deepEqual(errors,[],'Clearing discovery filters must not raise errors');
    await fixturePage.locator('button[data-view=map]').click();
    if(await fixturePage.locator('#mapSearch').inputValue()!=='Fixture Beta')regressions.push('Clearing discovery filters must preserve independent map search "Fixture Beta"');
    if(await fixturePage.locator('#mapDay').inputValue()!=='2026-09-22')regressions.push('Clearing discovery filters must preserve independent map day');

    // Direct card map actions retain a focused event even after map/list filters exclude it.
    for(const id of ['fixture-a','fixture-b','fixture-e']) {
      await fixturePage.locator('button[data-view=list]').click();await clearDiscovery(fixturePage);
      await card(fixturePage,id).locator('.event-map').click();
      assert.equal(await fixturePage.locator('#eventModal').isVisible(),false);
      assert.equal(await fixturePage.locator('#mapView').isVisible(),true);
      assert.equal(await fixturePage.locator('#mapSearch').inputValue(),'');
      assert.equal(await fixturePage.locator('#mapDay').inputValue(),'2026-09-21');
      assert.equal(await fixturePage.locator('#dayFilter').inputValue(),'');
      assert.equal(await fixturePage.locator('#scheduleDay').inputValue(),'2026-09-22');
      if(places[id]) {
        assert.equal(await fixturePage.locator('#mapFloorButtons .active').getAttribute('data-map-floor'),id==='fixture-a'?'ground':'upper');
        assert.equal(await fixturePage.locator('#mapPins .selected').getAttribute('data-map-place'),places[id]);
        assert.equal(await fixturePage.locator(`#mapSchedule [data-map-event=${id}]`).count(),1);
        assert.match(await fixturePage.locator('#mapNotice').innerText(),id==='fixture-a'?/Referência de área/:/Local do evento/);
      } else {
        assert.equal(await fixturePage.locator('#mapSelection').isVisible(),false);
        assert.equal(await fixturePage.locator('#mapPins .selected').count(),0);
        assert.match(await fixturePage.locator('#mapNotice').innerText(),/Não há marcador confirmado/);
        assert.deepEqual(await renderedIds(fixturePage,'#mapUnmappedEvents .map-session','data-map-event'),['fixture-e']);
        assert.match(await fixturePage.locator('#mapEventFocus').innerText(),/TECHNICAL STAGE 2/);
        await fixturePage.locator('#mapUnmappedSummary').click();
        await fixturePage.locator('#mapUnmappedEvents .map-session').click();
        assert.equal(await fixturePage.locator('#eventModal h2').innerText(),'Fixture Unknown One');
        await fixturePage.locator('#modalClose').click();
      }
      await fixturePage.locator('#mapSearch').fill('no matching map event');
      await fixturePage.locator('#mapDay').selectOption('2026-09-22');
      await fixturePage.locator('button[data-view=list]').click();await advanced(fixturePage);
      await fixturePage.locator('#search').fill('no matching discovery event');
      await fixturePage.locator('#onlyMine').check();await fixturePage.locator('#coverageFilter').selectOption('unassigned');
      await fixturePage.locator('[data-radar=technology]').click();
      await fixturePage.locator('button[data-view=map]').click();
      assert.equal(await fixturePage.locator('#mapEventFocus').isVisible(),true);
      assert.deepEqual(await renderedIds(fixturePage,'#mapEventFocus .map-session','data-map-event'),[id],'Requested event survives unrelated list/map filters');
      await fixturePage.locator('#mapEventFocus .map-session').click();
      assert.equal(await fixturePage.locator('#eventModalTitle').innerText(),fixtures.find(e=>e.id===id).title);
      await fixturePage.locator('#modalMap').click();
      assert.equal(await fixturePage.locator('#mapEventFocus').isVisible(),true);
    }
    await fixturePage.context().close();

    // Screenshots contain only synthetic team names; exhibitor/booth coordinates use local real data.
    for(const width of [1440,390,320]) {
      const visual=await open({viewport:{width,height:width===1440?1000:844},...(width<1440?{isMobile:true,hasTouch:true}:{})},fixtures);
      await checkCompact(visual,width);
      await screenshot(visual,`${width}-initial-list`);
      await card(visual,'fixture-a').locator('.assign').click();
      await card(visual,'fixture-a').locator('.team-participant-input').fill('Ana Souza\nBruno Lima');
      assert.equal(await visual.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px editor overflow`);
      await screenshot(visual,`${width}-expanded-editor`,'.event[data-id="fixture-a"]');
      await card(visual,'fixture-a').locator('.team-cancel').click();
      await visual.locator('button[data-view=calendar]').click();
      await checkExport(visual,scheduled);
      assert.equal(await visual.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px summary overflow`);
      await screenshot(visual,`${width}-team-summary`,'#calendarView');
      await visual.locator('#calendarMode').selectOption('week');
      await checkCalendarWidths(visual,scheduled.length,`${width}px team week grid`);
      await visual.locator('#calendarMode').selectOption('day');
      await visual.locator('#scheduleDay').selectOption('2026-09-22');
      await checkCalendarWidths(visual,1,`${width}px team day grid`);
      await visual.locator('button[data-view=map]').click();
      await visual.locator('#mapCompanySearch').fill('Siemens');
      assert.deepEqual(await visual.locator('#mapCompanies .map-company-option b').allTextContents(),['Siemens','Siemens Energy']);
      await visual.locator('#mapCompanies .map-company-option').filter({has:visual.getByText('Siemens',{exact:true})}).click();
      await visual.waitForFunction(()=>document.querySelectorAll('#mapBoothPins .map-booth-pin').length===2);
      assert.equal(await visual.locator('#mapExhibitorName').innerText(),'Siemens');
      assert.deepEqual(await visual.locator('#mapBoothPins b').allTextContents(),['N40','P34']);
      assert.match(await visual.locator('#mapExhibitorNote').innerText(),/maio\/2026/);
      assert.match(await visual.locator('#mapExhibitorNote').innerText(),/não foi verificada/);
      await visual.locator('#mapExhibitorStands [data-booth-index="1"]').click();
      assert.equal(await visual.locator('#mapBoothPins .selected b').innerText(),'P34');
      await visual.locator('#mapFit').click();
      await visual.locator('#mapView').scrollIntoViewIfNeeded();
      assert.equal(await visual.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px company map overflow`);
      await screenshot(visual,`${width}-map-company`,'#mapView');
      await visual.locator('[data-map-floor=upper]').click();
      assert.equal(await visual.locator('#mapCompanySearch').inputValue(),'Siemens');
      assert.equal(await visual.locator('#mapBoothPins .map-booth-pin').count(),0);
      await visual.locator('#mapCompanies .map-company-option').filter({has:visual.getByText('Siemens Energy',{exact:true})}).click();
      assert.equal(await visual.locator('#mapExhibitorName').innerText(),'Siemens Energy');
      assert.deepEqual(await visual.locator('#mapBoothPins b').allTextContents(),['P52']);
      await visual.locator('#mapCompanySearch').fill('P52');
      assert.deepEqual(await visual.locator('#mapCompanies .map-company-option b').allTextContents(),['Siemens Energy']);
      await visual.locator('#mapCompanySearch').fill('Bekaert');
      await visual.locator('#mapCompanies .map-company-option').click();
      assert.equal(await visual.locator('#mapBoothPins .map-booth-pin').count(),0,'Pavilion mismatch never gets a guessed company marker');
      assert.equal(await visual.locator('#mapPins .selected').count(),0,'Pavilion mismatch never gets a guessed area marker');
      assert.match(await visual.locator('#mapExhibitorStands').innerText(),/Conflito:.*pavilhão/);
      assert.equal(await visual.locator('#mapExhibitorStands [data-map-place]').count(),0);
      await visual.context().close();
    }

    // Independent seed: write scenarios must not depend on the earlier regression fixtures.
    seed({'fixture-a':{names:['Ana Souza']},'fixture-b':{names:['Ana Souza','Bruno Lima']},'fixture-c':{names:['Bruno Lima']}});
    const editor=await open({viewport:{width:1440,height:1000}},fixtures,{clock:true});
    const colleague=await open({viewport:{width:1440,height:1000}},fixtures);
    const a=card(editor,'fixture-a'), b=card(editor,'fixture-b'), c=card(editor,'fixture-c');
    await a.locator('.assign').click();await c.locator('.assign').click();
    await a.locator('.team-participant-input').fill('Ana Souza\nBruno Lima');
    await c.locator('.team-participant-input').fill('Carla Reis');
    assert.equal(await editor.locator('.team-inline-form').count(),2,'Independent card drafts can coexist');
    assert.equal(await editor.locator('dialog[open]').count(),0);
    assert.match(await a.locator('.team-draft-conflicts').innerText(),/Ana Souza, Bruno Lima.*Fixture Beta/);

    const remote=card(colleague,'fixture-a');
    await remote.locator('.assign').click();await remote.locator('.team-participant-input').fill('Remote Person');
    await remote.locator('.team-save').click();await saved(colleague,'fixture-a',['Remote Person']);
    await card(colleague,'fixture-d').locator('.assign').click();
    await card(colleague,'fixture-d').locator('.team-participant-input').fill('Diana Costa');
    await card(colleague,'fixture-d').locator('.team-save').click();await saved(colleague,'fixture-d',['Diana Costa']);

    const readsBeforeTimer=shared.reads;
    await editor.clock.fastForward(300001);
    await editor.waitForFunction(()=>document.querySelector('.event[data-id="fixture-a"] .participant-badge')?.textContent==='Remote Person' && !document.querySelector('#refreshTeam').disabled);
    assert.ok(shared.reads>readsBeforeTimer,'Five-minute auto refresh must read the shared service');
    assert.equal(await a.locator('.team-participant-input').inputValue(),'Ana Souza\nBruno Lima','Auto refresh preserves dirty draft');
    assert.equal(await c.locator('.team-participant-input').inputValue(),'Carla Reis');
    assert.deepEqual(await card(editor,'fixture-d').locator('.participant-badge').allTextContents(),['Diana Costa']);
    await editor.locator('#search').fill('Fixture Beta');assert.equal(await editor.locator('.team-inline-form').count(),0);
    await editor.locator('#search').fill('');
    await editor.locator('#dayFilter').selectOption('2026-09-22');await clearDiscovery(editor);
    await advanced(editor);
    await editor.locator('#personFilter').selectOption('Bruno Lima');await editor.locator('#personFilter').selectOption('');
    await a.locator('.star').click();await editor.locator('#onlyMine').check();
    assert.equal(await editor.locator('.event').count(),1);await editor.locator('#onlyMine').uncheck();
    assert.equal(await a.locator('.team-participant-input').inputValue(),'Ana Souza\nBruno Lima','Filter/favorite rerenders preserve draft');
    assert.equal(await c.locator('.team-participant-input').inputValue(),'Carla Reis','Hidden second draft is preserved');
    await c.locator('.team-save').click();await saved(editor,'fixture-c',['Carla Reis']);
    assert.deepEqual(shared.writes.at(-1),{p_event_id:'fixture-c',p_names:['Carla Reis'],p_expected_names:['Bruno Lima']});
    assert.deepEqual(shared.data.assignments['fixture-d'].names,['Diana Costa'],'Unrelated-event writes must not be overwritten');

    const beforeConflict=mockedWrites;
    for(let attempt=0;attempt<2;attempt++) {
      await a.locator('.team-save').click();
      await editor.waitForFunction(()=>document.querySelector('.event[data-id="fixture-a"] .team-editor-status')?.textContent.includes('Outra pessoa alterou'));
      assert.equal(await a.locator('.team-participant-input').inputValue(),'Ana Souza\nBruno Lima');
      assert.match(await a.locator('.team-editor-status').innerText(),/rascunho foi preservado.*Recarregar participantes/);
      assert.deepEqual(shared.writes.at(-1),{p_event_id:'fixture-a',p_names:['Ana Souza','Bruno Lima'],p_expected_names:['Ana Souza']},'Conflict/auto refresh must not silently advance CAS expected names');
      assert.deepEqual(shared.data.assignments['fixture-a'].names,['Remote Person']);
    }
    assert.equal(mockedWrites,beforeConflict,'Rejected CAS attempts never persist');
    await a.locator('.team-reload').click();
    await editor.waitForFunction(()=>document.querySelector('.event[data-id="fixture-a"] .team-editor-status')?.textContent.includes('Participantes recarregados'));
    assert.equal(await a.locator('.team-participant-input').inputValue(),'Remote Person','Explicit reload replaces the draft');
    await a.locator('.team-participant-input').fill('Ana Souza, Bruno Lima\nRemote Person');
    await a.locator('.team-save').click();await saved(editor,'fixture-a',['Ana Souza','Bruno Lima','Remote Person']);
    assert.deepEqual(shared.writes.at(-1).p_expected_names,['Remote Person'],'Explicit reload advances CAS expected names');
    await editor.locator('button[data-view=calendar]').click();
    await editor.locator('#calendarMode').selectOption('week');
    assert.equal(await editor.locator('.calendar-event.has-conflict').count(),2);
    await editor.locator('#teamConflicts summary').click();
    assert.match(await editor.locator('#teamConflicts').innerText(),/Ana Souza, Bruno Lima/);
    await editor.locator('#scheduleConflicts').check();
    assert.deepEqual(await editor.locator('.calendar-event').evaluateAll(elements=>elements.map(el=>el.dataset.eventId).sort()),['fixture-a','fixture-b']);
    await editor.locator('#scheduleConflicts').uncheck();
    await editor.locator('button[data-view=list]').click();await clearDiscovery(editor);

    await b.locator('.assign').click();await b.locator('.team-participant-input').fill('Bruno Lima\nCarla Reis');
    const beforeFailure=mockedWrites;
    shared.failNextSave=true;
    await b.locator('.team-save').click();
    await editor.waitForFunction(()=>document.querySelector('.event[data-id="fixture-b"] .team-editor-status')?.textContent.includes('Supabase 503'));
    assert.equal(await b.locator('.team-participant-input').inputValue(),'Bruno Lima\nCarla Reis');
    assert.match(await b.locator('.team-editor-status').innerText(),/rascunho foi preservado/);
    assert.equal(await b.locator('.team-save').isEnabled(),true);
    assert.equal(mockedWrites,beforeFailure);
    assert.deepEqual(shared.data.assignments['fixture-b'].names,['Ana Souza','Bruno Lima']);
    await editor.locator('#refreshTeam').click();
    await editor.waitForFunction(()=>document.querySelector('#teamSync').textContent.includes('atualizada') && !document.querySelector('#refreshTeam').disabled);
    assert.equal(await b.locator('.team-participant-input').inputValue(),'Bruno Lima\nCarla Reis','General refresh does not discard a failed-save draft');
    await b.locator('.team-save').click();await saved(editor,'fixture-b',['Bruno Lima','Carla Reis']);
    assert.deepEqual(shared.writes.at(-1),{p_event_id:'fixture-b',p_names:['Bruno Lima','Carla Reis'],p_expected_names:['Ana Souza','Bruno Lima']});

    const writesBeforeCancel=shared.writes.length;
    await b.locator('.assign').click();await b.locator('.team-participant-input').fill('Discard This');
    await b.locator('.team-cancel').click();assert.equal(await b.locator('.team-inline-form').count(),0);
    await b.locator('.assign').click();assert.equal(await b.locator('.team-participant-input').inputValue(),'Bruno Lima\nCarla Reis');
    await b.locator('.team-cancel').click();assert.equal(shared.writes.length,writesBeforeCancel,'Cancel must not write');

    for(const [names,expected] of [[['Ana Souza','Bruno Lima'],['Ana Souza','Bruno Lima','Remote Person']],[[],['Ana Souza','Bruno Lima']]]) {
      await a.locator('.assign').click();await a.locator('.team-participant-input').fill(names.join('\n'));
      await a.locator('.team-save').click();await saved(editor,'fixture-a',names);
      assert.deepEqual(shared.writes.at(-1),{p_event_id:'fixture-a',p_names:names,p_expected_names:expected});
    }
    assert.equal(await a.locator('.participant-conflict').count(),0,'Removing all names removes the overlap conflict');
    await colleague.locator('#refreshTeam').click();
    await colleague.waitForFunction(()=>document.querySelector('.event[data-id="fixture-b"] .participant-badges')?.textContent.includes('Carla Reis') && !document.querySelector('#refreshTeam').disabled);
    assert.equal(await remote.locator('.participant-badge').count(),0,'Removal is visible to an already-open user');
    assert.deepEqual(await card(colleague,'fixture-b').locator('.participant-badge').allTextContents(),['Bruno Lima','Carla Reis']);
    await editor.reload();
    await editor.waitForFunction(()=>document.querySelector('#teamSync').textContent.includes('atualizada'));
    assert.equal(await a.locator('.participant-badge').count(),0);
    assert.deepEqual(await b.locator('.participant-badge').allTextContents(),['Bruno Lima','Carla Reis']);
    const newDevice=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true},fixtures);
    assert.equal(await card(newDevice,'fixture-a').locator('.participant-badge').count(),0);
    assert.deepEqual(await card(newDevice,'fixture-b').locator('.participant-badge').allTextContents(),['Bruno Lima','Carla Reis']);
    await card(newDevice,'fixture-b').locator('.assign').click();
    assert.equal(await card(newDevice,'fixture-b').locator('.team-save').isEnabled(),true,'Any fresh device can edit without login');
    assert.equal(await newDevice.locator('dialog[open]').count(),0);
    assert.equal(await newDevice.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile inline editor must not overflow');
    await newDevice.context().close();await colleague.context().close();await editor.context().close();

    const beforeUnconfigured={reads:shared.reads,writes:shared.writes.length};
    const unconfigured=await open({viewport:{width:390,height:844}},fixtures,{configured:false,clock:true});
    const unconfiguredRequests=[];
    unconfigured.on('request',request=>unconfiguredRequests.push(request.url()));
    await card(unconfigured,'fixture-a').locator('.assign').click();
    assert.match(await unconfigured.locator('#teamSync').innerText(),/Edição indisponível.*URL.*chave pública.*Supabase.*js\/team-config\.js/);
    assert.match(await card(unconfigured,'fixture-a').locator('.team-editor-status').innerText(),/Edição indisponível.*Supabase/);
    assert.equal(await unconfigured.locator('.team-save:enabled').count(),0);
    assert.equal(await unconfigured.locator('.team-participant-input').getAttribute('readonly'),'');
    assert.equal(await unconfigured.locator('.team-reload').isDisabled(),true);
    assert.equal(await unconfigured.locator('#refreshTeam').isDisabled(),true);
    assert.equal(await unconfigured.locator('dialog[open]').count(),0);
    await unconfigured.locator('.team-inline-form').dispatchEvent('submit');
    await unconfigured.clock.fastForward(600001);
    await unconfigured.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    assert.deepEqual(unconfiguredRequests,[],'Unconfigured editing/timers must not issue network requests');
    assert.deepEqual({reads:shared.reads,writes:shared.writes.length},beforeUnconfigured);
    await unconfigured.context().close();
    assert.deepEqual(errors,[]);
    assert.deepEqual(regressions,[],'App regressions (all remaining checks completed)');
    return {status:'passed',events:count,fixtureEvents:fixtures.length,mockedWrites,checks:'compact collapsed filters/chips, local logo, search/favorites/exhibitors/radar cancel, public inline edit, reload/second device, CAS expected names/conflict/reload/cancel, save failure, auto refresh/filter/favorite draft preservation, independent drafts, add/remove participants, unconfigured no-network editing, assigned-only personal/team summary and deduplicated ICS, independent discovery/schedule/map dates and filters, day/week widths, mapped event focus outside filters, technical stage no guessed marker, map floors/images/zoom/fit/search preservation/coverage, Siemens vs Energy N40/P34/P52, Bekaert mismatch, 1440/390/320 screenshots/overflow, XSS',screenshots};
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(typeof process !== 'undefined' && process.argv[1]?.endsWith('browser.mjs')) {
  const {chromium}=await import('playwright');
  console.log(await runBrowserTests({chromium,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}));
}
