import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const modelSource = fs.readFileSync(new URL('../js/planner-model.js', import.meta.url), 'utf8');
const teamSource = fs.readFileSync(new URL('../js/team.js', import.meta.url), 'utf8');
const event = (id, start = '10:00', date = '2026-09-21', end = '11:00') => ({ id, start, end, date, title: 'Session ' + id, location: 'Room ' + id });

// Only the controls used by team.js: no browser, storage backend, or DOM dependency.
function fixture(events, assignments) {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) {
      let html = '', value = '', options = [];
      nodes.set(selector, {
        checked: false, hidden: false, disabled: false, textContent: '', dataset: {},
        style: { setProperty() {} }, classList: { toggle() {} }, listeners: {},
        get value() { return value; },
        set value(next) { value = options.length && !options.some(o => o.value === next) ? '' : next; },
        get selectedOptions() { return options.filter(o => o.value === value); },
        get innerHTML() { return html; },
        set innerHTML(next) {
          html = next;
          if (next.includes('<option')) {
            options = [...next.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map(m => ({ value: m[1], textContent: m[2] }));
            value = options[0]?.value || '';
          }
        },
        addEventListener(type, callback) { (this.listeners[type] ||= new Set()).add(callback); },
        removeEventListener(type, callback) { this.listeners[type]?.delete(callback); },
        dispatch(type, target = this) { for (const callback of this.listeners[type] || []) callback({ target }); },
      });
    }
    return nodes.get(selector);
  }
  let renders = 0;
  const actions = [];
  const context = vm.createContext({
    events, $: node, $$: () => [],
    uniq: values => [...new Set(values)], byId: id => events.find(e => e.id === id),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    fmtDate: value => value, minutesToTime: value => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0'),
    filtered() { throw new Error('Schedule must not use discovery filtered()'); },
    render() { renders++; context.renderCalendar(); },
    document: { body: { dataset: {} } },
    localStorage: { getItem() { throw new Error('No cache access expected without a configured store'); } },
    TeamStore: class { configured = false; read() { throw new Error('No remote reads'); } save() { throw new Error('No remote writes'); } },
    ROGE_TEAM_CONFIG: {},
    openEvent: e => actions.push(['details', e.id]),
    showEventOnMap: e => { actions.push(['map', e.id]); context.setPlannerDay(e.date); },
    downloadICS: (list, filename) => actions.push(['export', Array.from(list, e => e.id), filename]),
    TextEncoder,
  });
  vm.runInContext(modelSource, context);
  vm.runInContext(teamSource, context);
  context.inputAssignments = assignments;
  vm.runInContext('teamData = { version: 1, assignments: inputAssignments };', context);
  context.wireTeam();
  return {
    context, node, actions, get renders() { return renders; },
    ids: () => Array.from(context.teamVisibleEvents(), e => e.id),
    change(selector, value) { node(selector).value = value; node(selector).dispatch('change'); },
    assignments(next) { context.inputAssignments = next; vm.runInContext('teamData.assignments = inputAssignments;', context); context.refreshTeamUI(); },
  };
}

test('week defaults and fallback show assigned events with named participants in a time grid', () => {
  const f = fixture([event('a', '12:00', '2026-09-21', '13:00'), event('b', '12:00', '2026-09-21', '13:00'), event('c', '12:00', '2026-09-22', '13:00'), event('free')], {
    a: { names: ['Test Alpha'] }, b: { names: ['Test Beta'] }, c: { names: ['Test Alpha'] },
  });
  assert.equal(f.node('#calendarMode').value, 'week');
  for (const mode of ['week', '']) {
    f.change('#calendarMode', mode);
    assert.equal(f.node('#calendarGrid').hidden, false);
    assert.equal(f.node('#teamAgenda').hidden, true);
    assert.equal(f.node('#teamAgenda').innerHTML, '');
    const html = f.node('#calendarGrid').innerHTML;
    assert.equal((html.match(/class="calendar-column"/g) || []).length, 2);
    assert.deepEqual([...html.matchAll(/data-event-id="([^"]+)"/g)].map(m => m[1]), ['a', 'b', 'c']);
    assert.match(html, /<strong>12:00\u201313:00<\/strong><span class="calendar-people"><span class="calendar-person person-color-\d">Test Alpha<\/span><\/span><small class="calendar-location">Room a<\/small><b>Session a<\/b>/);
    assert.match(html, /class="calendar-person person-color-\d">Test Beta<\/span>/);
    assert.match(html, /class="full-hour" style="top:0px">09:00/);
    assert.match(html, /class="half-hour" style="top:60px">09:30/);
    assert.match(html, /class="full-hour" style="top:120px">10:00/);
    assert.deepEqual(f.ids(), ['a', 'b', 'c']);
  }
});

test('explicit summary shows assigned-only, chronological person/day rows independent of discovery', () => {
  const f = fixture([event('late', '14:00', '2026-09-22', '15:00'), event('b'), event('early', '9:00'), event('free'), event('unknown', '', '2026-09-21', '')], {
    late: { names: ['Ana'] }, b: { names: ['Ana', 'Bruno'] }, early: { names: ['ana'] }, unknown: { names: ['Ana'] },
  });
  f.change('#calendarMode', 'summary');
  for (const id of ['search', 'personFilter', 'coverageFilter', 'dayFilter', 'priorityFilter', 'locationFilter', 'mapDay']) f.node('#' + id).value = 'unrelated';
  f.node('#onlyMine').checked = true;
  f.context.radar = 'irrelevant';
  f.context.renderCalendar();
  assert.deepEqual(f.ids(), ['early', 'b', 'unknown', 'late']);
  const html = f.node('#teamAgenda').innerHTML;
  assert.equal((html.match(/class="agenda-person"/g) || []).length, 2);
  assert.ok(html.indexOf('data-agenda-event="early"') < html.indexOf('data-agenda-event="b"'));
  assert.ok(html.indexOf('data-agenda-event="unknown"') < html.indexOf('data-agenda-event="late"'));
  assert.ok(html.indexOf('agenda-time') < html.indexOf('agenda-place'));
  assert.ok(html.indexOf('agenda-place') < html.indexOf('agenda-title'));
  for (const selector of ['agenda-day', 'agenda-row', 'agenda-actions', 'data-agenda-map', 'data-agenda-edit']) assert.ok(html.includes(selector));
  assert.match(html, /Horário a confirmar/);
  assert.equal(f.node('#calendarGrid').hidden, true);
  assert.equal(f.node('#exportTeam').disabled, false);
});

test('normalized person selection survives refresh without merging accent-distinct names', () => {
  const f = fixture([event('a'), event('b'), event('c')], { a: { names: ['José'] }, b: { names: ['Jose'] }, c: { names: ['JOSÉ'] } });
  f.change('#schedulePerson', 'josé');
  assert.deepEqual(f.ids(), ['a', 'c']);
  f.assignments({ a: { names: ['ＪＯＳÉ'] }, b: { names: ['Jose'] } });
  assert.equal(f.node('#schedulePerson').value, 'josé');
  assert.deepEqual(f.ids(), ['a']);
  assert.equal(f.node('#schedulePerson').selectedOptions[0].textContent, 'ＪＯＳÉ');
  f.assignments({ b: { names: ['Jose'] } });
  assert.equal(f.node('#schedulePerson').value, 'josé');
  assert.deepEqual(f.ids(), []);
  assert.equal(f.node('#calendarEmpty').hidden, false);
});

test('conflicts and conflict-only rows belong to each person, not their co-participants', () => {
  const f = fixture([event('a'), event('b', '10:30', '2026-09-21', '11:30'), event('c', '12:00', '2026-09-21', '13:00')], {
    a: { names: ['Ana', 'Bruno'] }, b: { names: ['ANA'] }, c: { names: ['Bruno'] },
  });
  f.change('#calendarMode', 'summary');
  const sections = f.node('#teamAgenda').innerHTML.split('<section class="agenda-person">');
  assert.match(sections[1], /has-conflict/);
  assert.doesNotMatch(sections[2], /has-conflict|participant-conflict/);
  f.change('#schedulePerson', 'bruno');
  assert.equal(f.node('#teamConflicts').innerHTML, '');
  f.node('#scheduleConflicts').checked = true;
  f.node('#scheduleConflicts').dispatch('change');
  assert.deepEqual(f.ids(), []);
  f.change('#schedulePerson', 'ana');
  assert.deepEqual(f.ids(), ['a', 'b']);
  assert.doesNotMatch(f.node('#teamConflicts').innerHTML, /Bruno/);
  f.change('#schedulePerson', '');
  assert.doesNotMatch(f.node('#teamAgenda').innerHTML, /Bruno/);
});

test('schedule controls render only the calendar and keep local grid dates in sync', () => {
  const f = fixture([event('a'), event('b', '10:00', '2026-09-22'), event('free')], { a: { names: ['Ana'] }, b: { names: ['Ana'] } });
  const initialRenders = f.renders;
  f.change('#scheduleDay', '2026-09-22');
  assert.deepEqual(f.ids(), ['b']);
  assert.equal(f.node('#calendarDay').value, '2026-09-22');
  f.change('#calendarMode', 'day');
  assert.equal(f.node('#calendarGrid').hidden, false);
  assert.equal(f.node('#teamAgenda').hidden, true);
  assert.match(f.node('#calendarGrid').innerHTML, /data-event-id="b"/);
  f.change('#calendarDay', '2026-09-21');
  assert.equal(f.node('#scheduleDay').value, '2026-09-21');
  assert.deepEqual(f.ids(), ['a']);
  f.change('#calendarMode', 'week');
  assert.equal(f.node('#scheduleDay').value, '');
  assert.deepEqual(f.ids(), ['a', 'b']);
  assert.doesNotMatch(f.node('#calendarGrid').innerHTML, /data-event-id="free"/);
  f.change('#scheduleDay', '2026-09-22');
  assert.deepEqual(f.ids(), ['b']);
  f.change('#calendarMode', 'day');
  f.change('#scheduleDay', '');
  assert.equal(f.node('#calendarMode').value, 'week');
  assert.deepEqual(f.ids(), ['a', 'b']);
  assert.equal(f.renders, initialRenders);
  f.context.setPlannerDay('2026-09-21');
  assert.equal(f.node('#calendarDay').value, '2026-09-22');
  assert.equal(f.node('#scheduleDay').value, '');
});

test('ICS exports exactly the visible schedule with unique event IDs', () => {
  const a = event('a');
  const f = fixture([a, a, event('b', '10:00', '2026-09-22'), event('free')], { a: { names: ['Ana', 'Bruno'] }, b: { names: ['Ana'] } });
  f.node('#exportTeam').onclick();
  assert.deepEqual(f.actions.at(-1), ['export', ['a', 'b'], 'Equipe-ROGe-2026.ics']);
  const ics = f.context.PlannerModel.buildICS(f.context.teamVisibleEvents());
  assert.equal((ics.match(/UID:a@/g) || []).length, 1);
  f.change('#schedulePerson', 'ana');
  f.change('#scheduleDay', '2026-09-22');
  f.node('#exportTeam').onclick();
  assert.deepEqual(f.actions.at(-1)[1], ['b']);
  f.change('#calendarMode', 'day');
  f.node('#exportTeam').onclick();
  assert.deepEqual(f.actions.at(-1)[1], f.ids());
});

test('agenda delegates details, map and assignment actions without changing schedule filters', () => {
  const f = fixture([event('a')], { a: { names: ['Ana'] } });
  f.change('#calendarMode', 'summary');
  f.context.openAssignment = e => f.actions.push(['edit', e.id]);
  f.change('#schedulePerson', 'ana');
  f.change('#scheduleDay', '2026-09-21');
  for (const action of ['agendaEvent', 'agendaMap', 'agendaEdit']) {
    f.node('#calendarView').dispatch('click', { closest: () => ({ dataset: { [action]: 'a' } }) });
  }
  assert.deepEqual(f.actions, [['details', 'a'], ['map', 'a'], ['edit', 'a']]);
  assert.equal(f.node('#schedulePerson').value, 'ana');
  assert.equal(f.node('#scheduleDay').value, '2026-09-21');
  f.context.setPlannerView('calendar');
  assert.equal(f.context.document.body.dataset.view, 'calendar');
  assert.equal(f.node('#listView').hidden, true);
});

test('no assignments shows an honest empty state and preserves orphan notices', () => {
  const f = fixture([event('free')], { removed: { names: ['Ana'], event: event('removed') } });
  assert.deepEqual(f.ids(), []);
  assert.equal(f.node('#teamAgenda').innerHTML, '');
  assert.equal(f.node('#exportTeam').disabled, true);
  assert.equal(f.node('#calendarEmpty').hidden, false);
  assert.match(f.node('#calendarEmpty').textContent, /Nenhum evento tem participantes atribuídos/);
  assert.match(f.node('#teamOrphans').innerHTML, /Session removed/);
});
