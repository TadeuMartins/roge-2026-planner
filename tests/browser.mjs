import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';

export async function runBrowserTests({ chromium, root = process.cwd(), executablePath } = {}) {
  const shared = { data: {version:1,assignments:{}}, sha:1 };
  const server = http.createServer(async(req,res) => {
    try {
      const path = new URL(req.url,'http://localhost').pathname;
      if(path.includes('..')) throw new Error('Invalid path');
      const file = path === '/' ? '/index.html' : path;
      const types = {html:'text/html',js:'text/javascript',css:'text/css',json:'application/json'};
      res.setHeader('Content-Type',types[file.split('.').at(-1)] || 'text/plain');
      res.end(await fs.readFile(root+file));
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = 'http://127.0.0.1:'+server.address().port;
  const browser = await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const errors = [];
  async function mock(route) {
    const req = route.request();
    if(!req.url().includes('/contents/')) return route.fulfill({json:{permissions:{push:true}}});
    if(req.method()==='PUT') {
      const body=req.postDataJSON();
      if(body.sha!==String(shared.sha))return route.fulfill({status:409,body:'{}'});
      shared.data=JSON.parse(Buffer.from(body.content,'base64').toString());shared.sha++;
      return route.fulfill({json:{}});
    }
    return route.fulfill({json:{sha:String(shared.sha),content:Buffer.from(JSON.stringify(shared.data)).toString('base64')}});
  }
  async function open(options={}) {
    const ctx=await browser.newContext(options);await ctx.route('https://api.github.com/**',mock);
    const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForFunction(()=>document.querySelectorAll('.event').length>0 && document.querySelector('#teamSync').textContent.includes('atualizada'));
    return page;
  }
  try {
    const page=await open({viewport:{width:1440,height:1000}});
    const count=await page.locator('.event').count();assert.ok(count>400);
    await page.locator('#search').fill('CERIMÔNIA DE ABERTURA');assert.equal(await page.locator('.event').count(),1);
    await page.locator('#search').fill('');
    await page.locator('.event .star').first().click();assert.equal(await page.locator('#mineCount').innerText(),'1');
    await page.locator('#onlyMine').check();assert.equal(await page.locator('.event').count(),1);await page.locator('#onlyMine').uncheck();
    await page.locator('#exhibitorSearch').fill('Siemens');assert.ok((await page.locator('#exhibitors').innerText()).toLowerCase().includes('siemens'));
    await page.locator('#editRadarBtn').click();const before=await page.locator('#stakeholderPrefs').inputValue();await page.locator('#stakeholderPrefs').fill('Changed');await page.locator('#radarForm button[value=cancel]').click();await page.locator('#editRadarBtn').click();assert.equal(await page.locator('#stakeholderPrefs').inputValue(),before);await page.locator('#radarForm button[value=cancel]').click();
    await page.locator('.event .assign').first().click();await page.locator('#assignmentAuth').click();
    await page.locator('#githubToken').fill('fixture-token');await page.locator('#authorizeTeam').click();await page.locator('#teamAuthModal').waitFor({state:'hidden'});
    await page.locator('#participantInput').fill('Ana Souza\nBruno Lima');await page.locator('#saveParticipants').click();await page.locator('#assignmentModal').waitFor({state:'hidden'});
    const assigned=Object.values(shared.data.assignments);assert.deepEqual(assigned[0].names,['Ana Souza','Bruno Lima']);
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.participant-badge').length===2);assert.equal(await page.locator('#mineCount').innerText(),'1');
    assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('fixture-token'))),false);
    await page.locator('[data-view=calendar]').click();assert.equal(await page.locator('.calendar-event').count(),1);
    await page.locator('#personFilter').selectOption('Ana Souza');assert.equal(await page.locator('.calendar-event').count(),1);
    const downloadPromise=page.waitForEvent('download');await page.locator('#exportTeam').click();const download=await downloadPromise;
    const ics=await fs.readFile(await download.path(),'utf8');assert.match(ics,/Equipe: Ana Souza/);assert.match(ics,/DTSTART:20260921T124500Z/);
    await page.locator('.calendar-event').click();assert.equal(await page.locator('#eventModal').isVisible(),true);await page.locator('#eventModal .icon-btn').click();
    await page.locator('#personFilter').selectOption('');await page.locator('#calendarScope').selectOption('all');assert.equal(await page.locator('.calendar-event').count(),count);
    const mobile=await open({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    await mobile.locator('[data-view=calendar]').click();assert.equal(await mobile.locator('#calendarMode').inputValue(),'day');assert.match(await mobile.locator('.calendar-event').innerText(),/Ana Souza/);
    assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    // Rendering untrusted participant text must never create an HTML element.
    shared.data.assignments[Object.keys(shared.data.assignments)[0]].names=['<img src=x onerror=alert(1)>'];
    await mobile.locator('#refreshTeam').click();await mobile.waitForFunction(()=>document.querySelector('.calendar-event').textContent.includes('<img'));
    assert.equal(await mobile.locator('.participant-badges img').count(),0);
    assert.deepEqual(errors,[]);
    return {status:'passed',events:count,checks:'search, favorites, exhibitors, radar cancel, shared edit, reload, second device, credential storage, calendar, participant filter, ICS download, details, all events, mobile overflow, XSS'};
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
}
if(typeof process !== 'undefined' && process.argv[1]?.endsWith('browser.mjs')) {
  const {chromium}=await import('playwright');
  console.log(await runBrowserTests({chromium,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}));
}
