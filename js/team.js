let teamData = { version: 1, assignments: {} };
let teamStore, teamLoaded = false, teamBusy = false, teamRefreshing = false, teamLastRead = 0;
let teamConflictIds = new Set();
let teamRevision = 0;
let plannerView = 'list', assignmentDraft = null;
let teamCacheKey = '';
const teamDrafts = new Map(), teamCardMessages = new Map();
function assignedNames(id) { return teamData.assignments[id]?.names || []; }
function participantBadges(id) {
  const people = assignedNames(id);
  return '<div class="participant-badges">' + (people.length ? people.map(n => '<span class="participant-badge">' + escapeHtml(n) + '</span>').join('') : '<span class="muted">Equipe ainda não definida</span>') + (teamConflictIds.has(id) ? '<span class="participant-conflict">⚠ Conflito de horário</span>' : '') + '</div>';
}
function teamStatus(message, error = false) {
  $('#teamSync').textContent = message;
  $('#teamSync').classList.toggle('sync-error', error);
}
function cacheTeam() {
  if (!teamCacheKey) return;
  try { localStorage.setItem(teamCacheKey, JSON.stringify({ savedAt: new Date().toISOString(), data: teamData })); } catch { /* Shared save remains successful even without local storage. */ }
}
function refreshTeamUI() {
  const selected = $('#personFilter').value;
  const people = [...new Map(Object.values(teamData.assignments).flatMap(r => r.names).map(n => [PlannerModel.key(n), n])).values()].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  // More than 30 people in the whole team is valid (limit applies per event only).
  $('#personFilter').innerHTML = '<option value="">Toda a equipe Siemens</option>' + people.map(n => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
  $('#personFilter').value = people.find(n => PlannerModel.key(n) === PlannerModel.key(selected)) || '';
  const schedulePerson = $('#schedulePerson'), scheduleKey = PlannerModel.key(schedulePerson.value);
  const schedulePeople = new Map(people.map(n => [PlannerModel.key(n), n]));
  // A removed participant stays selected rather than silently showing the whole team.
  if (scheduleKey && !schedulePeople.has(scheduleKey)) schedulePeople.set(scheduleKey, schedulePerson.selectedOptions[0]?.textContent || schedulePerson.value);
  schedulePerson.innerHTML = '<option value="">Toda a equipe Siemens</option>' + [...schedulePeople].map(([key, name]) => '<option value="' + escapeHtml(key) + '">' + escapeHtml(name) + '</option>').join('');
  schedulePerson.value = scheduleKey;
  render();
}
async function refreshTeam(force = false) {
  if (!teamStore?.configured || teamBusy || teamRefreshing || (!force && Date.now() - teamLastRead < 60000)) return false;
  const revision = teamRevision;
  teamRefreshing = true; teamLastRead = Date.now(); updateTeamControls();
  teamStatus('Atualizando escala compartilhada…');
  try {
    const result = await teamStore.read();
    if (revision !== teamRevision) return false;
    teamData = result.data; teamLoaded = true; teamLastRead = Date.now(); cacheTeam();
    teamStatus('Escala atualizada às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    refreshTeamUI();
    return true;
  } catch (error) {
    teamStatus(error.message + ' Sem sincronização; exibindo somente a última leitura disponível, se houver. Nenhuma alteração foi salva.', true);
    return false;
  } finally { teamRefreshing = false; updateTeamControls(); }
}
function setPlannerView(view) {
  plannerView = view;
  document.body.dataset.view = view;
  $$('.view-tab').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
  $('#listView').hidden = view !== 'list'; $('#calendarView').hidden = view !== 'calendar'; $('#mapView').hidden = view !== 'map';
  if (view === 'map' && mapReady) { renderMapSidebar(); requestAnimationFrame(fitMap); }
  if (view === 'calendar') renderCalendar();
}
function setPlannerDay(value) {
  $('#dayFilter').value = value;
  render();
}
function teamScheduleConflicts(person = $('#schedulePerson').value) {
  const key = PlannerModel.key(person);
  const planned = [...new Map(events.filter(e => assignedNames(e.id).length).map(e => [e.id, e])).values()];
  return PlannerModel.conflicts(planned, teamData.assignments).map(c => ({ ...c, names: c.names.filter(n => !key || PlannerModel.key(n) === key) })).filter(c => c.names.length);
}
function teamVisibleEvents() {
  const person = PlannerModel.key($('#schedulePerson').value);
  const day = $('#scheduleDay').value || ($('#calendarMode').value === 'day' ? $('#calendarDay').value : '');
  const conflictIds = $('#scheduleConflicts').checked ? new Set(teamScheduleConflicts(person).flatMap(c => [c.a.id, c.b.id])) : null;
  return [...new Map(events.filter(e => {
    const people = assignedNames(e.id);
    return people.length && (!person || people.some(n => PlannerModel.key(n) === person)) && (!day || e.date === day) && (!conflictIds || conflictIds.has(e.id));
  }).map(e => [e.id, e])).values()].sort((a,b) => a.date.localeCompare(b.date) ||
    (Number.isFinite(PlannerModel.minutes(a.start)) ? PlannerModel.minutes(a.start) : Infinity) - (Number.isFinite(PlannerModel.minutes(b.start)) ? PlannerModel.minutes(b.start) : Infinity) ||
    a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id));
}
function renderCalendar() {
  if (!$('#calendarGrid')) return;
  const days = uniq(events.map(e => e.date)).sort();
  const mode = $('#calendarMode').value || 'summary';
  const selectedDay = $('#scheduleDay').value;
  const currentDay = selectedDay || $('#calendarDay').value || days[0] || '';
  if (mode === 'day') $('#calendarDay').value = currentDay;
  const shownDays = mode === 'day' || selectedDay ? (currentDay ? [currentDay] : []) : days;
  $('#calendarDay').disabled = mode !== 'day';
  const visible = teamVisibleEvents();
  $('#calendarCount').textContent = visible.length + ' eventos nesta visão';
  $('#exportTeam').disabled = visible.length === 0;
  $('#calendarEmpty').hidden = visible.length !== 0;
  $('#calendarEmpty').textContent = events.some(e => assignedNames(e.id).length) ? 'Nenhum evento atribuído corresponde aos filtros desta agenda.' : 'Nenhum evento tem participantes atribuídos. Defina a equipe nos eventos para montar a agenda.';
  const conflicts = teamScheduleConflicts();
  const conflictIds = new Set(conflicts.flatMap(c => [c.a.id, c.b.id]));
  const visibleIds = new Set(visible.map(e => e.id));
  const relevant = conflicts.filter(c => visibleIds.has(c.a.id) || visibleIds.has(c.b.id));
  $('#teamConflicts').innerHTML = relevant.length ? '<details><summary>⚠ ' + relevant.length + ' conflitos de participantes — revisar revezamento</summary>' + relevant.map(c => '<p><b>' + escapeHtml(c.names.join(', ')) + '</b> · ' + escapeHtml(fmtDate(c.a.date)) + '<br>' + escapeHtml(c.a.start + ' ' + c.a.title) + ' ↔ ' + escapeHtml(c.b.start + ' ' + c.b.title) + '</p>').join('') + '</details>' : '';
  const missing = Object.entries(teamData.assignments).filter(([id]) => !byId(id));
  $('#teamOrphans').innerHTML = missing.length ? '<details><summary>' + missing.length + ' eventos da escala não estão mais na programação atual</summary><p>Os nomes foram preservados. Confira mudanças na fonte oficial antes de redistribuir a equipe.</p>' + missing.map(([,r]) => '<p>' + escapeHtml((r.event?.date || '') + ' · ' + (r.event?.title || 'Evento anterior') + ' — ' + r.names.join(', ')) + '</p>').join('') + '</details>' : '';
  $('#teamAgenda').hidden = mode !== 'summary';
  $('#calendarGrid').hidden = mode === 'summary';
  $('#calendarUntimed').hidden = mode === 'summary';
  $('#teamAgenda').innerHTML = '';
  if (mode === 'summary') {
    const selectedPerson = PlannerModel.key($('#schedulePerson').value);
    const people = [...new Map(visible.flatMap(e => assignedNames(e.id)).map(n => [PlannerModel.key(n), n]))].filter(([key]) => !selectedPerson || key === selectedPerson).sort((a,b) => a[1].localeCompare(b[1], 'pt-BR'));
    $('#teamAgenda').innerHTML = people.map(([key, name]) => {
      const personalConflicts = new Set(conflicts.filter(c => c.names.some(n => PlannerModel.key(n) === key)).flatMap(c => [c.a.id, c.b.id]));
      const personal = visible.filter(e => assignedNames(e.id).some(n => PlannerModel.key(n) === key) && (!$('#scheduleConflicts').checked || personalConflicts.has(e.id)));
      if (!personal.length) return '';
      return '<section class="agenda-person"><h3>' + escapeHtml(name) + '</h3>' + uniq(personal.map(e => e.date)).map(date => '<section class="agenda-day"><h4>' + escapeHtml(fmtDate(date)) + '</h4>' + personal.filter(e => e.date === date).map(e => {
        const time = PlannerModel.timed(e) ? e.start + '–' + e.end : (Number.isFinite(PlannerModel.minutes(e.start)) ? e.start + ' · Término a confirmar' : 'Horário a confirmar');
        return '<div class="agenda-row' + (personalConflicts.has(e.id) ? ' has-conflict' : '') + '"><strong class="agenda-time">' + escapeHtml(time) + '</strong><strong class="agenda-place">' + escapeHtml(e.location || 'Local a confirmar') + '</strong><span class="agenda-title">' + escapeHtml(e.title) + '</span>' + (personalConflicts.has(e.id) ? '<span class="participant-conflict">⚠ Conflito de horário</span>' : '') + '<div class="agenda-actions"><button type="button" class="ghost-btn" data-agenda-event="' + escapeHtml(e.id) + '" aria-label="Detalhes: ' + escapeHtml(e.title) + '">Detalhes</button><button type="button" class="ghost-btn" data-agenda-map="' + escapeHtml(e.id) + '" aria-label="Mapa: ' + escapeHtml(e.title) + '">Mapa</button><button type="button" class="ghost-btn" data-agenda-edit="' + escapeHtml(e.id) + '" aria-label="Equipe: ' + escapeHtml(e.title) + '">Equipe</button></div></div>';
      }).join('') + '</section>').join('') + '</section>';
    }).join('');
    $('#calendarGrid').innerHTML = ''; $('#calendarUntimed').innerHTML = '';
    return;
  }
  const timed = visible.filter(PlannerModel.timed), untimed = visible.filter(e => !PlannerModel.timed(e));
  const earliest = Math.floor(Math.min(9 * 60, ...timed.map(e => PlannerModel.minutes(e.start))) / 60) * 60;
  const latest = Math.ceil(Math.max(19 * 60, ...timed.map(e => PlannerModel.minutes(e.end))) / 60) * 60;
  const pixels = 2, height = (latest - earliest) * pixels;
  const ticks = [];
  for (let t = earliest; t < latest; t += 60) ticks.push('<span style="top:' + ((t-earliest)*pixels) + 'px">' + minutesToTime(t) + '</span>');
  const widths = [];
  const columns = shownDays.map(date => {
    const daily = timed.filter(e => e.date === date);
    const layout = PlannerModel.layout(daily);
    widths.push('minmax(' + Math.max(270, Math.max(1, ...layout.map(item => item.lanes)) * 164) + 'px, 1fr)');
    return '<div class="calendar-column"><div class="calendar-day-head"><b>' + escapeHtml(fmtDate(date)) + '</b><small>' + daily.length + ' eventos</small></div><div class="calendar-day-body" style="height:' + height + 'px">' +
      layout.map(item => {
        const e = item.event, people = assignedNames(e.id);
        const label = e.start + '–' + e.end + ' · ' + e.title + ' · ' + (e.location || '') + ' · ' + (people.join(', ') || 'Sem participantes');
        return '<button class="calendar-event ' + (conflictIds.has(e.id) ? 'has-conflict' : '') + '" data-event-id="' + escapeHtml(e.id) + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '" style="top:' + ((item.start-earliest)*pixels) + 'px;height:' + Math.max(22,(item.end-item.start)*pixels-3) + 'px;left:calc(' + (item.lane/item.lanes*100) + '% + 2px);width:calc(' + (100/item.lanes) + '% - 4px)"><strong>' + e.start + '–' + e.end + '</strong><b>' + escapeHtml(e.title) + '</b><small>' + escapeHtml(e.location) + '</small><span>' + escapeHtml(people.join(' · ') || 'Sem participantes') + '</span>' + (conflictIds.has(e.id) ? '<em>⚠ Conflito na equipe</em>' : '') + '</button>';
      }).join('') + '</div></div>';
  }).join('');
  $('#calendarGrid').innerHTML = '<div class="calendar-time"><div class="calendar-day-head">BRT</div><div class="calendar-ticks" style="height:' + height + 'px">' + ticks.join('') + '</div></div>' + columns;
  $('#calendarGrid').style.setProperty('--days', shownDays.length);
  $('#calendarGrid').style.gridTemplateColumns = 'var(--time-column, 58px) ' + widths.join(' ');
  $('#calendarUntimed').innerHTML = untimed.length ? '<h3>Horário a confirmar</h3>' + untimed.map(e => '<button class="ghost-btn" data-event-id="' + escapeHtml(e.id) + '">' + escapeHtml(fmtDate(e.date) + ' · ' + e.title) + '</button>').join('') : '';
}
function teamEditMessage(draft) {
  if (!teamStore?.configured) return 'Edição indisponível: configure a URL e a chave pública do Supabase em js/team-config.js e publique o serviço de participantes.';
  if (draft?.message) return draft.message;
  if (!teamLoaded) return 'Somente leitura: aguarde uma leitura válida do serviço. Use Recarregar participantes para tentar novamente.';
  if (draft && !draft.ready) return 'Recarregue os participantes para iniciar a edição com os dados atuais.';
  return 'Edição pública, sem login. Ao salvar, os nomes ficam visíveis para todos. Não inclua dados confidenciais.';
}
function draftConflictText(draft) {
  let people;
  try { people = PlannerModel.names(draft.value.split(/[,;\n]/)); } catch (error) { return error.message; }
  const records = { ...teamData.assignments, [draft.event.id]: { names: people } };
  const conflicts = PlannerModel.conflicts(events, records).filter(c => c.a.id === draft.event.id || c.b.id === draft.event.id);
  return conflicts.map(c => {
    const other = c.a.id === draft.event.id ? c.b : c.a;
    return '⚠ ' + c.names.join(', ') + ' também em ' + other.start + '–' + other.end + ': ' + other.title;
  }).join('\n');
}
function getTeamDraft(event) {
  if (!teamDrafts.has(event.id)) teamDrafts.set(event.id, { event, expected: [...assignedNames(event.id)], value: assignedNames(event.id).join('\n'), ready: teamLoaded, inline: false, message: '' });
  return teamDrafts.get(event.id);
}
function captureTeamEditorFocus() {
  const active = document.activeElement, card = active?.closest('#events .event');
  if (!card) return null;
  // Input events own draft values; a reload may already have replaced the model.
  return { id: card.dataset.id, control: active.classList.contains('team-participant-input') ? '.team-participant-input' : active.matches('button') ? '.' + [...active.classList].join('.') : null, start: active.selectionStart, end: active.selectionEnd, scroll: active.scrollTop };
}
function restoreTeamEditorFocus(focus) {
  if (!focus?.control) return;
  const card = $$('#events .event').find(el => el.dataset.id === focus.id);
  const target = card?.querySelector(focus.control);
  if (!target || target.disabled) return;
  target.focus({ preventScroll: true });
  if (typeof focus.start === 'number' && target.setSelectionRange) { target.setSelectionRange(focus.start, focus.end); target.scrollTop = focus.scroll; }
}
function mountTeamEditor(card) {
  const id = card.dataset.id, draft = teamDrafts.get(id), button = card.querySelector('.assign');
  const editorId = 'team-editor-' + id;
  button.setAttribute('aria-expanded', String(!!draft?.inline));
  button.setAttribute('aria-controls', editorId);
  button.setAttribute('aria-label', 'Equipe: ' + byId(id).title);
  const container = document.createElement('div');
  container.className = 'team-card-editor'; container.id = editorId;
  if (draft?.inline) {
    container.innerHTML = '<form class="team-inline-form" aria-label="Participantes do evento"><label for="team-names-' + escapeHtml(id) + '">Quem vai estar neste evento?</label><textarea class="team-participant-input" id="team-names-' + escapeHtml(id) + '" rows="3" aria-describedby="team-help-' + escapeHtml(id) + ' team-message-' + escapeHtml(id) + '"></textarea><p class="team-editor-help" id="team-help-' + escapeHtml(id) + '">Um nome por linha ou separado por vírgula. Use o mesmo nome nos eventos. Deixe vazio para remover todos.</p><div class="team-draft-conflicts team-conflicts" aria-live="polite"></div><p class="team-editor-status" id="team-message-' + escapeHtml(id) + '" role="status"></p><div class="team-editor-actions"><button type="submit" class="primary-btn team-save">Salvar para todos</button><button type="button" class="ghost-btn team-cancel">Cancelar</button><button type="button" class="ghost-btn team-reload">Recarregar participantes</button></div></form>';
    const input = container.querySelector('textarea'); input.value = draft.value;
    input.oninput = () => { draft.value = input.value; draft.message = ''; updateTeamControls(); };
    container.querySelector('form').onsubmit = e => { e.preventDefault(); saveTeamDraft(draft); };
    container.querySelector('.team-cancel').onclick = () => cancelTeamDraft(id);
    container.querySelector('.team-reload').onclick = () => reloadTeamDraft(draft);
  } else if (teamCardMessages.has(id)) {
    container.innerHTML = '<p class="team-editor-status" role="status"></p>';
    container.firstChild.textContent = teamCardMessages.get(id);
  } else container.hidden = true;
  card.querySelector('.event-main').append(container);
}
function openInlineTeam(event) {
  const draft = getTeamDraft(event); draft.inline = true; teamCardMessages.delete(event.id);
  render();
  const card = $$('#events .event').find(el => el.dataset.id === event.id);
  card?.querySelector('textarea')?.focus({ preventScroll: true });
}
function updateTeamControls() {
  const unavailable = !teamStore?.configured || !teamLoaded;
  $('#refreshTeam').disabled = !teamStore?.configured || teamBusy || teamRefreshing;
  $$('#events .event').forEach(card => {
    const draft = teamDrafts.get(card.dataset.id), form = card.querySelector('.team-inline-form');
    if (!form || !draft) return;
    form.querySelector('textarea').readOnly = unavailable || !draft.ready || teamBusy || !!draft.reloading;
    form.querySelector('.team-save').disabled = unavailable || !draft.ready || teamBusy || teamRefreshing;
    form.querySelector('.team-cancel').disabled = teamBusy || !!draft.reloading;
    form.querySelector('.team-reload').disabled = !teamStore?.configured || teamBusy || teamRefreshing;
    form.querySelector('.team-editor-status').textContent = teamEditMessage(draft);
    form.querySelector('.team-draft-conflicts').textContent = draftConflictText(draft);
    form.setAttribute('aria-busy', String(teamBusy || !!draft.reloading));
  });
  if (assignmentDraft) {
    $('#participantInput').readOnly = unavailable || !assignmentDraft.ready || teamBusy || !!assignmentDraft.reloading;
    $('#saveParticipants').disabled = unavailable || !assignmentDraft.ready || teamBusy || teamRefreshing;
    $('#reloadAssignment').disabled = !teamStore?.configured || teamBusy || teamRefreshing;
    $('#assignmentMessage').textContent = teamEditMessage(assignmentDraft);
    $('#assignmentConflicts').textContent = draftConflictText(assignmentDraft);
  }
}
function cancelTeamDraft(id) {
  const draft = teamDrafts.get(id);
  if (teamBusy || draft?.reloading) return;
  teamDrafts.delete(id); teamCardMessages.delete(id);
  if (assignmentDraft?.event.id === id) { assignmentDraft = null; $('#assignmentModal').close(); }
  render();
  $$('#events .event').find(el => el.dataset.id === id)?.querySelector('.assign')?.focus({ preventScroll: true });
}
async function reloadTeamDraft(draft) {
  if (!teamStore?.configured || teamBusy || teamRefreshing || draft.reloading) return;
  draft.reloading = true; draft.message = 'Recarregando participantes...';
  const loaded = await refreshTeam(true);
  draft.reloading = false;
  if (loaded) {
    draft.expected = [...assignedNames(draft.event.id)]; draft.value = draft.expected.join('\n'); draft.ready = true;
    draft.message = 'Participantes recarregados. Revise os nomes antes de salvar.';
  } else draft.message = 'Não foi possível recarregar. Seu rascunho foi preservado. Tente Recarregar participantes novamente.';
  if (assignmentDraft === draft) $('#participantInput').value = draft.value;
  render();
}
async function saveTeamDraft(draft) {
  if (teamDrafts.get(draft.event.id) !== draft || !teamStore?.configured || !teamLoaded || !draft.ready || teamBusy || teamRefreshing || draft.reloading) return;
  teamRevision++; teamBusy = true; draft.message = 'Salvando para todos...'; updateTeamControls();
  try {
    teamData = await teamStore.save(draft.event, draft.value.split(/[,;\n]/), draft.expected);
    teamLoaded = true; cacheTeam(); teamLastRead = Date.now();
    teamDrafts.delete(draft.event.id);
    teamCardMessages.set(draft.event.id, 'Participantes salvos para todos.');
    if (assignmentDraft === draft) { assignmentDraft = null; $('#assignmentModal').close(); }
    teamStatus('Escala salva no serviço compartilhado. Disponível para todos.');
    const returnFocus = document.activeElement === document.body || document.activeElement?.closest('.event')?.dataset.id === draft.event.id;
    refreshTeamUI();
    if (returnFocus) $$('#events .event').find(el => el.dataset.id === draft.event.id)?.querySelector('.assign')?.focus({ preventScroll: true });
  } catch (error) {
    draft.message = error.message + ' Salvamento não confirmado. Seu rascunho foi preservado. Use Recarregar participantes e revise os nomes antes de tentar novamente.';
    teamStatus('Não foi possível confirmar o salvamento. Revise a mensagem no editor.', true);
  } finally { teamBusy = false; updateTeamControls(); }
}
function openAssignment(event) {
  if (!event) return;
  assignmentDraft = getTeamDraft(event);
  $('#assignmentTitle').textContent = event.title;
  $('#assignmentTime').textContent = fmtDate(event.date) + ' · ' + event.start + '–' + event.end + ' · ' + event.location;
  $('#participantInput').value = assignmentDraft.value;
  updateTeamControls();
  $('#assignmentModal').showModal();
  $('#participantInput').focus();
}
function wireTeam() {
  teamStore = new TeamStore(ROGE_TEAM_CONFIG);
  teamCacheKey = teamStore.configured ? 'roge_team_supabase_v1:' + teamStore.config.url.trim().replace(/\/+$/, '') : '';
  try { const cache = teamCacheKey && JSON.parse(localStorage.getItem(teamCacheKey)); if (cache?.data) { teamData = teamStore.validate(cache.data); teamStatus('Última cópia local, ainda não sincronizada. Verificando o serviço...'); } } catch { /* Bad cache cannot prevent startup. */ }
  if (!teamStore.configured) teamStatus(teamEditMessage(), true);
  const days = uniq(events.map(e => e.date)).sort();
  $('#calendarDay').innerHTML = days.map(d => '<option value="' + escapeHtml(d) + '">' + escapeHtml(fmtDate(d)) + '</option>').join('');
  $('#scheduleDay').innerHTML = '<option value="">Todos os dias</option>' + days.map(d => '<option value="' + escapeHtml(d) + '">' + escapeHtml(fmtDate(d)) + '</option>').join('');
  $('#calendarMode').value = 'summary';
  document.body.dataset.view = plannerView;
  $$('.view-tab').forEach(button => button.onclick = () => setPlannerView(button.dataset.view));
  $('#calendarMode').addEventListener('change', () => {
    if ($('#calendarMode').value === 'week') $('#scheduleDay').value = '';
    if ($('#calendarMode').value === 'day') {
      $('#calendarDay').value = $('#scheduleDay').value || $('#calendarDay').value || days[0] || '';
      $('#scheduleDay').value = $('#calendarDay').value;
    }
    renderCalendar();
  });
  ['schedulePerson','scheduleConflicts'].forEach(id => $('#'+id).addEventListener('change', renderCalendar));
  $('#scheduleDay').addEventListener('change', () => {
    if ($('#scheduleDay').value) $('#calendarDay').value = $('#scheduleDay').value;
    else if ($('#calendarMode').value === 'day') $('#calendarMode').value = 'week';
    renderCalendar();
  });
  $('#calendarDay').addEventListener('change', () => { $('#scheduleDay').value = $('#calendarDay').value; renderCalendar(); });
  // Discovery/map dates never own the team's schedule date.
  $('#dayFilter').removeEventListener('change', render);
  $('#dayFilter').addEventListener('change', e => setPlannerDay(e.target.value));
  $('#calendarView').addEventListener('click', e => {
    const target = e.target.closest('[data-agenda-event], [data-agenda-map], [data-agenda-edit], [data-event-id]');
    if (!target) return;
    const event = byId(target.dataset.agendaEvent || target.dataset.agendaMap || target.dataset.agendaEdit || target.dataset.eventId);
    if (!event) return;
    if (target.dataset.agendaMap) showEventOnMap(event);
    else if (target.dataset.agendaEdit) openAssignment(event);
    else openEvent(event);
  });
  $('#exportTeam').onclick = () => downloadICS(teamVisibleEvents(), 'Equipe-ROGe-2026.ics');
  $('#refreshTeam').onclick = () => refreshTeam(true);
  ['personFilter','coverageFilter'].forEach(id => $('#'+id).addEventListener('change',render));
  $('#clearFilters').onclick = () => {
    ['search','typeFilter','priorityFilter','locationFilter','personFilter','coverageFilter'].forEach(id => $('#'+id).value = '');
    $('#onlyMine').checked = false; radar = 'all'; chip = '';
    $$('.radar-card').forEach(b => b.classList.toggle('active', b.dataset.radar === 'all'));
    $$('.chip').forEach(b => b.classList.remove('active'));
    setPlannerDay('');
  };
  $('#participantInput').addEventListener('input', () => {
    if (!assignmentDraft) return;
    assignmentDraft.value = $('#participantInput').value; assignmentDraft.message = '';
    const card = $$('#events .event').find(el => el.dataset.id === assignmentDraft.event.id);
    const input = card?.querySelector('textarea'); if (input) input.value = assignmentDraft.value;
    updateTeamControls();
  });
  $('#reloadAssignment').onclick = () => { if (assignmentDraft) reloadTeamDraft(assignmentDraft); };
  $('#assignmentForm').addEventListener('submit', e => { e.preventDefault(); if (assignmentDraft) saveTeamDraft(assignmentDraft); });
  $('#assignmentModal').addEventListener('cancel', e => { e.preventDefault(); if (assignmentDraft) cancelTeamDraft(assignmentDraft.event.id); });
  $$('[data-close-dialog="assignmentModal"]').forEach(button => button.onclick = () => { if (assignmentDraft) cancelTeamDraft(assignmentDraft.event.id); });
  if (teamStore.configured) {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTeam(); });
    setInterval(() => { if (!document.hidden) refreshTeam(); }, 300000);
  }
  refreshTeamUI();
  if (teamStore.configured) refreshTeam(true);
}

function updateTeamSummary() {
  const planned=events.filter(e=>assignedNames(e.id).length);
  const conflicts=PlannerModel.conflicts(planned,teamData.assignments);
  teamConflictIds=new Set(conflicts.flatMap(c=>[c.a.id,c.b.id]));
  const people=new Set(planned.flatMap(e=>assignedNames(e.id)).map(PlannerModel.key));
  $('#teamSummary').innerHTML='<span><b>'+people.size+'</b> pessoas na escala</span><span><b>'+planned.length+'</b> eventos cobertos</span><span><b>'+conflicts.length+'</b> conflitos de horário</span><span class="muted">Agenda da equipe: somente eventos com participantes, com filtros próprios de pessoa, dia e conflitos</span>';
}
