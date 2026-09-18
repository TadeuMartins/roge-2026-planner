// Coordinates are percentages of the supplied floor image, for approximate orientation.
globalThis.ROGE_MAP_FLOORS = [
  { id: 'ground', name: 'Térreo · planta geral', shortName: 'Térreo', image: 'assets/maps/planta-geral-riocentro.webp', document: 'assets/maps/planta-geral-riocentro.pdf', width: 3600, height: 5093, source: 'Planta geral enviada pela equipe · revisão indicada: 18/05/2026' },
  { id: 'upper', name: 'Congresso · 2º andar', shortName: '2º andar', image: 'assets/maps/congresso-segundo-andar.png', width: 523, height: 587, source: 'Mapa do congresso enviado pela equipe' }
];
globalThis.ROGE_MAP_PLACES = [
  {id:'pavilion2',floor:'ground',name:'Pavilhão 2',label:'P2',x:64,y:78,area:true,aliases:['PAVILHÃO 2 - ARENA','PAVILHÃO 2 - ESTANDE IBP']},
  {id:'pavilion3',floor:'ground',name:'Pavilhão 3',label:'P3',x:66,y:53,area:true,aliases:['PAVILHÃO 3 - ARENA','PAVILHÃO 3 - COWORKING']},
  {id:'pavilion4',floor:'ground',name:'Pavilhão 4',label:'P4',x:54,y:25,area:true,aliases:['PAVILHÃO 4 - ARENA','PAVILHÃO 4 - AUDITÓRIO']},
  {id:'pavilion6',floor:'ground',name:'Pavilhão 6',label:'P6',x:16,y:30,area:true,aliases:[]},
  {id:'congress',floor:'ground',name:'Congresso · Plenárias A e B',label:'A/B',x:14,y:55,area:true,aliases:['CONGRESSO - SALA PLENÁRIA A','CONGRESSO - SALA PLENÁRIA B']},
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
