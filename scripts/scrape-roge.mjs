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
const context=await browser.newContext({locale:'pt-BR',timezoneId:'America/Sao_Paulo',viewport:{width:1440,height:1200}});
const page=await context.newPage();
page.setDefaultTimeout(15000);

function readJSON(path,fallback){try{return JSON.parse(fs.readFileSync(path,'utf8'))}catch{return fallback}}
function slugId(parts){return crypto.createHash('sha1').update(parts.join('|').toLowerCase()).digest('hex').slice(0,18)}
function addMinutes(hhmm,min){const [h,m]=hhmm.split(':').map(Number);const d=new Date(2000,0,1,h,m+min);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
async function dismiss(page){for(const label of ['Aceitar','Aceito','OK','Fechar','Continuar']){const b=page.getByRole('button',{name:new RegExp(`^${label}$`,'i')});if(await b.count())await b.first().click({force:true}).catch(()=>{})}}
async function chooseDay(page,label,num){const candidates=[page.getByRole('button').filter({hasText:new RegExp(label,'i')}),page.getByText(label,{exact:true}),page.getByText(num,{exact:true})];for(const loc of candidates){if(await loc.count()){await loc.last().click({force:true}).catch(()=>{});await page.waitForTimeout(900);return}}}

await page.goto(PROGRAM,{waitUntil:'domcontentloaded',timeout:120000});
await dismiss(page);await page.waitForTimeout(1400);
let events=[];
for(const [label,num,date] of days){
  await chooseDay(page,label,num);
  const raw=await page.evaluate(()=>{
    const time=/^(?:[01]\d|2[0-3]):[0-5]\d\s*-\s*(?:[01]\d|2[0-3]):[0-5]\d$/;
    const visible=el=>!!(el.offsetWidth||el.offsetHeight||el.getClientRects().length);
    const nodes=[...document.querySelectorAll('body *')].filter(el=>visible(el)&&el.children.length===0&&time.test((el.textContent||'').trim()));
    const seen=new Set(),out=[];
    for(const node of nodes){
      let card=node.parentElement,best=null;
      for(let i=0;i<9&&card;i++,card=card.parentElement){const heading=card.querySelector('h2,h3,h4');const txt=(card.innerText||'').trim();if(heading&&txt.includes(node.textContent.trim())&&txt.length<7500){best=card;if(/Palestrantes:|Ver mais|Congresso|Eventos Paralelos/i.test(txt))break}}
      card=best||node.parentElement;if(!card)continue;
      const lines=(card.innerText||'').split('\n').map(x=>x.trim()).filter(Boolean);
      const tm=(node.textContent||'').trim();const ti=lines.indexOf(tm);const heading=card.querySelector('h2,h3,h4');const title=(heading?.innerText||'').trim();if(!title||seen.has(title+'|'+tm))continue;seen.add(title+'|'+tm);
      const [start,end]=tm.split('-').map(x=>x.trim());
      let location='';for(let i=ti+1;i<Math.min(lines.length,ti+5);i++){if(!/Palestrantes:|Ver mais/i.test(lines[i])&&!time.test(lines[i])){location=lines[i];break}}
      const titleIndex=lines.indexOf(title);const pre=lines.slice(Math.max(0,titleIndex-5),titleIndex);let type=pre.find(x=>/^Congresso$/i.test(x)||/^Eventos Paralelos$/i.test(x))||'';if(!type){const p=pre.join(' ');type=/Eventos Paralelos/i.test(p)?'Eventos Paralelos':/Congresso/i.test(p)?'Congresso':''}
      const ignore=new Set(['Congresso','Eventos Paralelos',title,tm,location]);const track=pre.filter(x=>!ignore.has(x)&&!/Segunda|Terça|Quarta|Quinta|às\s+\d/i.test(x)).slice(-1)[0]||'';
      const pidx=lines.findIndex(x=>/^Palestrantes:/i.test(x));const vend=lines.findIndex((x,i)=>i>pidx&&/^Ver mais$/i.test(x));const speakerLines=pidx>=0?lines.slice(pidx+1,vend>pidx?vend:undefined):[];
      const alts=[...card.querySelectorAll('img[alt]')].map(x=>(x.getAttribute('alt')||'').trim()).filter(x=>x&&!/hashtag|social|logo|roge/i.test(x));
      const speakers=[...new Set(alts)].map(name=>{const detail=speakerLines.find(x=>x.toLowerCase().startsWith(name.toLowerCase()))||name;return {name,detail}});
      out.push({title,start,end,location,type:type||'Programação',track,speakers,speakers_raw:speakerLines.join(' • ')});
    }return out;
  });
  for(const r of raw){const id=slugId([date,r.start,r.title,r.location]);events.push({...r,id,date,source_url:PROGRAM})}
}

await page.goto(FEST,{waitUntil:'domcontentloaded',timeout:120000});await dismiss(page);await page.waitForTimeout(1000);
for(const [label,num,date] of days){
  await chooseDay(page,label,num);
  const items=await page.evaluate(()=>{const text=document.body.innerText||'';const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);const out=[];for(let i=0;i<lines.length-1;i++){const m=lines[i].match(/^(\d{1,2})(?::(\d{2}))?h$/i);if(m){const start=`${String(m[1]).padStart(2,'0')}:${m[2]||'00'}`;const title=lines[i+1];if(title&&!/^[0-9]/.test(title)&&title.length<180)out.push({start,title})}}return out});
  const unique=[...new Map(items.map(x=>[x.start+'|'+x.title,x])).values()];
  unique.forEach((x,i)=>{const next=unique[i+1]?.start;const end=next&&next>x.start?next:addMinutes(x.start,x.title.toLowerCase().includes('encerramento')?15:60);events.push({id:slugId([date,x.start,x.title,'ROG.e FEST']),date,start:x.start,end,title:x.title,location:'ROG.e FEST • Riocentro',type:'ROG.e FEST',track:'Happy Hour +',speakers:[],speakers_raw:'',source_url:FEST})});
}
for(const [, ,date] of days)events.push({id:slugId([date,'10:00','Exposição ROG.e 2026']),date,start:'10:00',end:'19:00',title:'Exposição ROG.e 2026',location:'Riocentro • Pavilhões de Exposição',type:'Exposição',track:'Feira / Networking',speakers:[],speakers_raw:'Mais de 500 empresas e organizações expositoras',source_url:EXHIBITORS});

events=[...new Map(events.map(x=>[x.id,x])).values()].sort((a,b)=>`${a.date}${a.start}${a.title}`.localeCompare(`${b.date}${b.start}${b.title}`));
for(const e of events){const prev=oldMap.get(e.id);e.changed=!!prev&&[e.start,e.end,e.location,e.speakers_raw].join('|')!==[prev.start,prev.end,prev.location,prev.speakers_raw].join('|')}

await page.goto(EXHIBITORS,{waitUntil:'domcontentloaded',timeout:120000});await dismiss(page);await page.waitForTimeout(1400);
const exhibitors=await page.evaluate(()=>{const out=[],seen=new Set();for(const h of document.querySelectorAll('h2,h3,h4')){const name=(h.innerText||'').trim();if(!name||name.length>100||seen.has(name))continue;let c=h.parentElement,best=null;for(let i=0;i<6&&c;i++,c=c.parentElement){const t=c.innerText||'';if(/Pavilhão:/i.test(t)&&/Estande:/i.test(t)&&t.length<800){best=c;break}}if(!best)continue;const t=best.innerText||'';const pavilion=(t.match(/Pavilhão:\s*([^\n]+)/i)||[])[1]?.trim()||'';const stand=(t.match(/Estande:\s*([^\n]+)/i)||[])[1]?.trim()||'';seen.add(name);out.push({name,pavilion,stand})}return out});

await browser.close();
if(events.length<40)throw new Error(`Safety check failed: only ${events.length} events captured. Existing data will be preserved.`);
fs.mkdirSync('data',{recursive:true});
const generated_at=new Date().toISOString();
fs.writeFileSync('data/events.json',JSON.stringify({generated_at,source:[PROGRAM,FEST,EXHIBITORS],count:events.length,events},null,2));
fs.writeFileSync('data/exhibitors.json',JSON.stringify({generated_at,source:EXHIBITORS,count:exhibitors.length,exhibitors},null,2));
console.log(`Scrape complete: ${events.length} events, ${exhibitors.length} exhibitors.`);
