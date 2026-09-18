let mapFloor = ROGE_MAP_FLOORS[0].id, mapPlace = '', mapZoom = 1, mapBaseWidth = 500, mapReady = false;
let mapDay = '', mapFocusedEvent = null, mapExhibitor = null, mapBoothData = null, mapBoothError = false, mapBoothIndex = 0;
function currentFloor() { return ROGE_MAP_FLOORS.find(f => f.id === mapFloor); }
function mapEvents(place, list = events) { return list.filter(e => resolveMapPlace(e.location)?.id === place.id); }
function mapSession(event) {
  return '<button class="map-session" data-map-event="' + escapeHtml(event.id) + '"><small>' + escapeHtml(fmtDate(event.date) + ' · ' + event.start + '–' + event.end) + '</small><b>' + escapeHtml(event.title) + '</b><small>' + escapeHtml(event.location) + '</small><span>' + escapeHtml(assignedNames(event.id).join(' · ') || 'Equipe ainda não definida') + '</span>' + (teamConflictIds.has(event.id) ? '<em class="participant-conflict">Conflito de horário na equipe</em>' : '') + '</button>';
}
function renderMapSidebar() {
  if (!mapReady || plannerView !== 'map') return;
  // Map state is independent of discovery, favorites, person and calendar filters.
  $('#mapDay').value = mapDay;
  const q = norm($('#mapSearch').value).trim();
  const scoped = events.filter(e => (!mapDay || e.date === mapDay) && (!q || norm([e.title,e.location,resolveMapPlace(e.location)?.name || '',e.speakers_raw || '',...(e.speakers || []).map(s => s.detail || s.name),...assignedNames(e.id)].join(' ')).includes(q)));
  const places = ROGE_MAP_PLACES.filter(p => p.floor === mapFloor && (p.id === mapPlace || !q || norm(p.name).includes(q) || mapEvents(p,scoped).length));
  const unmapped = scoped.filter(e => !resolveMapPlace(e.location));
  const onFloor = scoped.filter(e => resolveMapPlace(e.location)?.floor === mapFloor).length;
  $('#mapCoverage').textContent = onFloor + ' eventos neste andar · ' + (scoped.length - unmapped.length - onFloor) + ' no outro andar · ' + unmapped.length + ' sem posição confirmada';
  $('#mapUnmapped').hidden = !unmapped.length;
  $('#mapUnmappedSummary').textContent = unmapped.length + ' eventos sem posição confirmada na planta';
  $('#mapUnmappedEvents').innerHTML = unmapped.map(mapSession).join('');
  $('#mapPlaces').innerHTML = places.map(p => {
    const list = mapEvents(p,scoped);
    return '<button class="map-place-option ' + (p.id === mapPlace ? 'selected' : '') + '" data-map-place="' + p.id + '" aria-pressed="' + (p.id === mapPlace) + '"><span class="map-place-symbol">' + escapeHtml(p.label) + '</span><span><b>' + escapeHtml(p.name) + '</b><small>' + (list.length ? list.length + ' eventos' : mapEvents(p).length ? 'Sem resultados nos filtros' : 'Ponto de referência') + '</small></span><span aria-hidden="true">↗</span></button>';
  }).join('') || '<p class="muted">Nenhum local neste andar corresponde à busca. Tente outro andar ou limpe a busca.</p>';
  const selected = ROGE_MAP_PLACES.find(p => p.id === mapPlace);
  $('#mapSelection').hidden = !selected;
  if (selected) {
    const list = mapEvents(selected,scoped).sort((a,b) => (a.date+a.start).localeCompare(b.date+b.start));
    $('#mapPlaceName').textContent = selected.name;
    $('#mapPlaceNote').textContent = selected.note || (selected.area ? 'Referência de área ou pavilhão, não a posição exata da sala/arena. Confirme na sinalização do evento.' : selected.sourceLabel ? 'Referência do rótulo “' + selected.sourceLabel + '” na planta de maio/2026. Confirme a sinalização atual.' : 'Posição aproximada no mapa do congresso. Confirme a sinalização local.');
    $('#mapPlaceCount').textContent = list.length ? list.length + ' eventos · horários de Brasília' : mapEvents(selected).length ? 'Nenhum evento corresponde aos filtros atuais' : 'Local de apoio · sem eventos associados';
    $('#mapSchedule').innerHTML = list.map(mapSession).join('');
  }
  $$('#mapPins .map-pin').forEach(pin => {
    pin.classList.toggle('selected', pin.dataset.mapPlace === mapPlace);
    pin.setAttribute('aria-pressed', String(pin.dataset.mapPlace === mapPlace));
    pin.hidden = !!q && !places.some(p => p.id === pin.dataset.mapPlace);
  });
  renderMapEventFocus();
}
function renderMapEventFocus() {
  const container = $('#mapEventFocus');
  if (!container) return;
  container.hidden = !mapFocusedEvent;
  if (!mapFocusedEvent) { container.innerHTML = ''; return; }
  const event = byId(mapFocusedEvent.id) || mapFocusedEvent, place = resolveMapPlace(event.location);
  const options = mapEventPavilionOptions(event.location);
  container.innerHTML = '<h3>Evento solicitado</h3>' + mapSession(event) + '<p>' + escapeHtml(place ? 'Referência: ' + place.name + (place.area ? ' (área aproximada).' : '.') : options.length ? 'O evento abrange os pavilhões de exposição. Escolha uma referência; não há um ponto único confirmado.' : 'Sem posição confirmada para este local. O número de um Technical Stage não corresponde automaticamente ao número de uma sala.') + '</p>' +
    options.map(id => { const p = ROGE_MAP_PLACES.find(p => p.id === id); return '<button class="ghost-btn" data-map-place="' + id + '">' + escapeHtml(p.name) + '</button>'; }).join('') +
    '<button class="ghost-btn" data-map-event="' + escapeHtml(event.id) + '">Detalhes</button> <button class="ghost-btn" data-map-edit="' + escapeHtml(event.id) + '">Editar equipe</button>';
}
function renderMapCompanies() {
  const container = $('#mapCompanies');
  if (!container) return;
  const q = $('#mapCompanySearch').value, matches = searchMapExhibitors(exhibitors, q);
  container.innerHTML = '<p role="status">' + matches.length + ' empresas encontradas' + (matches.length > 40 ? ' · mostrando 40. Refine por nome ou estande.' : '.') + '</p>' +
    (q ? '<button class="ghost-btn" data-map-company-clear>Limpar busca</button>' : '') +
    matches.slice(0,40).map(company => '<button class="map-company-option" data-map-company="' + exhibitors.indexOf(company) + '"><b>' + escapeHtml(company.name) + '</b><small>' + escapeHtml('Estande: ' + (company.stand || 'não informado') + ' · Pavilhão: ' + (company.pavilion || 'não informado')) + '</small></button>').join('');
}
function renderMapExhibitor() {
  const container = $('#mapExhibitorSelection'), overlay = $('#mapBoothPins');
  if (!container || !overlay) return;
  container.hidden = !mapExhibitor;
  overlay.hidden = !$('#mapShowPins').checked;
  overlay.innerHTML = '';
  if (!mapExhibitor) return;
  const result = resolveExhibitorBooths(mapExhibitor, mapBoothData);
  $('#mapExhibitorName').textContent = mapExhibitor.name;
  $('#mapExhibitorNote').textContent = result.note + (mapFloor !== 'ground' ? ' Os estandes ficam no térreo.' : '');
  const statusText = stand => ({located:'Código localizado na planta de maio; empresa não verificada.',parent:'Subestande sem posição própria. Referência aproximada do estande principal ' + stand.code + '.',missing:'Código não encontrado na planta de maio. Sem marcador exato.',invalid:'Estande não informado como código válido. Sem marcador exato.',unavailable:mapBoothError ? 'Falha ao carregar a planta de estandes. Sem marcador exato.' : 'Carregando posições de estandes...',ambiguous:'Código em posições distintas na planta. Não é possível escolher uma posição com segurança.',mismatch:'Conflito: diretório informa pavilhão ' + mapExhibitor.pavilion + ', mas o código está no pavilhão ' + stand.candidates.map(p=>p.pavilion).join('/') + ' da planta. Sem marcador exato.'})[stand.status];
  $('#mapExhibitorStands').innerHTML = result.stands.map((stand,index) => '<div class="map-booth-result"><b>' + escapeHtml(stand.text || 'Estande não informado') + '</b><p>' + escapeHtml(statusText(stand)) + '</p>' + (stand.point ? '<button class="ghost-btn" data-booth-index="' + index + '">Focar ' + escapeHtml(stand.code) + '</button>' : '') + '</div>').join('') +
    (!result.points.length && result.pavilion ? '<p>Somente referência de pavilhão informada no diretório, não a posição da empresa.</p><button class="ghost-btn" data-map-place="pavilion' + result.pavilion + '">Ver Pavilhão ' + result.pavilion + '</button>' : '') +
    '<button class="ghost-btn" data-map-exhibitor-clear>Limpar seleção</button>';
  if (mapFloor !== 'ground') return;
  overlay.innerHTML = result.stands.map((stand,index) => stand.point ? '<button class="map-pin map-booth-pin ' + (index === mapBoothIndex ? 'selected' : '') + '" data-booth-index="' + index + '" style="left:' + stand.point.x + '%;top:' + stand.point.y + '%" aria-pressed="' + (index === mapBoothIndex) + '" aria-label="' + escapeHtml(mapExhibitor.name + ' · ' + stand.code + '. ' + statusText(stand) + ' ' + result.note) + '" title="' + escapeHtml(result.note) + '"><span>' + escapeHtml(mapExhibitor.name) + '</span><b>' + escapeHtml(stand.code + (stand.substand ? ' (principal)' : '')) + '</b></button>' : '').join('');
}
function renderFloor() {
  const floor = currentFloor();
  $('#mapImage').src = floor.image; $('#mapImage').alt = 'Planta do evento · ' + floor.name;
  $('#mapOriginal').href = floor.document || floor.image;
  $('#mapFloorTitle').textContent = floor.name;
  $('#mapSource').textContent = floor.source + ' · Marcadores aproximados; confira a sinalização no local.';
  $('#mapFloorButtons').innerHTML = ROGE_MAP_FLOORS.map(f => '<button class="floor-button ' + (f.id === mapFloor ? 'active' : '') + '" data-map-floor="' + f.id + '" aria-pressed="' + (f.id === mapFloor) + '">' + escapeHtml(f.name) + '</button>').join('');
  $('#mapPins').innerHTML = ROGE_MAP_PLACES.filter(p => p.floor === mapFloor).map(p => '<button class="map-pin" data-map-place="' + p.id + '" style="left:' + p.x + '%;top:' + p.y + '%" title="' + escapeHtml(p.name) + '" aria-label="' + escapeHtml(p.name) + '" aria-pressed="false">' + escapeHtml(p.label) + '</button>').join('');
  renderMapSidebar(); renderMapExhibitor(); requestAnimationFrame(fitMap);
}
function fitMap() {
  const viewport = $('#mapViewport'), floor = currentFloor();
  if (!viewport.clientWidth) return;
  mapBaseWidth = Math.min(Math.max(200,viewport.clientWidth-32),(viewport.clientHeight-32)*floor.width/floor.height);
  mapZoom = 1; applyMapZoom();
  viewport.scrollTo(0,0);
}
function applyMapZoom() {
  const width = mapBaseWidth * mapZoom, floor = currentFloor();
  $('#mapPlane').style.width = width + 'px'; $('#mapPlane').style.height = width * floor.height / floor.width + 'px';
  $('#mapZoomLabel').textContent = Math.round(mapZoom * 100) + '%';
  $('#mapZoomOut').disabled = mapZoom <= 1; $('#mapZoomIn').disabled = mapZoom >= 8;
}
function zoomMap(factor) {
  const viewport = $('#mapViewport'), old = mapZoom;
  const cx = viewport.scrollLeft + viewport.clientWidth/2, cy = viewport.scrollTop + viewport.clientHeight/2;
  mapZoom = Math.max(1,Math.min(8,mapZoom * factor)); applyMapZoom();
  viewport.scrollTo(cx*mapZoom/old-viewport.clientWidth/2,cy*mapZoom/old-viewport.clientHeight/2);
}
function selectMapPlace(id, focus = false) {
  const place = ROGE_MAP_PLACES.find(p => p.id === id); if (!place) return;
  mapPlace = id;
  if (focus) { $('#mapShowPins').checked = true; $('#mapPins').hidden = false; }
  if (mapFloor !== place.floor) { mapFloor = place.floor; renderFloor(); }
  renderMapSidebar();
  if (focus) focusMapPoint(place);
}
function focusMapPoint(point) {
  requestAnimationFrame(() => {
    mapZoom = 3.5; applyMapZoom();
    const plane = $('#mapPlane'), viewport = $('#mapViewport');
    const bounds = plane.getBoundingClientRect(), view = viewport.getBoundingClientRect();
    viewport.scrollTo({left:viewport.scrollLeft + bounds.left - view.left - viewport.clientLeft + plane.clientWidth*point.x/100 - viewport.clientWidth/2,
      top:viewport.scrollTop + bounds.top - view.top - viewport.clientTop + plane.clientHeight*point.y/100 - viewport.clientHeight/2,behavior:'smooth'});
  });
}
function selectMapBooth(index) {
  if (!mapExhibitor) return;
  const stand = resolveExhibitorBooths(mapExhibitor,mapBoothData).stands[index];
  if (!stand?.point) return;
  mapBoothIndex = index;
  if (mapFloor !== 'ground') { mapFloor = 'ground'; renderFloor(); }
  $('#mapShowPins').checked = true; $('#mapPins').hidden = false;
  renderMapExhibitor(); focusMapPoint(stand.point);
}
function showExhibitorOnMap(exhibitor) {
  if (!exhibitor) return;
  mapExhibitor = exhibitor; mapFocusedEvent = null; mapPlace = ''; mapBoothIndex = 0;
  setPlannerView('map'); mapFloor = 'ground'; renderFloor();
  renderMapCompanies();
  const result = resolveExhibitorBooths(exhibitor,mapBoothData);
  const index = result.stands.findIndex(stand => stand.point);
  $('#mapNotice').textContent = 'Empresa selecionada: ' + exhibitor.name + '. ' + (index >= 0 ? ROGE_BOOTH_REFERENCE_NOTE : 'Sem posição exata confirmada; consulte as informações de estande abaixo.');
  if (index >= 0) selectMapBooth(index);
  $('#mapView').scrollIntoView({behavior:'smooth',block:'start'});
}
function showEventOnMap(event) {
  if (!event) return;
  const place = resolveMapPlace(event.location);
  mapFocusedEvent = event; mapExhibitor = null; mapPlace = ''; mapDay = event.date || '';
  $('#eventModal').close(); setPlannerView('map');
  $('#mapSearch').value = ''; $('#mapDay').value = mapDay;
  $('#mapNotice').textContent = place ? (place.area ? 'Referência de área: ' : 'Local do evento: ') + place.name + (place.area ? '. A sala ou o estande exato deve ser confirmado na sinalização local.' : '') : 'Não há marcador confirmado para “' + event.location + '”. Consulte a planta e a sinalização do evento.';
  if (place) selectMapPlace(place.id,true); else { mapPlace='';renderMapSidebar(); }
  renderMapExhibitor();
  $('#mapView').scrollIntoView({behavior:'smooth',block:'start'});
}
function wireMaps() {
  mapReady = true;
  $('#mapDay').innerHTML = '<option value="">Todos os dias</option>' + uniq(events.map(e=>e.date)).sort().map(d=>'<option value="'+escapeHtml(d)+'">'+escapeHtml(fmtDate(d))+'</option>').join('');
  $('#mapNotice').setAttribute('role','status'); $('#mapNotice').setAttribute('aria-live','polite');
  $('#mapSearch').addEventListener('input',renderMapSidebar); $('#mapDay').addEventListener('change',e=>{mapDay=e.target.value;renderMapSidebar();});
  $('#mapCompanySearch')?.addEventListener('input',renderMapCompanies);
  $('#mapView').addEventListener('click',e=>{
    const floor = e.target.closest('[data-map-floor]'), place = e.target.closest('[data-map-place]'), session = e.target.closest('[data-map-event]');
    if (floor) { mapFloor=floor.dataset.mapFloor;mapPlace='';$('#mapNotice').textContent='';renderFloor(); }
    if (place) { $('#mapNotice').textContent='';selectMapPlace(place.dataset.mapPlace,true); }
    if (session) openEvent(byId(session.dataset.mapEvent) || (mapFocusedEvent?.id === session.dataset.mapEvent ? mapFocusedEvent : null));
    const company = e.target.closest('[data-map-company]'), booth = e.target.closest('[data-booth-index]'), edit = e.target.closest('[data-map-edit]');
    if (company) showExhibitorOnMap(exhibitors[Number(company.dataset.mapCompany)]);
    if (booth) selectMapBooth(Number(booth.dataset.boothIndex));
    if (edit) openAssignment(byId(edit.dataset.mapEdit) || mapFocusedEvent);
    if (e.target.closest('[data-map-company-clear]')) { $('#mapCompanySearch').value='';renderMapCompanies();$('#mapCompanySearch').focus(); }
    if (e.target.closest('[data-map-exhibitor-clear]')) { mapExhibitor=null;renderMapExhibitor();$('#mapNotice').textContent=''; }
  });
  $('#mapZoomIn').onclick=()=>zoomMap(1.4);$('#mapZoomOut').onclick=()=>zoomMap(1/1.4);$('#mapFit').onclick=fitMap;
  $('#mapShowPins').addEventListener('change',()=>{$('#mapPins').hidden=!$('#mapShowPins').checked;if($('#mapBoothPins'))$('#mapBoothPins').hidden=!$('#mapShowPins').checked;});
  $('#mapViewport').addEventListener('keydown',e=>{if(e.target!==$('#mapViewport'))return;if(e.key==='+'||e.key==='='){e.preventDefault();zoomMap(1.4);}if(e.key==='-'){e.preventDefault();zoomMap(1/1.4);}if(e.key==='0'){e.preventDefault();fitMap();}});
  // Touch scrolling and native browser pinch zoom remain available.
  // Revealing the map triggers a resize after the focus frame. Do not reset a
  // requested booth/room focus (or a user's zoom) back to the full-page view.
  new ResizeObserver(()=>{if(plannerView==='map' && mapZoom===1)fitMap();}).observe($('#mapViewport'));
  renderFloor(); renderMapCompanies();
  fetch('data/booth-locations.json').then(response=>{if(!response.ok)throw new Error('Booth reference unavailable');return response.json();}).then(data=>{
    if (data.version !== 1 || !data.booths) throw new Error('Invalid booth reference');
    mapBoothData=data; renderMapExhibitor();
    if(mapExhibitor && plannerView==='map' && mapFloor==='ground'){
      const index=resolveExhibitorBooths(mapExhibitor,data).stands.findIndex(stand=>stand.point);
      if(index>=0){selectMapBooth(index);$('#mapNotice').textContent='Empresa selecionada: '+mapExhibitor.name+'. '+ROGE_BOOTH_REFERENCE_NOTE;}
    }
  }).catch(()=>{mapBoothError=true;renderMapExhibitor();});
}
