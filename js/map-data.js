// Coordinates are percentages of the supplied floor image, for approximate orientation.
globalThis.ROGE_MAP_FLOORS = [
  { id: 'ground', name: 'Térreo · planta geral', shortName: 'Térreo', image: 'assets/maps/planta-geral-riocentro.webp', document: 'assets/maps/planta-geral-riocentro.pdf', width: 3600, height: 5093, source: 'Planta geral enviada pela equipe · revisão indicada: 18/05/2026' },
  { id: 'upper', name: 'Congresso · 2º andar', shortName: '2º andar', image: 'assets/maps/congresso-segundo-andar.png', width: 523, height: 588, source: 'Mapa do congresso enviado pela equipe' }
];
globalThis.ROGE_MAP_PLACES = [
  {id:'pavilion2',floor:'ground',name:'Pavilhão 2',label:'P2',x:64,y:78,area:true,aliases:['PAVILHÃO 2 - ARENA']},
  {id:'pavilion3',floor:'ground',name:'Pavilhão 3',label:'P3',x:66,y:53,area:true,aliases:['PAVILHÃO 3 - ARENA']},
  {id:'pavilion4',floor:'ground',name:'Pavilhão 4',label:'P4',x:54,y:25,area:true,aliases:['PAVILHÃO 4 - ARENA']},
  {id:'pavilion6',floor:'ground',name:'Pavilhão 6',label:'P6',x:16,y:30,area:true,aliases:[]},
  {id:'plenary-a',floor:'ground',name:'Congresso · Plenária A',label:'A',x:13.49602,y:54.17214,area:true,sourceLabel:'Plenaria A',aliases:['CONGRESSO - SALA PLENÁRIA A']},
  {id:'plenary-b',floor:'ground',name:'Congresso · Plenária B',label:'B',x:12.79748,y:57.47761,area:true,sourceLabel:'Plenaria B',aliases:['CONGRESSO - SALA PLENÁRIA B']},
  {id:'ibp',floor:'ground',name:'IBP · referência B10',label:'IBP',x:55.40679,y:82.43375,sourceLabel:'B10',note:'Centro do rótulo B10 na planta de maio/2026, não o contorno do estande. Confirme a alocação atual no local.',aliases:['PAVILHÃO 2 - ESTANDE IBP']},
  {id:'coworking3',floor:'ground',name:'Pavilhão 3 · Coworking',label:'C3',x:71.81041,y:58.84748,sourceLabel:'COWORKING',aliases:['PAVILHÃO 3 - COWORKING']},
  {id:'auditorium4',floor:'ground',name:'Pavilhão 4 · Auditório',label:'AUD',x:48.02086,y:15.69512,sourceLabel:'AUDIT. PAV. 4',aliases:['PAVILHÃO 4 - AUDITÓRIO']},
  {id:'mezzanine2',floor:'ground',name:'Pavilhão 2 · Mezanino 2',label:'M2',x:59,y:88,area:true,aliases:['PAVILHÃO 2 - MEZANINO 2']},
  {id:'fest',floor:'ground',name:'ROG.e Fest',label:'F',x:10,y:88,aliases:['ROG.e FEST • Riocentro']},
  {id:'registration',floor:'ground',name:'Acesso e credenciamento',label:'E',x:36,y:96,aliases:[]},
  {id:'room1',floor:'upper',name:'Sala 01',label:'01',x:16.5,y:63,aliases:['CONGRESSO - SALA 1','SALA 01']},
  {id:'room2',floor:'upper',name:'Sala 02',label:'02',x:16.5,y:55,aliases:['CONGRESSO - SALA 2','SALA 02']},
  {id:'room3',floor:'upper',name:'Sala 03',label:'03',x:16.5,y:47,aliases:['CONGRESSO - SALA 3','SALA 03']},
  {id:'room4',floor:'upper',name:'Sala 04',label:'04',x:16.5,y:32,aliases:['CONGRESSO - SALA 4','SALA 04']},
  {id:'room5',floor:'upper',name:'Sala 05',label:'05',x:16.5,y:24,aliases:['CONGRESSO - SALA 5','SALA 05']},
  {id:'room6',floor:'upper',name:'Sala 06',label:'06',x:38.5,y:30,aliases:['SALA 06']},
  {id:'room7',floor:'upper',name:'Sala 07',label:'07',x:49.5,y:26,aliases:['SALA 07']},
  {id:'room8',floor:'upper',name:'Sala 08',label:'08',x:60.5,y:30,aliases:['SALA 08']},
  {id:'room9',floor:'upper',name:'Sala 09',label:'09',x:60.5,y:54,aliases:['SALA 09']},
  {id:'room10',floor:'upper',name:'Sala 10',label:'10',x:49.5,y:53,aliases:['SALA 10']},
  {id:'room11',floor:'upper',name:'Sala 11',label:'11',x:38.5,y:54,aliases:['SALA 11']},
  {id:'leadership',floor:'upper',name:'Leadership Luncheon',label:'L',x:81,y:22,aliases:['SALA LEADERSHIP LUNCHEON']},
  {id:'petrobras',floor:'upper',name:'Sala Petrobras',label:'P',x:61.5,y:22,aliases:['SALA PETROBRAS']},
  {id:'press',floor:'upper',name:'Imprensa',label:'i',x:81,y:65,aliases:[]},
  {id:'coworking-upper',floor:'upper',name:'Coworking · congresso',label:'C',x:50,y:79,aliases:[]}
];
globalThis.resolveMapPlace = location => ROGE_MAP_PLACES.find(place => place.aliases.some(alias => alias.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim() === String(location||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()));

globalThis.ROGE_BOOTH_REFERENCE_NOTE = 'Código de estande informado pelo diretório atual; referência de layout de maio/2026. A alocação da empresa pode ter mudado e não foi verificada na planta. Marcadores são centros de rótulos, não contornos de estandes.';
globalThis.normalizeBoothCode = value => {
  const match = /^([A-Z]{1,3})(\d{1,2})([A-Z]?)$/.exec(String(value || '').trim().toUpperCase());
  return match ? match[1] + match[2].padStart(2, '0') + match[3] : null;
};
globalThis.parseBoothStands = value => String(value || '').split(/\s*\+\s*/).map(text => {
  const match = /^\s*([A-Z]{1,3}\d{1,2}[A-Z]?)(?=$|\s|-)\s*(.*)$/i.exec(text);
  if (!match) return {text: text.trim(), code: null, substand: false};
  const suffix = match[2].replace(/^-\s*/, '').trim();
  return {text: text.trim(), code: normalizeBoothCode(match[1]), substand: /^(?:\d+|[A-Z])$/i.test(suffix)};
});
globalThis.resolveExhibitorBooths = (exhibitor, data) => {
  const pavilion = /^[2346]$/.test(String(exhibitor.pavilion || '').trim()) ? String(exhibitor.pavilion).trim() : null;
  const stands = parseBoothStands(exhibitor.stand).map(stand => {
    const positions = stand.code ? data?.booths?.[stand.code] || [] : [];
    let status = !data ? 'unavailable' : !stand.code ? 'invalid' : !positions.length ? 'missing' : positions.length > 1 ? 'ambiguous' : pavilion && positions[0].pavilion !== pavilion ? 'mismatch' : 'located';
    const point = status === 'located' ? {...positions[0], floor: 'ground', code: stand.code} : null;
    if (status === 'located' && stand.substand) status = 'parent';
    return {...stand, status, point, candidates: positions};
  });
  const conflict = stands.some(s => s.status === 'mismatch' || s.status === 'ambiguous');
  return {stands, points: stands.flatMap(s => s.point ? [s.point] : []), pavilion: conflict ? null : pavilion, note: ROGE_BOOTH_REFERENCE_NOTE};
};
globalThis.searchMapExhibitors = (list, query) => {
  const key = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = key(query).trim(), code = normalizeBoothCode(query);
  return list.filter(company => !q || key(company.name + ' ' + company.stand).includes(q) ||
    (code && parseBoothStands(company.stand).some(stand => stand.code === code))).sort((a,b) => a.name.localeCompare(b.name, 'pt-BR'));
};
globalThis.mapEventPavilionOptions = location => /^(riocentro\s*[•-]\s*)?pavilh[oõ]es de exposi[cç][aã]o$/i.test(String(location || '').trim()) ? ['pavilion2','pavilion3','pavilion4','pavilion6'] : [];
