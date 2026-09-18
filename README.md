# ROG.e 2026 Strategic Planner

Planner web para transformar a programação oficial da **ROG.e 2026** em uma agenda estratégica.

## Site

https://tadeumartins.github.io/roge-2026-planner/

## Diferenciais

- Sincronização automática com as páginas oficiais de Programação, ROG.e FEST e Expositores.
- Congresso, sessões técnicas, Technical Stages, eventos paralelos, exposição e Happy Hour/ROG.e FEST.
- Horário, local, palestrantes e informações de empresas publicadas pela organização.
- Radar de prioridade por **stakeholders**, **tecnologias** e **desafios da indústria**.
- Preferências customizáveis no navegador.
- Minha Agenda, detecção de conflito e download `.ics` para Outlook/Google Calendar.
- Busca de expositores por pavilhão e estande.
- GitHub Actions atualiza a agenda a cada 30 minutos e publica o GitHub Pages.

## Fontes oficiais

- https://roge.energy/programacao
- https://roge.energy/roge-fest
- https://roge.energy/expositores

## Atualização

O workflow `.github/workflows/refresh-and-deploy.yml` executa o scraper em Playwright, valida a captura antes de substituir os dados e publica o resultado no GitHub Pages.

## Calendário e escala compartilhada

- Lista original preservada, incluindo radar, filtros, favoritos, expositores e exportação individual.
- Calendário por dia ou pelos quatro dias do evento, com sessões simultâneas lado a lado.
- Participantes da equipe nos cartões; vários nomes no mesmo evento.
- Filtro por participante e por programação completa, eventos com equipe ou favoritos.
- Alertas somente quando a mesma pessoa está atribuída a eventos com horários sobrepostos.
- Exportação ICS da visão atual, incluindo os nomes na descrição e horários de Brasília convertidos para UTC.

### Persistência nativa no GitHub

A fonte compartilhada é `data/team.json` na branch `main`, independente dos favoritos pessoais em localStorage. Não é necessário Supabase, Firebase ou servidor adicional. O GitHub Pages continua hospedando a aplicação. As coordenadas do repositório estão em `js/team-config.js`.

A página carrega a escala diretamente do GitHub ao abrir, ao voltar para a aba (com intervalo mínimo de um minuto) e a cada cinco minutos enquanto visível. **Atualizar escala** solicita uma nova consulta imediatamente. Uma cópia local permite consultar a última escala em caso de falha; a interface informa quando ela não conseguiu atualizar. O GitHub limita consultas públicas sem autenticação a 60 por hora por IP; em redes compartilhadas, use atualização manual com moderação ou habilite a edição com sua conta.

Para editar:
1. Clique em **Habilitar edição**.
2. Crie um [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new), selecionando somente este repositório, prazo curto e **Contents: Read and write**.
3. Cole o token na aplicação. A conta deve ser proprietária ou colaboradora com acesso de escrita. O token permanece somente na memória da aba; após recarregar é necessário conectar novamente.
4. Clique em **Equipe** em um cartão, informe um nome por linha e use **Salvar para todos**. Remova os nomes e salve para limpar a atribuição.

Leitores não precisam de conta nem token. **Os nomes ficam públicos, inclusive no histórico do repositório.** Não use esta opção para dados confidenciais. Nunca coloque tokens no código, nos arquivos de dados ou em commits.

Cada salvamento lê a versão atual e usa o SHA do arquivo para evitar sobrescrita. Mudanças simultâneas em outros eventos são preservadas. Se outra pessoa alterar o mesmo evento, a gravação é recusada; use **Recarregar participantes** para revisar antes de tentar novamente. Falhas de rede nunca são apresentadas como salvamento concluído.

O scraper não altera `data/team.json`. Caso a fonte oficial remova um evento ou mude seu identificador, a escala anterior é preservada e listada no calendário para revisão; não é transferida automaticamente para uma sessão possivelmente diferente.

### Mapa

Não foi incorporada uma terceira tela: não foi localizada uma planta completa e atual em formato adequado para integração. O [IBP informa que o aplicativo oficial oferece mapa interativo](https://www.ibp.org.br/hub-de-conhecimento/noticias/aplicativo-oficial-da-roge-2026-ja-esta-disponivel/).

### Validação

```sh
npm install
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Os testes de interface usam a programação real e uma API GitHub simulada. Verificam busca, favoritos, expositores, cancelamento do radar, edição, recarga, novo dispositivo, calendário, ICS, mobile e escape de HTML. Nenhum teste grava nomes fictícios no GitHub. A validação da gravação real exige autorização de um editor.
