/* Pure calendar, participant and iCalendar helpers, shared by UI and tests. */
globalThis.PlannerModel = (() => {
  const key = value => String(value).normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
  function names(values) {
    const result = new Map();
    for (const value of values) {
      const name = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
      if (!name) continue;
      if (name.length > 80) throw new Error('Use nomes com até 80 caracteres.');
      if (!result.has(key(name))) result.set(key(name), name);
    }
    if (result.size > 30) throw new Error('Máximo de 30 participantes por evento.');
    return [...result.values()];
  }
  function minutes(time) {
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(time || '');
    return m && +m[1] < 24 ? +m[1] * 60 + +m[2] : NaN;
  }
  function timed(e) { return Number.isFinite(minutes(e.start)) && minutes(e.end) > minutes(e.start); }
  function overlaps(a, b) {
    return a.date === b.date && timed(a) && timed(b) && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
  }
  function conflicts(list, assignments) {
    const result = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (!overlaps(list[i], list[j])) continue;
      const a = assignments[list[i].id]?.names || [], b = assignments[list[j].id]?.names || [];
      const people = a.filter(n => b.some(other => key(n) === key(other)));
      if (people.length) result.push({ a: list[i], b: list[j], names: people });
    }
    return result;
  }
  // Each connected overlap group receives its own lane count; adjacent events reuse lanes.
  function layout(list) {
    const sorted = list.filter(timed).map(event => ({ event, start: minutes(event.start), end: minutes(event.end) }))
      .sort((a,b) => a.start - b.start || b.end - a.end || a.event.id.localeCompare(b.event.id));
    let group = [], groupEnd = -1;
    const output = [];
    function flush() {
      const ends = [];
      for (const item of group) {
        let lane = ends.findIndex(end => end <= item.start);
        if (lane < 0) lane = ends.length;
        ends[lane] = item.end;
        item.lane = lane;
      }
      group.forEach(item => output.push({ ...item, lanes: ends.length }));
      group = [];
    }
    for (const item of sorted) {
      if (item.start >= groupEnd) { flush(); groupEnd = -1; }
      group.push(item); groupEnd = Math.max(groupEnd, item.end);
    }
    flush(); return output;
  }
  function escapeICS(value = '') {
    return String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }
  function fold(line) {
    const encoder = new TextEncoder();
    let result = '', size = 0;
    for (const char of line) {
      const bytes = encoder.encode(char).length;
      if (size + bytes > 75) { result += '\r\n '; size = 1; }
      result += char; size += bytes;
    }
    return result;
  }
  function buildICS(list, assignments = {}, now = new Date()) {
    const stamp = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    // ROG.e 2026 dates use UTC-03:00. UTC output imports consistently in Outlook and mobile calendars.
    const instant = (date, time) => new Date(date + 'T' + time.padStart(5, '0') + ':00-03:00');
    const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//ROGe 2026 Strategic Planner//PT-BR','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
    for (const e of list) {
      lines.push('BEGIN:VEVENT', 'UID:' + escapeICS(e.id) + '@roge2026-planner', 'DTSTAMP:' + stamp(now));
      if (Number.isFinite(minutes(e.start))) {
        const start = instant(e.date, e.start);
        const end = timed(e) ? instant(e.date, e.end) : new Date(start.getTime() + 3600000);
        lines.push('DTSTART:' + stamp(start), 'DTEND:' + stamp(end));
      } else {
        const next = new Date(e.date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
        lines.push('DTSTART;VALUE=DATE:' + e.date.replaceAll('-', ''), 'DTEND;VALUE=DATE:' + next.toISOString().slice(0,10).replaceAll('-', ''));
      }
      const people = assignments[e.id]?.names || [];
      const description = [e.speakers_raw || '', people.length ? 'Equipe: ' + people.join(', ') : '', 'Fonte: ' + (e.source_url || 'https://roge.energy/programacao')].filter(Boolean).join('\n');
      lines.push('SUMMARY:' + escapeICS('ROG.e 2026 | ' + e.title), 'LOCATION:' + escapeICS(e.location || 'Riocentro, Rio de Janeiro'),
        'DESCRIPTION:' + escapeICS(description), 'URL:' + (e.source_url || 'https://roge.energy/programacao').replace(/[\r\n]/g, ''), 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }
  return { key, names, minutes, timed, overlaps, conflicts, layout, buildICS };
})();
