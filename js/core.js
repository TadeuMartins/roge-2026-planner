const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DAY_LABELS={'2026-09-21':'Seg 21','2026-09-22':'Ter 22','2026-09-23':'Qua 23','2026-09-24':'Qui 24'};
const DEFAULT_PREFS={
  stakeholders:['Petrobras','EPE','ANP','IBP','Shell','bp','TotalEnergies','Equinor','ExxonMobil','Chevron','PRIO','Brava Energia','PetroReconcavo','Transpetro','Galp','PETRONAS','SLB','SBM Offshore','Ocyan','Repsol Sinopec','Vibra','AXIA Energia','Energisa','Accenture','Nokia','Google','Microsoft','AWS','NVIDIA'],
  technologies:['inteligência artificial','IA','AI','digitalização','digital twin','gêmeo digital','analytics','machine learning','OT','cybersecurity','automação','dados','IoT','manutenção preditiva','confiabilidade','asset management','MES','MOM','BIM','knowledge graph','cloud','SAP','inovação','simulação','operação inteligente','integridade industrial','eficiência energética','PD&I'],
  challenges:['eficiência operacional','confiabilidade','disponibilidade','produtividade','transição energética','descarbonização','supply chain','cadeia de fornecimento','segurança energética','redução de custos','offshore','integridade','inspeção','segurança','manutenção','CAPEX','OPEX','emissões','projetos','logística','gestão de riscos','descomissionamento','reservas','EOR','campos maduros','fator de recuperação','competitividade','CO2'],
  rooms:['CONGRESSO - SALA PLENÁRIA A','SALA LEADERSHIP LUNCHEON','CONGRESSO - SALA PLENÁRIA B','CONGRESSO - SALA 1','CONGRESSO - SALA 5','CONGRESSO - SALA 4','CONGRESSO - SALA 2','CONGRESSO - SALA 3','PAVILHÃO 2 - ARENA','PAVILHÃO 4 - ARENA','SALA 11','TECHNICAL STAGE 5','PAVILHÃO 2 - MEZANINO 2','SALA 10','TECHNICAL STAGE 4'],
  roles:['CEO','Chief Executive Officer','Co-CEO','Presidente','President','Executive Vice President','Vice-presidente executivo','EVP','Senior Vice President','Vice President','VP','Diretor Executivo','Diretora Executiva','Senior Managing Director','Managing Director','CIO','CTO','Chief Product Officer','Gerente Executivo','Gerente Geral','Director','Diretor','Head','Superintendente','Gerente','Manager','Coordenador']
};
let events=[], exhibitors=[], favorites=new Set(), radar='all', chip='';
try {
  const saved = JSON.parse(localStorage.getItem('roge_favorites') || '[]');
  if (Array.isArray(saved)) favorites = new Set(saved.filter(id => typeof id === 'string'));
} catch { /* Corrupt or unavailable storage must not prevent startup. */ }
let prefs=loadPrefs();
function loadPrefs(){try{return {...structuredClone(DEFAULT_PREFS),...JSON.parse(localStorage.getItem('roge_prefs')||'{}')}}catch{return structuredClone(DEFAULT_PREFS)}}
function norm(s=''){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()}
function uniq(a){return [...new Set(a.filter(Boolean))]}
function textOf(e){return norm([e.title,e.track,e.type,e.location,e.speakers_raw,...(e.speakers||[]).map(x=>`${x.name} ${x.detail}`)].join(' '))}
function termMatches(txt,term){const n=norm(term).trim();if(!n)return false;if(n.length<=3){const escaped=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,'i').test(txt)}return txt.includes(n)}
function containsAny(txt,arr){return arr.filter(k=>termMatches(txt,k))}
function orderedScore(txt,arr,floor=35,matcher=termMatches){const hits=arr.filter(k=>matcher(txt,k));if(!hits.length)return {score:0,hits:[]};let best=0;for(const hit of hits){const idx=arr.indexOf(hit);const raw=arr.length<=1?100:Math.round(100-(100-floor)*(idx/(arr.length-1)));best=Math.max(best,raw)}return {score:Math.min(100,best+Math.min(12,(hits.length-1)*4)),hits}}
function roleTermMatches(txt,term){const n=norm(term).trim();if(!n)return false;let corpus=txt;if(n==='presidente')corpus=corpus.replace(/vice[\s-]+presidente/g,'');if(n==='president')corpus=corpus.replace(/vice[\s-]+president/g,'');return termMatches(corpus,n)}
function roomTermMatches(txt,term){const t=norm(txt).trim(),n=norm(term).trim();if(!n)return false;if(t===n)return true;const escaped=n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`,'i').test(t)}
function seniorityScore(e){const speakerTexts=(e.speakers||[]).map(x=>norm(`${x.name||''} ${x.detail||''}`)).filter(Boolean);if(!speakerTexts.length&&e.speakers_raw)speakerTexts.push(norm(e.speakers_raw));let best={score:0,hits:[]};const allHits=[];for(const txt of speakerTexts){const r=orderedScore(txt,prefs.roles||DEFAULT_PREFS.roles,30,roleTermMatches);if(r.score>best.score)best=r;allHits.push(...r.hits)}return {score:best.score,hits:uniq(allHits)}}
function roomScore(e){return orderedScore(norm(e.location||''),prefs.rooms||DEFAULT_PREFS.rooms,35,roomTermMatches)}
function formatScore(e){const t=norm(`${e.title||''} ${e.track||''} ${e.type||''}`);if(t.includes('strategic talks'))return 100;if(t.includes('leadership luncheon'))return 100;if(t.includes('keynote'))return 90;if(t.includes('dialogo roge'))return 85;if(t.includes('cerimonia de abertura'))return 78;if(t.includes('innovation heads'))return 72;if(t.includes('painel'))return 58;if(t.includes('roda de conversa'))return 52;return 0}
function scoreEvent(e){
  const txt=textOf(e);
  const stakeholderHits=containsAny(txt,prefs.stakeholders);
  const techHits=containsAny(txt,prefs.technologies);
  const challengeHits=containsAny(txt,prefs.challenges);
  const seniorityData=seniorityScore(e);
  const roomData=roomScore(e);
  const format=formatScore(e);
  const stakeholder=Math.min(100,stakeholderHits.length*24+(txt.includes('petrobras')?20:0));
  const seniority=seniorityData.score;
  const room=roomData.score;
  const technology=Math.min(100,techHits.length*17+((txt.includes('inteligencia artificial')||/(^|[^a-z0-9])ia([^a-z0-9]|$)/.test(txt))?12:0));
  const challenge=Math.min(100,challengeHits.length*15);
  let networking=0;if(/meetings|forum|fórum|fest|happy|luncheon|cocktail|network/i.test(`${e.track||''} ${e.title||''} ${e.type||''}`))networking=82;else if(stakeholderHits.length)networking=55;
  let total=Math.round(stakeholder*.24+seniority*.22+room*.20+technology*.13+challenge*.10+format*.08+networking*.03);
  if(e.type==='Exposição')total=Math.max(total,30);if(e.type==='ROG.e FEST')total=Math.max(total,35);
  const priority=total>=55?'P2':total>=35?'P3':'P4';
  return {stakeholder,seniority,room,technology,challenge,format,networking,total,priority,isTopWindow:false,decisionWindows:[],stakeholderHits,roleHits:seniorityData.hits,roomHits:roomData.hits,techHits,challengeHits}
}
function timeToMinutes(value=''){const m=/^(\d{1,2}):(\d{2})$/.exec(value);return m?Number(m[1])*60+Number(m[2]):Number.NaN}
function minutesToTime(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`}
function compareFit(a,b){return (b._score.total-a._score.total)||(b._score.stakeholder-a._score.stakeholder)||(b._score.seniority-a._score.seniority)||(b._score.room-a._score.room)||(b._score.technology-a._score.technology)||(b._score.challenge-a._score.challenge)||norm(a.title).localeCompare(norm(b.title))}
function mergeDecisionWindows(windows){const sorted=[...windows].sort((a,b)=>timeToMinutes(a.start)-timeToMinutes(b.start));const merged=[];for(const w of sorted){const last=merged.at(-1);if(last&&last.end===w.start){last.end=w.end;last.maxCompetitors=Math.max(last.maxCompetitors||last.competitors,w.competitors);last.competitors=Math.max(last.competitors,w.competitors)}else merged.push({...w,maxCompetitors:w.competitors})}return merged}
function enriched(){const list=events.map(e=>({...e,_score:scoreEvent(e)}));for(const date of uniq(list.map(e=>e.date))){const timed=list.filter(e=>e.date===date&&e.start&&e.end&&e.type!=='Exposição').filter(e=>{const s=timeToMinutes(e.start),n=timeToMinutes(e.end);return Number.isFinite(s)&&Number.isFinite(n)&&n>s});const boundaries=uniq(timed.flatMap(e=>[timeToMinutes(e.start),timeToMinutes(e.end)])).filter(Number.isFinite).sort((a,b)=>a-b);for(let i=0;i<boundaries.length-1;i++){const segmentStart=boundaries[i],segmentEnd=boundaries[i+1];if(segmentEnd<=segmentStart)continue;const active=timed.filter(e=>timeToMinutes(e.start)<=segmentStart&&timeToMinutes(e.end)>=segmentEnd);if(active.length<2)continue;const winner=[...active].sort(compareFit)[0];winner._score.decisionWindows.push({start:minutesToTime(segmentStart),end:minutesToTime(segmentEnd),competitors:active.length})}for(const e of timed){e._score.decisionWindows=mergeDecisionWindows(e._score.decisionWindows);e._score.isTopWindow=e._score.decisionWindows.length>0;if(e._score.isTopWindow)e._score.priority='P1'}}return list}
function fmtDate(d){return DAY_LABELS[d]||d}
function byId(id){return events.find(e=>e.id===id)}
function scoreById(id){return enriched().find(e=>e.id===id)?._score||scoreEvent(byId(id)||{})}
function saveFav(){localStorage.setItem('roge_favorites',JSON.stringify([...favorites]));render()}
function toggleFav(id){favorites.has(id)?favorites.delete(id):favorites.add(id);saveFav()}
function populateFilters(){const day=$('#dayFilter'),type=$('#typeFilter'),loc=$('#locationFilter');uniq(events.map(e=>e.date)).sort().forEach(v=>day.insertAdjacentHTML('beforeend',`<option value="${escapeHtml(v)}">${escapeHtml(fmtDate(v))}</option>`));uniq(events.map(e=>e.type)).sort().forEach(v=>type.insertAdjacentHTML('beforeend',`<option>${escapeHtml(v)}</option>`));uniq(events.map(e=>e.location)).sort().forEach(v=>loc.insertAdjacentHTML('beforeend',`<option>${escapeHtml(v)}</option>`));const defaultChips=['Petrobras','IA / AI','Digitalização','Digital Twin','OT / Cyber','Confiabilidade','Supply Chain','Transição Energética','Offshore','ROG.e FEST'];$('#smartChips').innerHTML=defaultChips.map(c=>`<button class="chip" data-chip="${c}">${c}</button>`).join('')}
function chipTerms(c){return {'IA / AI':['inteligencia artificial','artificial intelligence','machine learning','analytics','generative ai','ia generativa'],'Digitalização':['digitalizacao','digital transformation'],'Digital Twin':['digital twin','gemeo digital'],'OT / Cyber':[' ot ','cyber','ciber'],'Confiabilidade':['confiabilidade','preditiv','manutencao'],'Supply Chain':['supply chain','suprimentos','compras'],'Transição Energética':['transicao energetica','descarbon','renovav','hidrogenio'],'Offshore':['offshore','subsea','pocos','reservas'],'ROG.e FEST':['rog.e fest','happy hour']}[c]||[norm(c)]}
