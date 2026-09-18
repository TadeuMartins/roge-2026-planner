/* GitHub is the shared source of truth. Credentials are held in memory only. */
globalThis.TeamStore = class TeamStore {
  constructor(config, request = globalThis.fetch.bind(globalThis)) {
    this.config = config; this.request = request; this.token = '';
    this.endpoint = 'https://api.github.com/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo) + '/contents/' + config.path.split('/').map(encodeURIComponent).join('/');
  }
  headers() {
    return { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) };
  }
  async call(url, options = {}) {
    const response = await this.request(url, { ...options, signal: AbortSignal.timeout(20000), cache: 'no-store', headers: { ...this.headers(), ...options.headers } });
    if (!response.ok) {
      const error = new Error(response.status === 401 ? 'Autorização inválida ou expirada. Conecte novamente.' :
        response.status === 403 || response.status === 429 ? 'GitHub indisponível por limite de acesso ou falta de permissão. Aguarde ou confira a autorização.' :
        response.status === 404 ? 'Escala não encontrada. Confira o repositório e a publicação da atualização.' :
        'Não foi possível salvar ou carregar a escala (GitHub ' + response.status + '). Tente atualizar.');
      error.status = response.status; throw error;
    }
    return response.json();
  }
  decode(content) { return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g,'')), c => c.charCodeAt(0))); }
  encode(content) { return btoa(Array.from(new TextEncoder().encode(content), b => String.fromCharCode(b)).join('')); }
  validate(data) {
    if (data.version !== 1 || !data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) throw new Error('Formato da escala inválido. Nenhum dado foi alterado.');
    for (const [id, record] of Object.entries(data.assignments)) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !record || !Array.isArray(record.names) || record.names.some(n => typeof n !== 'string')) throw new Error('Participantes inválidos na escala.');
      PlannerModel.names(record.names);
    }
    return data;
  }
  async read() {
    const file = await this.call(this.endpoint + '?ref=' + encodeURIComponent(this.config.branch));
    return { sha: file.sha, data: this.validate(JSON.parse(this.decode(file.content))) };
  }
  async authorize(token) {
    this.token = token.trim();
    try {
      const info = await this.call('https://api.github.com/repos/' + encodeURIComponent(this.config.owner) + '/' + encodeURIComponent(this.config.repo));
      if (!info.permissions?.push) throw new Error('Esta conta não pode editar o repositório. Solicite acesso ao responsável.');
    } catch (error) { this.token = ''; throw error; }
  }
  async save(event, input, expected) {
    if (!this.token) throw new Error('Conecte seu GitHub para editar a escala.');
    const people = PlannerModel.names(input);
    const equal = (a,b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.read();
      if (!equal(latest.data.assignments[event.id]?.names, expected)) {
        const error = new Error('Outra pessoa alterou este evento. Atualize os participantes antes de salvar novamente.');
        error.latest = latest.data; throw error;
      }
      const data = structuredClone(latest.data);
      if (people.length) data.assignments[event.id] = {
        names: people, event: { id: event.id, title: event.title, date: event.date, start: event.start || '', end: event.end || '', location: event.location || '' },
        updated_at: new Date().toISOString()
      };
      else delete data.assignments[event.id];
      data.updated_at = new Date().toISOString();
      try {
        await this.call(this.endpoint, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'data: update team assignments', branch: this.config.branch, sha: latest.sha, content: this.encode(JSON.stringify(data, null, 2) + '\n') })
        });
        return data;
      } catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  }
};
