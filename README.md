# ROG.e 2026 Strategic Planner

Planner web para transformar a programação oficial da **ROG.e 2026** em uma agenda estratégica.

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
