import { chromium } from 'playwright';
import fs from 'node:fs';

const URL='https://roge.energy/expositores';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({
  locale:'pt-BR',
  timezoneId:'America/Sao_Paulo',
  viewport:{width:1440,height:1200},
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
});
page.setDefaultTimeout(15000);
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForTimeout(1800);
for(const label of ['Aceitar','Aceito','OK','Fechar','Continuar']){
  const b=page.getByRole('button',{name:new RegExp(`^${label}$`,'i')});
  if(await b.count())await b.first().click({force:true}).catch(()=>{});
}

async function collect(){
  return page.evaluate(()=>{
    const out=[],seen=new Set();
    const headings=[...document.querySelectorAll('h2,h3,h4')];
    for(const h of headings){
      const name=(h.innerText||'').replace(/\s+/g,' ').trim();
      if(!name||name.length>140||/Lista de Expositores/i.test(name)||seen.has(name))continue;
      let c=h.parentElement,best=null;
      for(let i=0;i<8&&c;i++,c=c.parentElement){
        const t=(c.innerText||'').trim();
        if(/Pavilhão:\s*/i.test(t)&&/Estande:\s*/i.test(t)&&t.length<1200){best=c;break}
      }
      if(!best)continue;
      const text=(best.innerText||'').replace(/\r/g,'');
      const pavilion=(text.match(/Pavilhão:\s*([^\n]+)/i)||[])[1]?.trim()||'';
      const stand=(text.match(/Estande:\s*([^\n]+)/i)||[])[1]?.trim()||'';
      const link=[...best.querySelectorAll('a[href]')].map(a=>a.href).find(x=>x&&!x.includes('roge.energy/expositores'))||'';
      seen.add(name);out.push({name,pavilion,stand,website:link});
    }
    return out;
  });
}

let last=0,stable=0;
for(let round=0;round<80;round++){
  const current=await collect();
  console.log(`Exhibitors visible after round ${round}: ${current.length}`);
  if(current.length===last)stable++;else stable=0;
  last=current.length;
  const buttons=page.getByRole('button',{name:/^Ver mais$/i});
  if(!(await buttons.count())||stable>=2)break;
  const button=buttons.last();
  if(!(await button.isVisible().catch(()=>false)))break;
  await button.scrollIntoViewIfNeeded().catch(()=>{});
  await button.click({force:true}).catch(()=>{});
  await page.waitForTimeout(650);
}

const exhibitors=await collect();
await browser.close();
if(exhibitors.length<100)throw new Error(`Safety check failed: only ${exhibitors.length} exhibitors captured; keeping previous list.`);
const generated_at=new Date().toISOString();
fs.writeFileSync('data/exhibitors.json',JSON.stringify({generated_at,source:URL,count:exhibitors.length,exhibitors},null,2));
console.log(`Complete exhibitor scrape: ${exhibitors.length} exhibitors.`);
