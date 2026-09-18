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
- Filtros compartilhados entre eventos, calendário e mapas: dia, formato, local, relevância, participante, favoritos e situação da escala (com participantes, sem participantes ou com conflito).
- Alertas somente quando a mesma pessoa está atribuída a eventos com horários sobrepostos.
- Exportação ICS da visão atual, incluindo os nomes na descrição e horários de Brasília convertidos para UTC.

### Edição pública nos cartões

A escala compartilhada fica no Supabase, independente dos favoritos pessoais no navegador. O GitHub Pages continua hospedando a aplicação. O projeto pode usar o plano gratuito, sujeito às cotas e pausas por inatividade do serviço. A URL e a chave pública ficam em `js/team-config.js`; nenhuma credencial administrativa vai para o navegador.

A página consulta o banco ao abrir, ao voltar para a aba (com intervalo mínimo de um minuto) e a cada cinco minutos enquanto visível. **Atualizar escala** solicita uma nova consulta imediatamente. Uma cópia local permite consultar a última leitura quando a rede falha; não substitui o salvamento compartilhado.

Para editar:
1. Pesquise o evento e clique em **Equipe** no próprio cartão.
2. Informe os participantes, um por linha ou separados por vírgulas.
3. Clique em **Salvar para todos**. Deixe o campo vazio e salve para remover os participantes.

**Qualquer visitante pode consultar, editar ou apagar participantes, sem conta nem login.** Os nomes são públicos; não inclua dados confidenciais. Não há identificação de autores ou proteção contra vandalismo. Os limites de entrada e permissões do banco restringem a edição aos participantes dos eventos cadastrados, não ao restante do projeto. Dados que tenham sido publicados antes no GitHub continuam no histórico antigo.

O salvamento compara os nomes que estavam no início da edição dentro de uma transação no banco. Mudanças em outros eventos são preservadas. Se outra pessoa alterar o mesmo evento, a gravação é recusada; **Recarregar participantes** descarta o rascunho e traz a versão atual para revisão. Rascunhos são preservados ao filtrar ou atualizar a escala, mas não após fechar/recarregar a página. Uma falha de rede não é apresentada como sucesso; consulte o banco antes de repetir, pois a resposta pode se perder após a gravação.

O scraper não altera participantes. Após cada captura, o workflow sincroniza os IDs e metadados no banco usando uma credencial exclusiva do servidor guardada no GitHub Actions. Caso a fonte oficial remova um evento ou mude seu identificador, a escala anterior é preservada e listada no calendário; não é transferida automaticamente para outra sessão. Veja [supabase/SETUP.md](supabase/SETUP.md). O arquivo antigo `data/team.json` é apenas uma fonte de migração, não a escala ativa.

### Mapa

A terceira aba integra a planta geral do Riocentro e a imagem do segundo andar fornecidas pela equipe. Inclui troca de andar, zoom, ajuste à tela, navegação por toque/teclado, busca por sala/tema/participante e programação por local com os nomes da equipe. Nos detalhes do evento, **Ver no mapa** seleciona o andar, o local e o mesmo dia nas três abas.

A planta geral indica revisões de maio de 2026; a imagem do segundo andar não informa revisão. As posições são aproximadas. Marcadores de pavilhão indicam somente a área, não a posição exata de arenas, palcos ou estandes. Technical Stages e outros locais sem correspondência confirmada aparecem em uma lista explícita de eventos sem posição na planta. Não há rotas internas ou localização em tempo real. A planta original pode ser aberta para conferir detalhes.

As imagens e o PDF ficam em `assets/maps/`; as correspondências verificadas de nomes e coordenadas ficam em `js/map-data.js`. Atualize-as quando a organização divulgar uma revisão.

### Validação

```sh
npm install
npm run check
npm test
npx playwright install chromium
npm run test:browser
```

Os testes de interface usam a programação real e uma API Supabase simulada. Verificam edição pública dentro do cartão, recarga, novo dispositivo, concorrência, falhas, preservação de rascunhos, filtros compartilhados, mapas, calendário, ICS, telas de 320/390 pixels e escape de HTML. Nenhum teste de interface grava participantes fictícios no serviço real. A configuração do banco e suas permissões devem ser verificadas antes de publicar.
