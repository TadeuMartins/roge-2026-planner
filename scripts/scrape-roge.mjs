import { chromium } from 'playwright';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PROGRAM='https://roge.energy/programacao';
const FEST='https://roge.energy/roge-fest';
const EXHIBITORS='https://roge.energy/expositores';
const days=[['Segunda','21','2026-09-21'],['Terça','22','2026-09-22'],['Quarta','23','2026-09-23'],['Quinta','24','2026-09-24']];
const old=readJSON('data/events.json',{events:[]});
const oldMap=new Map((old.events||[]).map(x=>[x.id,x]));
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({
  locale:'pt-BR',timezoneId:'America/Sao_Paulo',viewport:{width:1440,height:1200},
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
  extraHTTPHeaders:{'Accept-Language':'pt-BR,pt;q=0.9,en;q=0.8'}
});
const page=await context.newPage();
page.setDefaultTimeout(20000);

function readJSON(path,fallback){try{return JSON.parse(fs.readFileSync(path,'utf8'))}catch{return fallback}}
function slugId(parts){return crypto.createHash('sha1').update(parts.join('|').toLowerCase()).digest('hex').slice(0,18)}
function addMinutes(hhmm,min){const [h,m]=hhmm.split(':').map(Number);const d=new Date(2000,0,1,h,m+min);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
function cleanLines(text=''){return text.split('\n').map(x=>x.replace(/\s+/g,' ').trim()).filter(Boolean)}
function isTimeRange(s=''){return /^(?:[01]?\d|2[0-3]):[0-5]\d\s*[-–—]\s*(?:[01]?\d|2[0-3]):[0-5]\d$/.test(s)}
function isDayLead(s=''){return /^(Segunda|Terça|Quarta|Quinta)\s+(?:às|as)\s+/i.test(s)}
function parseProgramText(text){
  const lines=cleanLines(text),out=[];
  for(let i=0;i<lines.length;i++){
    if(!isTimeRange(lines[i]))continue;
    const [start,end]=lines[i].split(/\s*[-–—]\s*/);
    let title='';
    for(let j=i-1;j>=Math.max(0,i-5);j--){const v=lines[j];if(isDayLead(v)||/^(Congresso|Eventos Paralelos)(\s|$)/i.test(v)||/^(Palestrantes|Filtros|Eventos):?$/i.test(v))continue;title=v;break}
    if(!title||title.length<2)continue;
    const location=lines[i+1]&&!/^(Palestrantes:|Ver mais)$/i.test(lines[i+1])&&!isTimeRange(lines[i+1])?lines[i+1]:'';
    let type='Programação',track='';
    for(let j=i-1;j>=Math.max(0,i-8);j--){const v=lines[j];const m=v.match(/^(Congresso|Eventos Paralelos)(?:\s+(.+))?$/i);if(m){type=/Eventos Paralelos/i.test(m[1])?'Eventos Paralelos':'Congresso';track=(m[2]||'').trim();break}}
    let speakersRaw='',speakers=[];
    const nextTime=lines.findIndex((v,k)=>k>i&&isTimeRange(v));
    const blockEnd=nextTime>i?nextTime:Math.min(lines.length,i+80);
    const pidx=lines.findIndex((v,k)=>k>i&&k<blockEnd&&/^Palestrantes:?$/i.test(v));
    if(pidx>i){let endIdx=lines.findIndex((v,k)=>k>pidx&&k<blockEnd&&/^Ver mais$/i.test(v));if(endIdx<0)endIdx=blockEnd;const raw=lines.slice(pidx+1,endIdx).filter(v=>!/^(Moderador|Moderadora|Anfitrião|Anfitriã)$/i.test(v));speakersRaw=raw.join(' • ');speakers=raw.filter(v=>v.length>2).slice(0,24).map(v=>({name:v,detail:v}))}
    out.push({title,start,end,location,type,track,speakers,speakers_raw:speakersRaw});
  }
  return [...new Map(out.map(x=>[`${x.start}|${x.title}|${x.location}`,x])).values()];
}
async function dismiss(p){for(const label of ['Aceitar','Aceito','OK','Fechar','Continuar']){const b=p.getByRole('button',{name:new RegExp(`^${label}$`,'i')});if(await b.count())await b.first().click({force:true}).catch(()=>{})}}
async function settle(p){await p.waitForLoadState('domcontentloaded').catch(()=>{});await p.waitForTimeout(1800)}
async function chooseDay(p,label,num){
  const before=await p.locator('body').innerText().catch(()=> '');
  if(new RegExp(`^${label}\\s+(?:às|as)\\s+`,'mi').test(before))return;
  const candidates=[p.getByRole('button').filter({hasText:new RegExp(label,'i')}),p.getByText(label,{exact:true}),p.getByText(num,{exact:true})];
  for(const loc of candidates){if(await loc.count()){for(let idx=(await loc.count())-1;idx>=0;idx--){await loc.nth(idx).click({force:true}).catch(()=>{});await p.waitForTimeout(1200);const txt=await p.locator('body').innerText().catch(()=> '');if(new RegExp(`^${label}\\s+(?:às|as)\\s+`,'mi').test(txt)||new RegExp(`${num}\\s+SET\\s+${label}`,'i').test(txt))return}}}
  throw new Error(`Could not activate ${label} ${num}`);
}

await page.goto(PROGRAM,{waitUntil:'domcontentloaded',timeout:120000});await dismiss(page);await settle(page);
let events=[];
for(const [label,num,date] of days){
  await chooseDay(page,label,num);
  const body=await page.locator('body').innerText();
  const raw=parseProgramText(body);
  console.log(`PROGRAM ${label}: ${raw.length} sessions`);
  if(!raw.length)console.log(body.slice(0,1200));
  for(const r of raw){const id=slugId([date,r.start,r.title,r.location]);events.push({...r,id,date,source_url:PROGRAM})}
}

await page.goto(FEST,{waitUntil:'domcontentloaded',timeout:120000});await dismiss(page);await settle(page);
for(const [label,num,date] of days){
  await chooseDay(page,label,num).catch(async()=>{const txt=await page.locator('body').innerText();if(!new RegExp(`${num}\\s+SET\\s+${label}`,'i').test(txt))throw new Error(`Could not activate FEST ${label}`)});
  const lines=cleanLines(await page.locator('body').innerText());
  const items=[];
  for(let i=0;i<lines.length-1;i++){const m=lines[i].match(/^(\d{1,2})(?::(\d{2}))?\s*h(?:\s*(\d{2}))?$/i);if(!m)continue;const start=`${String(m[1]).padStart(2,'0')}:${m[2]||m[3]||'00'}`;const title=lines[i+1];if(title&&!/^\d/.test(title)&&title.length<180)items.push({start,title})}
  const unique=[...new Map(items.map(x=>[x.start+'|'+x.title,x])).values()];
  console.log(`FEST ${label}: ${unique.length} slots`);
  unique.forEach((x,i)=>{const next=unique[i+1]?.start;const end=next&&next>x.start?next:addMinutes(x.start,x.title.toLowerCase().includes('encerramento')?15:60);events.push({id:slugId([date,x.start,x.title,'ROG.e FEST']),date,start:x.start,end,title:x.title,location:'ROG.e FEST • Riocentro',type:'ROG.e FEST',track:'Happy Hour +',speakers:[],speakers_raw:'',source_url:FEST})});
}

for(const [, ,date] of days)events.push({id:slugId([date,'10:00','Exposição ROG.e 2026']),date,start:'10:00',end:'19:00',title:'Exposição ROG.e 2026',location:'Riocentro • Pavilhões de Exposição',type:'Exposição',track:'Feira / Networking',speakers:[],speakers_raw:'Mais de 500 empresas e organizações expositoras',source_url:EXHIBITORS});

events=[...new Map(events.map(x=>[x.id,x])).values()].sort((a,b)=>`${a.date}${a.start}${a.title}`.localeCompare(`${b.date}${b.start}${b.title}`));
for(const e of events){const prev=oldMap.get(e.id);e.changed=!!prev&&[e.start,e.end,e.location,e.speakers_raw].join('|')!==[prev.start,prev.end,prev.location,prev.speakers_raw].join('|')}

await page.goto(EXHIBITORS,{waitUntil:'domcontentloaded',timeout:120000});await dismiss(page);await settle(page);
const exhibitors=await page.evaluate(()=>{const out=[],seen=new Set();for(const el of document.querySelectorAll('body *')){const t=(el.innerText||'').trim();if(!t||t.length>700||!/Pavilhão:/i.test(t)||!/Estande:/i.test(t))continue;const lines=t.split('\n').map(x=>x.trim()).filter(Boolean);const pi=lines.findIndex(x=>/^Pavilhão:/i.test(x)),si=lines.findIndex(x=>/^Estande:/i.test(x));if(pi<1||si<0)continue;const name=lines[pi-1];if(!name||name.length>120||seen.has(name))continue;const pavilion=(lines[pi].match(/^Pavilhão:\s*(.+)$/i)||[])[1]||'';const stand=(lines[si].match(/^Estande:\s*(.+)$/i)||[])[1]||'';seen.add(name);out.push({name,pavilion,stand})}return out});
console.log(`EXHIBITORS: ${exhibitors.length}`);

await browser.close();
const perDay=Object.fromEntries(days.map(([, ,d])=>[d,events.filter(e=>e.date===d&&e.type!=='Exposição').length]));
console.log('Per day:',perDay);
if(events.length<40||Object.values(perDay).some(n=>n<5))throw new Error(`Safety check failed: ${events.length} total; per day ${JSON.stringify(perDay)}. Existing data preserved.`);
fs.mkdirSync('data',{recursive:true});
const generated_at=new Date().toISOString();
fs.writeFileSync('data/events.json',JSON.stringify({generated_at,source:[PROGRAM,FEST,EXHIBITORS],count:events.length,events},null,2));
fs.writeFileSync('data/exhibitors.json',JSON.stringify({generated_at,source:EXHIBITORS,count:exhibitors.length,exhibitors},null,2));
console.log(`Scrape complete: ${events.length} events, ${exhibitors.length} exhibitors.`);
