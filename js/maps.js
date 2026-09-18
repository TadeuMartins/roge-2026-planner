let mapFloor = ROGE_MAP_FLOORS[0].id, mapPlace = '', mapZoom = 1, mapBaseWidth = 500, mapReady = false;
function currentFloor() { return ROGE_MAP_FLOORS.find(f => f.id === mapFloor); }
function mapEvents(place, list = events) { return list.filter(e => resolveMapPlace(e.location)?.id === place.id); }
function mapSession(event) {
  return '<button class="map-session" data-map-event="' + escapeHtml(event.id) + '"><small>' + escapeHtml(fmtDate(event.date) + ' · ' + event.start + '–' + event.end) + '</small><b>' + escapeHtml(event.title) + '</b><small>' + escapeHtml(event.location) + '</small><span>' + escapeHtml(assignedNames(event.id).join(' · ') || 'Equipe ainda não definida') + '</span>' + (teamConflictIds.has(event.id) ? '<em class="participant-conflict">Conflito de horário na equipe</em>' : '') + '</button>';
}
function renderMapSidebar() {
  if (!mapReady || plannerView !== 'map') return;
  const q = norm($('#mapSearch').value).trim();
  const scoped = filtered().filter(e => !q || norm([e.title,e.location,resolveMapPlace(e.location)?.name || '',...assignedNames(e.id)].join(' ')).includes(q));
  const places = ROGE_MAP_PLACES.filter(p => p.floor === mapFloor && (!q || norm(p.name).includes(q) || mapEvents(p,scoped).length));
  if (!places.some(p => p.id === mapPlace)) mapPlace = '';
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
    $('#mapPlaceNote').textContent = selected.area ? 'Marcador da área ou pavilhão. Confirme a sala ou o estande exato na sinalização do evento.' : '';
    $('#mapPlaceCount').textContent = list.length ? list.length + ' eventos · horários de Brasília' : mapEvents(selected).length ? 'Nenhum evento corresponde aos filtros atuais' : 'Local de apoio · sem eventos associados';
    $('#mapSchedule').innerHTML = list.map(mapSession).join('');
  }
  $$('.map-pin').forEach(pin => {
    pin.classList.toggle('selected', pin.dataset.mapPlace === mapPlace);
    pin.setAttribute('aria-pressed', String(pin.dataset.mapPlace === mapPlace));
    pin.hidden = !!q && !places.some(p => p.id === pin.dataset.mapPlace);
  });
}
function renderFloor() {
  const floor = currentFloor();
  $('#mapImage').src = floor.image; $('#mapImage').alt = 'Planta do evento · ' + floor.name;
  $('#mapOriginal').href = floor.document || floor.image;
  $('#mapFloorTitle').textContent = floor.name;
  $('#mapSource').textContent = floor.source + ' · Marcadores aproximados; confira a sinalização no local.';
  $('#mapFloorButtons').innerHTML = ROGE_MAP_FLOORS.map(f => '<button class="floor-button ' + (f.id === mapFloor ? 'active' : '') + '" data-map-floor="' + f.id + '" aria-pressed="' + (f.id === mapFloor) + '">' + escapeHtml(f.name) + '</button>').join('');
  $('#mapPins').innerHTML = ROGE_MAP_PLACES.filter(p => p.floor === mapFloor).map(p => '<button class="map-pin" data-map-place="' + p.id + '" style="left:' + p.x + '%;top:' + p.y + '%" title="' + escapeHtml(p.name) + '" aria-label="' + escapeHtml(p.name) + '" aria-pressed="false">' + escapeHtml(p.label) + '</button>').join('');
  renderMapSidebar(); requestAnimationFrame(fitMap);
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
  if (mapFloor !== place.floor) { mapFloor = place.floor; renderFloor(); }
  renderMapSidebar();
  if (focus) requestAnimationFrame(() => {
    const pin = $('#mapPins [data-map-place="' + id + '"]'), viewport = $('#mapViewport');
    if (pin) {
      const plane = $('#mapPlane');
      viewport.scrollTo({left:plane.offsetLeft + plane.clientWidth*place.x/100-viewport.clientWidth/2,top:plane.offsetTop+plane.clientHeight*place.y/100-viewport.clientHeight/2,behavior:'smooth'});
    }
  });
}
function showEventOnMap(event) {
  const place = resolveMapPlace(event.location);
  $('#eventModal').close(); setPlannerView('map');
  $('#mapSearch').value = ''; setPlannerDay(event.date);
  $('#mapNotice').textContent = place ? (place.area ? 'Referência de área: ' : 'Local do evento: ') + place.name + (place.area ? '. A sala ou o estande exato deve ser confirmado na sinalização local.' : '') : 'Não há marcador confirmado para “' + event.location + '”. Consulte a planta e a sinalização do evento.';
  if (place) selectMapPlace(place.id,true); else { mapPlace='';renderMapSidebar(); }
  $('#mapView').scrollIntoView({behavior:'smooth',block:'start'});
}
function wireMaps() {
  mapReady = true;
  $('#mapDay').innerHTML = '<option value="">Todos os dias</option>' + uniq(events.map(e=>e.date)).sort().map(d=>'<option value="'+escapeHtml(d)+'">'+escapeHtml(fmtDate(d))+'</option>').join('');
  $('#mapSearch').addEventListener('input',renderMapSidebar); $('#mapDay').addEventListener('change',e=>setPlannerDay(e.target.value));
  $('#mapView').addEventListener('click',e=>{
    const floor = e.target.closest('[data-map-floor]'), place = e.target.closest('[data-map-place]'), session = e.target.closest('[data-map-event]');
    if (floor) { mapFloor=floor.dataset.mapFloor;mapPlace='';$('#mapNotice').textContent='';renderFloor(); }
    if (place) { $('#mapNotice').textContent='';selectMapPlace(place.dataset.mapPlace,true); }
    if (session) openEvent(byId(session.dataset.mapEvent));
  });
  $('#mapZoomIn').onclick=()=>zoomMap(1.4);$('#mapZoomOut').onclick=()=>zoomMap(1/1.4);$('#mapFit').onclick=fitMap;
  $('#mapShowPins').addEventListener('change',()=>{$('#mapPins').hidden=!$('#mapShowPins').checked;});
  $('#mapViewport').addEventListener('keydown',e=>{if(e.target!==$('#mapViewport'))return;if(e.key==='+'||e.key==='='){e.preventDefault();zoomMap(1.4);}if(e.key==='-'){e.preventDefault();zoomMap(1/1.4);}if(e.key==='0'){e.preventDefault();fitMap();}});
  // Touch scrolling and native browser pinch zoom remain available.
  new ResizeObserver(()=>{if(plannerView==='map')fitMap();}).observe($('#mapViewport'));
  renderFloor();
}
