import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const data = JSON.parse(fs.readFileSync(new URL('../data/booth-locations.json', import.meta.url)));
const exhibitors = JSON.parse(fs.readFileSync(new URL('../data/exhibitors.json', import.meta.url))).exhibitors;
const mapDataScript = fs.readFileSync(new URL('../js/map-data.js', import.meta.url), 'utf8');
const mapsScript = fs.readFileSync(new URL('../js/maps.js', import.meta.url), 'utf8');
const model = vm.createContext({});
vm.runInContext(mapDataScript, model);
const company = name => exhibitors.find(e => e.name === name);

test('stand normalization is anchored, zero-padded and preserves explicit suffixes', () => {
  for (const [input, expected] of [['u6','U06'],[' ZC8 ','ZC08'],['R68a','R68A'],['N40','N40']]) assert.equal(model.normalizeBoothCode(input),expected);
  for (const input of ['ZB0420M²','Ver site','China Pavilion','N400','name N40','N40 + P34']) assert.equal(model.normalizeBoothCode(input),null);
  assert.equal(model.parseBoothStands('N40 + P34 - German Pavilion').length,2);
  assert.equal(model.parseBoothStands('ZA40-C')[0].substand,true);
  assert.equal(model.parseBoothStands('G10 - 1')[0].substand,true);
  assert.equal(model.parseBoothStands('O40 - UK Pavilion')[0].substand,false);
});

test('Siemens has both directory stands; Siemens Energy has its own stand', () => {
  const siemens = model.resolveExhibitorBooths(company('Siemens'),data);
  assert.deepEqual(Array.from(siemens.points,p=>p.code),['N40','P34']);
  assert.equal(siemens.points[0].x,63.22425);
  assert.equal(siemens.points[1].y,49.08362);
  const energy = model.resolveExhibitorBooths(company('Siemens Energy'),data);
  assert.equal(energy.points[0].code,'P52');
  assert.equal(energy.points[0].pavilion,'3');
  assert.match(siemens.note,/maio\/2026/);
  assert.match(siemens.note,/não foi verificada/);
});

test('pavilion conflicts suppress exact pins and unreliable pavilion fallback', () => {
  const result = model.resolveExhibitorBooths(company('Bekaert'),data);
  assert.equal(result.stands[0].status,'mismatch');
  assert.equal(result.stands[0].candidates[0].pavilion,'3');
  assert.equal(result.points.length,0);
  assert.equal(result.pavilion,null);
  const invalid = model.resolveExhibitorBooths(company('Evolen'),data);
  assert.equal(invalid.stands[0].status,'invalid');
  assert.equal(invalid.pavilion,null);
  assert.equal(invalid.points.length,0);
});

test('missing, ambiguous, and parent stands are never presented as exact company positions', () => {
  const input = {name:'Test',stand:'G10 - 1',pavilion:'2'};
  assert.equal(model.resolveExhibitorBooths(input,data).stands[0].status,'parent');
  assert.equal(model.resolveExhibitorBooths({...input,stand:'A99'},data).stands[0].status,'missing');
  const duplicate = {...data,booths:{...data.booths,G10:[data.booths.G10[0],{...data.booths.G10[0],x:60}]}};
  const ambiguous = model.resolveExhibitorBooths(input,duplicate);
  assert.equal(ambiguous.stands[0].status,'ambiguous');
  assert.equal(ambiguous.points.length,0);
  assert.equal(ambiguous.stands[0].candidates.length,2);
  assert.equal(model.resolveExhibitorBooths(input,null).stands[0].status,'unavailable');
  // Never match company names from May to override current directory codes.
  assert.equal(model.resolveExhibitorBooths(company('TechnipFMC'),data).points[0].code,'N14');
});

test('company search covers the whole directory by name or normalized stand', () => {
  assert.equal(model.searchMapExhibitors(exhibitors,'').length,exhibitors.length);
  assert.ok(model.searchMapExhibitors(exhibitors,'Siemens').some(e=>e.name==='Siemens Energy'));
  assert.ok(model.searchMapExhibitors(exhibitors,'P34').some(e=>e.name==='Siemens'));
  assert.ok(model.searchMapExhibitors(exhibitors,'O40').some(e=>e.name==='Bekaert'));
  assert.ok(model.searchMapExhibitors(exhibitors,'Evolen').length);
  assert.equal(model.searchMapExhibitors([{name:'Test',stand:'U06'}],'u6').length,1);
});

test('stage numbers are never guessed as rooms; broad exhibition locations offer pavilion choices', () => {
  for (let i=1;i<=11;i++) assert.equal(model.resolveMapPlace('TECHNICAL STAGE '+i),undefined);
  assert.equal(model.resolveMapPlace('CONGRESSO - SALA 2').id,'room2');
  assert.equal(model.resolveMapPlace(' sala 06 ').id,'room6');
  assert.equal(model.resolveMapPlace('PAVILHÃO 2 - ESTANDE IBP').x,data.booths.B10[0].x);
  assert.equal(model.resolveMapPlace('PAVILHÃO 3 - COWORKING').sourceLabel,'COWORKING');
  assert.equal(model.resolveMapPlace('PAVILHÃO 4 - AUDITÓRIO').sourceLabel,'AUDIT. PAV. 4');
  assert.equal(model.resolveMapPlace('Riocentro • Pavilhões de Exposição'),undefined);
  assert.equal(model.mapEventPavilionOptions('Riocentro • Pavilhões de Exposição').length,4);
  assert.equal(model.ROGE_MAP_FLOORS.find(f=>f.id==='upper').height,588);
});

test('static coordinates include auditable rotated-page source metadata and geographic pavilions', () => {
  assert.equal(data.source.revision,'2026-05-18');
  assert.deepEqual(data.source.unrotated_size,[1191,842]);
  assert.deepEqual(data.source.displayed_size,[842,1191]);
  assert.equal(data.source.rotation,270);
  assert.match(data.source.coordinate_method,/rotation_matrix/);
  assert.equal(data.booths.ZC08[0].source_text,'ZC8');
  assert.equal(data.booths.ABH02,undefined,'Company label ABH2 is not a booth code');
  for (const [code,positions] of Object.entries(data.booths)) {
    assert.equal(model.normalizeBoothCode(code),code);
    for (const p of positions) {
      const [x0,y0,x1,y1] = data.pavilion_bounds[p.pavilion];
      assert.ok(p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1,code);
      assert.ok(p.source_text);
    }
  }
});

test('offline parser separates area-concatenated labels and keeps exact glyph coordinates', t => {
  const result = spawnSync('python',['-c',"import runpy; m=runpy.run_path('scripts/extract-booths.py'); assert m['CODE'].fullmatch('ZB0420M²')[1]=='ZB04'; assert m['CODE'].fullmatch('N40100M²')[1]=='N40'; assert m['CODE'].fullmatch('name ZB0420M²') is None; assert m['normalize_code']('U6')=='U06'; assert m['normalize_code']('ABH2') is None"],{encoding:'utf8'});
  if (result.error?.code === 'ENOENT' || /No module named 'pymupdf'/.test(result.stderr)) return t.skip('Optional offline PyMuPDF generator is not installed');
  assert.equal(result.status,0,result.stderr);
});

function ui() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,checked:true,style:{},dataset:{},clientWidth:500,clientHeight:600,clientLeft:0,clientTop:0,scrollLeft:0,scrollTop:0,
      setAttribute(){},classList:{toggle(){}},getBoundingClientRect(){return {left:0,top:0};},scrollTo(value,top){this.scrolled=value;if(typeof value==='object'){this.scrollLeft=value.left;this.scrollTop=value.top;}else{this.scrollLeft=value;this.scrollTop=top;}},scrollIntoView(){},close(){},focus(){}});
    return elements.get(id);
  };
  const events = [{id:'a',title:'Requested event',date:'2026-09-21',start:'10:00',end:'11:00',location:'TECHNICAL STAGE 2'},
    {id:'b',title:'Room event',date:'2026-09-22',start:'11:00',end:'12:00',location:'CONGRESSO - SALA 2'}];
  const frames = [];
  const context = vm.createContext({$:element,$$:()=>[],events,exhibitors,plannerView:'map',escapeHtml:s=>String(s??''),fmtDate:s=>s,
    norm:s=>String(s).toLowerCase(),assignedNames:()=>['Ana'],teamConflictIds:new Set(),byId:id=>events.find(e=>e.id===id),
    filtered(){throw new Error('Global discovery filters must not be read');},setPlannerDay(){throw new Error('Global day must not be changed');},
    setPlannerView(){},requestAnimationFrame:fn=>frames.push(fn)});
  vm.runInContext(mapDataScript + '\n' + mapsScript,context);
  vm.runInContext('mapReady=true;',context);
  return {context,element,events,flush(){while(frames.length)frames.shift()();}};
}

test('direct events remain visible outside map results; map filters never read or write global filters', () => {
  const {context,element,events,flush} = ui();
  context.showEventOnMap(events[0]); flush();
  assert.match(element('#mapEventFocus').innerHTML,/Requested event/);
  assert.match(element('#mapEventFocus').innerHTML,/TECHNICAL STAGE 2/);
  assert.match(element('#mapEventFocus').innerHTML,/Ana/);
  assert.match(element('#mapEventFocus').innerHTML,/data-map-edit="a"/);
  assert.match(element('#mapNotice').textContent,/Não há marcador/);
  assert.equal(vm.runInContext('mapPlace',context),'');
  element('#mapSearch').value='unrelated query';
  vm.runInContext("mapDay='2026-09-22';renderMapSidebar();",context);
  assert.match(element('#mapEventFocus').innerHTML,/Requested event/);
  assert.equal(element('#mapDay').value,'2026-09-22');
  context.showEventOnMap(events[1]); flush();
  assert.equal(vm.runInContext('mapPlace',context),'room2');
  assert.equal(vm.runInContext('mapFloor',context),'upper');
  assert.equal(vm.runInContext('mapZoom',context),3.5);
  assert.ok(element('#mapViewport').scrolled);
});

test('company results are bounded; only selected company pins render and floor search persists', () => {
  const {context,element,flush} = ui();
  context.fixture=data;
  vm.runInContext('mapBoothData=fixture;',context);
  context.renderMapCompanies();
  assert.equal((element('#mapCompanies').innerHTML.match(/data-map-company="/g)||[]).length,40);
  assert.ok(element('#mapCompanies').innerHTML.includes(exhibitors.length + ' empresas'));
  element('#mapCompanySearch').value='Siemens';
  context.showExhibitorOnMap(company('Siemens'));flush();
  assert.equal((element('#mapBoothPins').innerHTML.match(/data-booth-index=/g)||[]).length,2);
  assert.match(element('#mapBoothPins').innerHTML,/Siemens/);
  assert.match(element('#mapBoothPins').innerHTML,/P34/);
  vm.runInContext("mapFloor='upper';renderFloor();",context);flush();
  assert.equal(element('#mapCompanySearch').value,'Siemens');
  assert.equal(element('#mapBoothPins').innerHTML,'');
  context.showExhibitorOnMap(company('Bekaert'));flush();
  assert.equal(element('#mapBoothPins').innerHTML,'');
  assert.match(element('#mapExhibitorStands').innerHTML,/Conflito/);
  assert.doesNotMatch(element('#mapExhibitorStands').innerHTML,/data-map-place=/);
  context.showExhibitorOnMap(company('Evolen'));flush();
  assert.equal(element('#mapBoothPins').innerHTML,'');
  assert.match(element('#mapExhibitorStands').innerHTML,/código válido/);
});

test('desktop/mobile map focuses real coordinates with local-only network access', {skip:process.env.ROGE_MAP_BROWSER !== '1'}, async () => {
  const {chromium} = await import('playwright');
  const root = fileURLToPath(new URL('..',import.meta.url)).replace(/[\\/]$/,'');
  const server = http.createServer((request,response)=>{
    const pathname = new URL(request.url,'http://localhost').pathname;
    const file = path.resolve(root,'.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403);response.end();return; }
    try {
      const type = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png'}[path.extname(file)];
      response.setHeader('Content-Type',type || 'application/octet-stream');
      response.end(fs.readFileSync(file));
    } catch { response.writeHead(404);response.end(); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {})});
    for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
      const context = await browser.newContext({viewport,serviceWorkers:'block'});
      await context.route('**/*',route=>{
        const target = new URL(route.request().url());
        if (target.origin !== origin) return route.abort();
        if (target.pathname === '/js/team-config.js') return route.fulfill({contentType:'text/javascript',body:'globalThis.ROGE_TEAM_CONFIG = {};'});
        return route.continue();
      });
      const page = await context.newPage(), errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(()=>typeof mapBoothData !== 'undefined' && mapBoothData);
      await page.evaluate(()=>showExhibitorOnMap(exhibitors.find(e=>e.name==='Siemens')));
      await page.waitForTimeout(700);
      assert.equal(await page.locator('#mapBoothPins [data-booth-index]').count(),2);
      assert.equal(await page.locator('#mapZoomLabel').textContent(),'350%');
      const position = await page.locator('#mapBoothPins [data-booth-index="0"]').evaluate(pin=>{
        const p=pin.getBoundingClientRect(), v=document.querySelector('#mapViewport').getBoundingClientRect();
        return {inside:p.left<v.right && p.right>v.left && p.top<v.bottom && p.bottom>v.top,scrolled:document.querySelector('#mapViewport').scrollTop>0};
      });
      assert.deepEqual(position,{inside:true,scrolled:true});
      await page.locator('#mapCompanySearch').fill('Siemens');
      await page.locator('[data-map-floor="upper"]').click();
      assert.equal(await page.locator('#mapCompanySearch').inputValue(),'Siemens');
      assert.equal(await page.locator('#mapBoothPins [data-booth-index]').count(),0);
      await page.evaluate(()=>{document.querySelector('#search').value='no event can match this';showEventOnMap(events.find(e=>e.location==='TECHNICAL STAGE 2'));});
      await page.waitForTimeout(200);
      assert.match(await page.locator('#mapEventFocus').innerText(),/TECHNICAL STAGE 2/);
      assert.equal(await page.locator('#mapPins .selected').count(),0);
      assert.match(await page.locator('#mapNotice').innerText(),/Não há marcador/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No page-level overflow');
      assert.deepEqual(errors,[]);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve=>server.close(resolve));
  }
});
