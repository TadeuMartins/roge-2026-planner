/* Public Supabase RPCs are the shared source of truth; no user credentials. */
globalThis.TeamStore = class TeamStore {
  constructor(config = {}, request = globalThis.fetch.bind(globalThis)) {
    this.config = config; this.request = request;
    this.configured = typeof config.url === 'string' && !!config.url.trim() &&
      typeof config.publishableKey === 'string' && !!config.publishableKey.trim();
    this.endpoint = this.configured ? config.url.trim().replace(/\/+$/, '') + '/rest/v1/rpc/' : '';
  }
  async call(rpc, params = {}) {
    if (!this.configured) throw new Error('Supabase não configurado. Preencha url e publishableKey em js/team-config.js.');
    const key = this.config.publishableKey.trim();
    const response = await this.request(this.endpoint + rpc, {
      method: 'POST', body: JSON.stringify(params), signal: AbortSignal.timeout(20000), cache: 'no-store',
      // New publishable keys are not JWTs. Only legacy anon JWTs use Bearer.
      headers: { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: 'Bearer ' + key } : {}),
        'Content-Type': 'application/json', Accept: 'application/json' }
    });
    if (!response.ok) {
      const error = new Error(response.status === 409 ? 'Outra pessoa alterou este evento. Atualize os participantes antes de salvar novamente.' :
        response.status === 401 || response.status === 403 ? 'Sem permissão para acessar a escala. Confira a chave pública e as permissões do Supabase.' :
        response.status === 400 || response.status === 404 ? 'Evento ou dados inválidos. Confira a programação e a configuração do Supabase.' :
        'Não foi possível salvar ou carregar a escala (Supabase ' + response.status + '). Atualize antes de tentar novamente.');
      error.status = response.status; throw error;
    }
    return this.validate(await response.json());
  }
  names(input) {
    if (!Array.isArray(input) || input.length > 30 || Array.from(input).some(n => typeof n !== 'string')) throw new Error('Participantes inválidos na escala (máximo de 30 nomes).');
    const names = PlannerModel.names(input);
    if (names.some(n => /[\u0000-\u001f\u007f-\u009f]/.test(n))) throw new Error('Participantes inválidos na escala.');
    return names;
  }
  validate(data) {
    if (!data || data.version !== 1 || !data.assignments || typeof data.assignments !== 'object' || Array.isArray(data.assignments)) throw new Error('Formato da escala inválido.');
    for (const [id, record] of Object.entries(data.assignments)) {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !record || Array.isArray(record) ||
          JSON.stringify(this.names(record.names)) !== JSON.stringify(record.names)) throw new Error('Participantes inválidos na escala.');
    }
    return data;
  }
  async read() {
    return { data: await this.call('get_team_schedule') };
  }
  async save(event, input, expectedNames) {
    if (!this.configured) throw new Error('Supabase não configurado. Preencha url e publishableKey em js/team-config.js.');
    if (!event || typeof event.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.id)) throw new Error('Evento inválido.');
    return this.call('save_team_assignment', {
      p_event_id: event.id, p_names: this.names(input), p_expected_names: this.names(expectedNames)
    });
  }
};
