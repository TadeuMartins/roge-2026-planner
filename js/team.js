let teamData = { version: 1, assignments: {} };
let teamStore, teamLoaded = false, teamBusy = false, teamRefreshing = false, teamLastRead = 0;
let teamRevision = 0;
let plannerView = 'list', assignmentDraft = null;
const teamCacheKey = 'roge_team_cache_v1';
function assignedNames(id) { return teamData.assignments[id]?.names || []; }
function participantBadges(id) {
  const people = assignedNames(id);
  return '<div class="participant-badges">' + (people.length ? people.map(n => '<span class="participant-badge">' + escapeHtml(n) + '</span>').join('') : '<span class="muted">Equipe ainda não definida</span>') + '</div>';
}
function teamStatus(message, error = false) {
  $('#teamSync').textContent = message;
  $('#teamSync').classList.toggle('sync-error', error);
}
function cacheTeam() {
  try { localStorage.setItem(teamCacheKey, JSON.stringify({ savedAt: new Date().toISOString(), data: teamData })); } catch { /* Shared save remains successful even without local storage. */ }
}
function refreshTeamUI() {
  const selected = $('#personFilter').value;
  const people = [...new Map(Object.values(teamData.assignments).flatMap(r => r.names).map(n => [PlannerModel.key(n), n])).values()].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  // More than 30 people in the whole team is valid (limit applies per event only).
  $('#personFilter').innerHTML = '<option value="">Toda a equipe</option>' + people.map(n => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
  if (people.includes(selected)) $('#personFilter').value = selected;
  render();
}
async function refreshTeam(force = false) {
  if (teamBusy || teamRefreshing || (!force && Date.now() - teamLastRead < 60000)) return;
  const revision = teamRevision;
  teamRefreshing = true; $('#refreshTeam').disabled = true;
  teamStatus('Atualizando escala compartilhada…');
  try {
    const result = await teamStore.read();
    if (revision !== teamRevision) return;
    teamData = result.data; teamLoaded = true; teamLastRead = Date.now(); cacheTeam();
    teamStatus('Escala atualizada às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    refreshTeamUI();
  } catch (error) {
    teamStatus(error.message + (Object.keys(teamData.assignments).length ? ' Exibindo a última cópia disponível.' : ''), true);
  } finally { teamRefreshing = false; $('#refreshTeam').disabled = false; }
}
function setPlannerView(view) {
  plannerView = view;
  $$('.view-tab').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-pressed', String(button.dataset.view === view)); });
  $('#listView').hidden = view !== 'list'; $('#calendarView').hidden = view !== 'calendar';
  if (view === 'calendar') renderCalendar();
}
function teamVisibleEvents() {
  const person = $('#personFilter').value, scope = $('#calendarScope').value;
  return filtered().filter(e => {
    const names = assignedNames(e.id);
    if (person && !names.some(n => PlannerModel.key(n) === PlannerModel.key(person))) return false;
    if (scope === 'team' && !names.length) return false;
    if (scope === 'mine' && !favorites.has(e.id)) return false;
    return true;
  });
}
function renderCalendar() {
  if (!$('#calendarGrid')) return;
  const days = uniq(events.map(e => e.date)).sort();
  const mode = $('#calendarMode').value;
  const currentDay = $('#calendarDay').value || days[0];
  const shownDays = mode === 'day' ? [currentDay] : days;
  $('#calendarDay').disabled = mode !== 'day';
  const visible = teamVisibleEvents().filter(e => shownDays.includes(e.date));
  $('#calendarCount').textContent = visible.length + ' eventos nesta visão';
  $('#exportTeam').disabled = visible.length === 0;
  const timed = visible.filter(PlannerModel.timed), untimed = visible.filter(e => !PlannerModel.timed(e));
  const earliest = Math.floor(Math.min(9 * 60, ...timed.map(e => PlannerModel.minutes(e.start))) / 60) * 60;
  const latest = Math.ceil(Math.max(19 * 60, ...timed.map(e => PlannerModel.minutes(e.end))) / 60) * 60;
  const pixels = 2, height = (latest - earliest) * pixels;
  const conflicts = PlannerModel.conflicts(events, teamData.assignments);
  const conflictIds = new Set(conflicts.flatMap(c => [c.a.id, c.b.id]));
  const ticks = [];
  for (let t = earliest; t < latest; t += 60) ticks.push('<span style="top:' + ((t-earliest)*pixels) + 'px">' + minutesToTime(t) + '</span>');
  const columns = shownDays.map(date => {
    const daily = timed.filter(e => e.date === date);
    return '<div class="calendar-column"><div class="calendar-day-head"><b>' + escapeHtml(fmtDate(date)) + '</b><small>' + daily.length + ' eventos</small></div><div class="calendar-day-body" style="height:' + height + 'px">' +
      PlannerModel.layout(daily).map(item => {
        const e = item.event, people = assignedNames(e.id);
        const label = e.start + '–' + e.end + ' · ' + e.title + ' · ' + (e.location || '') + ' · ' + (people.join(', ') || 'Sem participantes');
        return '<button class="calendar-event ' + (conflictIds.has(e.id) ? 'has-conflict' : '') + '" data-event-id="' + escapeHtml(e.id) + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '" style="top:' + ((item.start-earliest)*pixels) + 'px;height:' + Math.max(22,(item.end-item.start)*pixels-3) + 'px;left:calc(' + (item.lane/item.lanes*100) + '% + 2px);width:calc(' + (100/item.lanes) + '% - 4px)"><strong>' + e.start + '–' + e.end + '</strong><b>' + escapeHtml(e.title) + '</b><small>' + escapeHtml(e.location) + '</small><span>' + escapeHtml(people.join(' · ') || 'Sem participantes') + '</span>' + (conflictIds.has(e.id) ? '<em>⚠ Conflito na equipe</em>' : '') + '</button>';
      }).join('') + '</div></div>';
  }).join('');
  $('#calendarEmpty').hidden = visible.length !== 0;
  $('#calendarGrid').innerHTML = '<div class="calendar-time"><div class="calendar-day-head">BRT</div><div class="calendar-ticks" style="height:' + height + 'px">' + ticks.join('') + '</div></div>' + columns;
  $('#calendarGrid').style.setProperty('--days', shownDays.length);
  $('#calendarUntimed').innerHTML = untimed.length ? '<h3>Horário a confirmar</h3>' + untimed.map(e => '<button class="ghost-btn" data-event-id="' + escapeHtml(e.id) + '">' + escapeHtml(fmtDate(e.date) + ' · ' + e.title) + '</button>').join('') : '';
  const relevant = conflicts.filter(c => visible.some(e => e.id === c.a.id || e.id === c.b.id));
  $('#teamConflicts').innerHTML = relevant.length ? '<details><summary>⚠ ' + relevant.length + ' conflitos de participantes — revisar revezamento</summary>' + relevant.map(c => '<p><b>' + escapeHtml(c.names.join(', ')) + '</b> · ' + escapeHtml(fmtDate(c.a.date)) + '<br>' + escapeHtml(c.a.start + ' ' + c.a.title) + ' ↔ ' + escapeHtml(c.b.start + ' ' + c.b.title) + '</p>').join('') + '</details>' : '';
  const missing = Object.entries(teamData.assignments).filter(([id]) => !byId(id));
  $('#teamOrphans').innerHTML = missing.length ? '<details><summary>' + missing.length + ' eventos da escala não estão mais na programação atual</summary><p>Os nomes foram preservados. Confira mudanças na fonte oficial antes de redistribuir a equipe.</p>' + missing.map(([,r]) => '<p>' + escapeHtml((r.event?.date || '') + ' · ' + (r.event?.title || 'Evento anterior') + ' — ' + r.names.join(', ')) + '</p>').join('') + '</details>' : '';
}
function updateDraftConflict() {
  if (!assignmentDraft) return;
  let people;
  try { people = PlannerModel.names($('#participantInput').value.split(/[,;\n]/)); } catch (error) { $('#assignmentConflicts').textContent = error.message; return; }
  const records = { ...teamData.assignments, [assignmentDraft.event.id]: { names: people } };
  const conflicts = PlannerModel.conflicts(events, records).filter(c => c.a.id === assignmentDraft.event.id || c.b.id === assignmentDraft.event.id);
  $('#assignmentConflicts').textContent = conflicts.map(c => {
    const other = c.a.id === assignmentDraft.event.id ? c.b : c.a;
    return '⚠ ' + c.names.join(', ') + ' também em ' + other.start + '–' + other.end + ': ' + other.title;
  }).join('\n');
}
function openAssignment(event) {
  assignmentDraft = { event, expected: [...assignedNames(event.id)] };
  $('#assignmentTitle').textContent = event.title;
  $('#assignmentTime').textContent = fmtDate(event.date) + ' · ' + event.start + '–' + event.end + ' · ' + event.location;
  $('#participantInput').value = assignmentDraft.expected.join('\n');
  $('#assignmentMessage').textContent = teamStore.token ? 'As alterações ficarão visíveis para todos após salvar.' : 'Conecte seu GitHub para salvar alterações.';
  $('#saveParticipants').disabled = !teamStore.token || !teamLoaded || teamBusy;
  $('#assignmentAuth').hidden = !!teamStore.token;
  $('#participantInput').readOnly = !teamStore.token;
  updateDraftConflict();
  $('#assignmentModal').showModal();
}
function openTeamAuth() { $('#authMessage').textContent = ''; $('#githubToken').value = ''; $('#teamAuthModal').showModal(); }
function wireTeam() {
  teamStore = new TeamStore(ROGE_TEAM_CONFIG);
  try { const cache = JSON.parse(localStorage.getItem(teamCacheKey)); if (cache?.data) { teamData = teamStore.validate(cache.data); teamStatus('Última cópia salva · verificando atualizações…'); } } catch { /* Bad cache cannot prevent startup. */ }
  const days = uniq(events.map(e => e.date)).sort();
  $('#calendarDay').innerHTML = days.map(d => '<option value="' + escapeHtml(d) + '">' + escapeHtml(fmtDate(d)) + '</option>').join('');
  $('#calendarMode').value = matchMedia('(max-width: 700px)').matches ? 'day' : 'week';
  $$('.view-tab').forEach(button => button.onclick = () => setPlannerView(button.dataset.view));
  ['calendarMode','calendarDay','personFilter','calendarScope'].forEach(id => $('#'+id).addEventListener('change',renderCalendar));
  $('#calendarView').addEventListener('click', e => { const target = e.target.closest('[data-event-id]'); if(target) openEvent(byId(target.dataset.eventId)); });
  $('#exportTeam').onclick = () => downloadICS(teamVisibleEvents().filter(e => $('#calendarMode').value !== 'day' || e.date === $('#calendarDay').value), 'Equipe-ROGe-2026.ics');
  $('#refreshTeam').onclick = () => refreshTeam(true);
  $('#connectTeam').onclick = openTeamAuth; $('#assignmentAuth').onclick = openTeamAuth;
  $('#disconnectTeam').onclick = () => {
    teamStore.token = ''; $('#disconnectTeam').hidden = true; $('#connectTeam').hidden = false;
    $('#teamAuthModal').close();
    if ($('#assignmentModal').open) openAssignment(assignmentDraft.event);
  };
  $('#teamAuthForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#authorizeTeam').disabled = true; $('#authMessage').textContent = 'Verificando acesso…';
    try {
      await teamStore.authorize($('#githubToken').value);
      $('#githubToken').value = ''; $('#teamAuthModal').close(); $('#connectTeam').hidden = true; $('#disconnectTeam').hidden = false;
      await refreshTeam(true);
      if ($('#assignmentModal').open) openAssignment(assignmentDraft.event);
    } catch (error) { $('#authMessage').textContent = error.message; }
    finally { $('#authorizeTeam').disabled = false; }
  });
  $('#participantInput').addEventListener('input', updateDraftConflict);
  $('#reloadAssignment').onclick = async () => { await refreshTeam(true); openAssignment(assignmentDraft.event); };
  $('#assignmentForm').addEventListener('submit', async e => {
    e.preventDefault(); if (teamBusy || !assignmentDraft) return;
    teamRevision++; teamBusy = true; $('#saveParticipants').disabled = true; $('#assignmentMessage').textContent = 'Salvando no GitHub…';
    const draft = assignmentDraft;
    try {
      teamData = await teamStore.save(draft.event, $('#participantInput').value.split(/[,;\n]/), draft.expected);
      teamLoaded = true; cacheTeam(); teamLastRead = Date.now(); $('#assignmentModal').close();
      teamStatus('Escala salva no GitHub. Disponível para todos.'); refreshTeamUI();
    } catch (error) {
      if (error.latest) { teamData = error.latest; cacheTeam(); refreshTeamUI(); }
      $('#assignmentMessage').textContent = error.message;
    } finally { teamBusy = false; $('#saveParticipants').disabled = !teamStore.token || !teamLoaded; }
  });
  $('#assignmentModal').addEventListener('cancel', e => { if (teamBusy) e.preventDefault(); });
  $$('[data-close-dialog]').forEach(button => button.onclick = () => { if (!teamBusy) $('#'+button.dataset.closeDialog).close(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshTeam(); });
  setInterval(() => { if (!document.hidden) refreshTeam(); }, 300000);
  refreshTeamUI(); refreshTeam(true);
}
