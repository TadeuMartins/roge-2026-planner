function filtered() {
  const q = norm($('#search').value), day = $('#dayFilter').value;
  const type = $('#typeFilter').value, priority = $('#priorityFilter').value;
  const loc = $('#locationFilter').value, onlyMine = $('#onlyMine').checked;
  const person = $('#personFilter').value, coverage = $('#coverageFilter').value;
  const list = enriched().filter(e => {
    const people = assignedNames(e.id), txt = textOf(e) + ' ' + norm(people.join(' '));
    if (person && !people.some(n => PlannerModel.key(n) === PlannerModel.key(person))) return false;
    if (coverage === 'assigned' && !people.length) return false;
    if (coverage === 'unassigned' && people.length) return false;
    if (coverage === 'conflicts' && !teamConflictIds.has(e.id)) return false;
    if (q && !txt.includes(q)) return false;
    if (day && e.date !== day) return false;
    if (type && e.type !== type) return false;
    if (priority && e._score.priority !== priority) return false;
    if (loc && e.location !== loc) return false;
    if (onlyMine && !favorites.has(e.id)) return false;
    if (chip && !chipTerms(chip).map(norm).some(t => txt.includes(t.trim()))) return false;
    if (radar === 'stakeholder' && e._score.stakeholder < 35) return false;
    if (radar === 'technology' && e._score.technology < 35) return false;
    if (radar === 'challenge' && e._score.challenge < 30) return false;
    if (radar === 'networking' && e._score.networking < 50) return false;
    return true;
  });
  const sort = $('#sort').value;
  list.sort((x, y) => sort === 'time' ? `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`)
    : sort === 'stakeholder' ? y._score.stakeholder - x._score.stakeholder
    : sort === 'technology' ? y._score.technology - x._score.technology
    : (y._score.total - x._score.total) || `${x.date}${x.start}`.localeCompare(`${y.date}${y.start}`));
  return list;
}

function decisionWindowText(score) {
  return (score.decisionWindows || []).map(w => `${w.start}–${w.end}`).join(', ');
}

function render() {
  const editorFocus = captureTeamEditorFocus();
  updateTeamSummary();
  renderActiveFilters();
  const list = filtered();
  $('#resultCount').textContent = `${list.length} evento${list.length === 1 ? '' : 's'}`;
  const focuses = { stakeholder: 'Empresas', technology: 'Tecnologia', challenge: 'Desafios da indústria', networking: 'Networking' };
  $('#resultHint').textContent = radar === 'all' ? 'Horários de Brasília' : `Interesse: ${focuses[radar] || radar}`;
  $('#events').innerHTML = list.length ? list.map(card).join('') : '<div class="empty-state"><h3>Nenhum evento encontrado</h3><p>Experimente outra busca ou limpe os filtros.</p></div>';
  renderKPIs();
  renderMine();
  renderExhibitors();
  bindDynamic();
  renderCalendar();
  renderMapSidebar();
  updateTeamControls();
  restoreTeamEditorFocus(editorFocus);
}

function renderActiveFilters() {
  const active = [];
  for (const id of ['search','dayFilter','typeFilter','priorityFilter','locationFilter','personFilter','coverageFilter']) {
    const control = $('#'+id);
    if (control.value) active.push([id, control.selectedOptions ? control.selectedOptions[0].textContent : control.value]);
  }
  if ($('#onlyMine').checked) active.push(['onlyMine','Favoritos']);
  if (radar !== 'all') active.push(['radar',$('[data-radar="'+radar+'"]').textContent]);
  if (chip) active.push(['chip',chip]);
  $('#filterCount').textContent = active.length;
  $('#filterCount').hidden = !active.length;
  $('#clearFilters').hidden = !active.length;
  $('#activeFilters').hidden = !active.length;
  $('#activeFilters').innerHTML = active.map(([id,label]) => '<button class="active-filter" data-clear-filter="'+id+'" aria-label="Remover filtro: '+escapeHtml(label)+'"><span>'+escapeHtml(label)+'</span> ×</button>').join('');
  $('#activeFilters').onclick = event => {
    const button = event.target.closest('[data-clear-filter]'); if (!button) return;
    const id = button.dataset.clearFilter;
    if (id === 'radar') { radar='all'; $$('.radar-card').forEach(b=>b.classList.toggle('active',b.dataset.radar==='all')); }
    else if (id === 'chip') { chip=''; $$('.chip').forEach(b=>b.classList.remove('active')); }
    else if (id === 'onlyMine') $('#onlyMine').checked=false;
    else $('#'+id).value='';
    render();
  };
}

function card(e) {
  const s = e._score, favorite = favorites.has(e.id);
  const speakers = (e.speakers || []).slice(0, 2).map(x => x.detail || x.name).join(' · ');
  return `<article class="event" data-id="${escapeHtml(e.id)}">
    <div class="event-time"><strong>${escapeHtml(e.start || 'A confirmar')}</strong><span>${escapeHtml(fmtDate(e.date))}</span>${e.end ? `<small>até ${escapeHtml(e.end)}</small>` : ''}</div>
    <div class="event-main">
      <div class="meta-row"><span class="event-type">${escapeHtml(e.type)}</span>${e.changed ? '<span class="tag changed">Atualizado</span>' : ''}</div>
      <h3>${escapeHtml(e.title)}</h3>
      <button type="button" class="event-map" aria-label="${escapeHtml('Ver no mapa: ' + (e.location || 'local a confirmar'))}">${escapeHtml(e.location || 'Local a confirmar')}<span aria-hidden="true"> →</span></button>
      ${speakers ? `<p class="event-speakers">${escapeHtml(speakers)}</p>` : ''}
      ${participantBadges(e.id)}
      <div class="event-footer">
        <div class="event-actions"><button type="button" class="mini-btn assign">Equipe</button><button type="button" class="mini-btn details">Detalhes</button><button type="button" class="mini-btn star ${favorite ? 'active' : ''}" aria-pressed="${favorite}" aria-label="${escapeHtml((favorite ? 'Remover dos favoritos: ' : 'Adicionar aos favoritos: ') + e.title)}"><span aria-hidden="true">${favorite ? '★' : '☆'}</span></button></div>
        <small class="event-relevance" title="${escapeHtml(s.isTopWindow ? 'Maior relevância entre eventos simultâneos em ' + decisionWindowText(s) : 'Pontuação calculada com suas preferências de radar')}">${s.isTopWindow ? 'Destaque no horário · ' : ''}Relevância ${escapeHtml(s.total)}</small>
      </div>
    </div>
  </article>`;
}

function bindDynamic() {
  $$('#events .event').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('.assign').onclick = () => openInlineTeam(byId(id));
    el.querySelector('.star').onclick = () => toggleFav(id);
    el.querySelector('.details').onclick = () => openEvent(byId(id));
    el.querySelector('.event-map').onclick = () => showEventOnMap(byId(id));
    // Mount after card replacement so team.js can restore an existing draft.
    mountTeamEditor(el);
  });
}

function renderKPIs() {
  if ($('#kpis').hidden) return;
  const all = enriched();
  $('#kpis').innerHTML = [[all.length, 'eventos'], [all.filter(e => e._score.isTopWindow).length, 'destaques']]
    .map(([n, label]) => `<span class="kpi"><b>${escapeHtml(n)}</b> ${escapeHtml(label)}</span>`).join('');
}

function renderMine() {
  const mine = [...favorites].map(byId).filter(Boolean).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  $('#mineCount').textContent = mine.length;
  $('#mineList').innerHTML = mine.length ? mine.map(e => `<div class="mine-item"><small>${escapeHtml(fmtDate(e.date))} · ${escapeHtml(e.start)}</small><b>${escapeHtml(e.title)}</b><span>${escapeHtml(e.location || '')}</span></div>`).join('') : '<p class="muted">Use a estrela nos eventos para guardar seus favoritos.</p>';
  const conflicts = findConflicts(mine);
  $('#conflictAlert').innerHTML = conflicts.length ? `<p class="conflict">${conflicts.length} conflito${conflicts.length > 1 ? 's' : ''} de horário nos favoritos.</p>` : '';
  $('#downloadMine').disabled = $('#calendarBtn').disabled = !mine.length;
}

function findConflicts(list) {
  const conflicts = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.date !== b.date || !a.start || !a.end || !b.start || !b.end) continue;
    if (a.start < b.end && b.start < a.end) conflicts.push([a, b]);
  }
  return conflicts;
}

function renderExhibitors() {
  const q = norm($('#exhibitorSearch').value), priorityNames = prefs.stakeholders.map(norm);
  const list = exhibitors.map((exhibitor, index) => ({ exhibitor, index }))
    .filter(({ exhibitor }) => !q || norm(exhibitor.name).includes(q));
  list.sort((a, b) => Number(priorityNames.some(p => norm(b.exhibitor.name).includes(p))) - Number(priorityNames.some(p => norm(a.exhibitor.name).includes(p))));
  $('#exhibitors').innerHTML = list.slice(0, 30).map(({ exhibitor: x, index }) => `<div class="exhibitor"><b>${escapeHtml(x.name)}</b><span>${escapeHtml([x.pavilion && `Pavilhão ${x.pavilion}`, x.stand && `Estande ${x.stand}`].filter(Boolean).join(' · ') || 'Local a confirmar')}</span><button type="button" class="text-btn" data-exhibitor-index="${index}" aria-label="${escapeHtml('Ver expositor no mapa: ' + x.name)}">Ver no mapa</button></div>`).join('') || '<p class="muted">Nenhum expositor encontrado.</p>';
  $$('#exhibitors [data-exhibitor-index]').forEach(button => {
    button.onclick = () => showExhibitorOnMap(exhibitors[Number(button.dataset.exhibitorIndex)]);
  });
}

function openEvent(e) {
  if (!e) return;
  let sourceLink = '';
  try {
    const url = new URL(e.source_url);
    if (url.protocol === 'https:' && !url.username && !url.password) sourceLink = `<a class="ghost-btn" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">Fonte oficial</a>`;
  } catch { /* Missing or invalid source URLs are not rendered as links. */ }
  const s = scoreById(e.id);
  const speakers = (e.speakers || []).map(x => `<div class="speaker">${escapeHtml(x.detail || x.name)}</div>`).join('') || '<p class="muted">Sem palestrantes informados na fonte oficial.</p>';
  const scoreItems = [[s.stakeholder, 'Empresa'], [s.seniority, 'Cargo'], [s.room, 'Sala / palco'], [s.technology, 'Tecnologia'], [s.challenge, 'Desafio']];
  const hits = [...s.stakeholderHits, ...s.roleHits, ...s.techHits, ...s.challengeHits];
  $('#modalContent').innerHTML = `<div class="modal-head"><div><span class="section-kicker">${escapeHtml(e.type)}</span><h2 id="eventModalTitle">${escapeHtml(e.title)}</h2></div><button type="button" class="icon-btn" id="modalClose" aria-label="Fechar detalhes">×</button></div>
    <p class="modal-date">${escapeHtml(fmtDate(e.date))} · ${escapeHtml(e.start || 'Horário a confirmar')}${e.end ? '–' + escapeHtml(e.end) : ''}</p>
    <button type="button" class="event-map" id="modalMap">${escapeHtml(e.location || 'Local a confirmar')}<span aria-hidden="true"> →</span><span class="sr-only"> Ver no mapa</span></button>
    <section class="modal-section"><h3>Equipe neste evento</h3>${participantBadges(e.id)}<button type="button" class="ghost-btn" id="modalAssign">Editar participantes</button></section>
    <section class="modal-section"><h3>Palestrantes e empresas</h3><div class="speaker-list">${speakers}</div></section>
    <details class="modal-relevance"><summary>Sobre a relevância · ${escapeHtml(s.total)}</summary>
      ${s.isTopWindow ? `<p class="muted">Maior pontuação entre os eventos simultâneos em ${escapeHtml(decisionWindowText(s))}, de acordo com suas preferências.</p>` : ''}
      <div class="score-grid">${scoreItems.map(([value, label]) => `<div class="score-item"><b>${escapeHtml(value)}</b><span>${label}</span></div>`).join('')}</div>
      <div class="meta-row">${hits.map(hit => `<span class="tag">${escapeHtml(hit)}</span>`).join('')}</div>
    </details>
    <div class="modal-actions"><button type="button" class="primary-btn" id="modalICS">Exportar para Outlook</button>${sourceLink}</div>`;
  $('#modalClose').onclick = () => $('#eventModal').close();
  $('#modalICS').onclick = () => downloadICS([e], 'ROGe-2026-evento.ics');
  $('#modalMap').onclick = () => showEventOnMap(e);
  $('#modalAssign').onclick = () => { $('#eventModal').close(); openAssignment(e); };
  $('#eventModal').showModal();
}
