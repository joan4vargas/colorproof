# ColorProof

Sistema web de simulação cromática e análise de conformidade de cor para
ambientes gráficos. Roda inteiramente no navegador — sem servidor, sem
software proprietário.

## Stack

- **Linguagem:** TypeScript
- **Build tool / dev server:** Vite
- **Framework de UI:** React
- **APIs nativas do navegador:** Canvas API, Web Workers + Transferable
  Objects, File API / ArrayBuffer / TypedArrays
- **Bibliotecas de terceiros:** `pdfjs-dist` (extração de estrutura do PDF),
  lcms2 compilado para WASM (motor de cor / CMM — a integrar na Fase 3)
- **Framework de testes:** Vitest
- **Ambiente de desenvolvimento:** Node.js (só tooling — não faz parte do
  runtime da aplicação entregue)
- **Ambiente de execução:** navegador (client-side)

## Estrutura de pastas

```
src/
  core/                   Fase 2 — núcleo matemático colorimétrico
    colorimetry.ts        RGB→XYZ→Lab, Bradford (D65→D50), CIEDE2000
    __tests__/            54 testes: 34 pares de Sharma, Wu & Dalal (2005)
                           + pipeline sRGB→Lab contra referência independente

  lib/
    icc/colorEngine.ts    Fase 3 — integração com lcms2-wasm (a implementar)
    pdf/extractImages.ts  Fase 4 — extração de imagens/OutputIntent do PDF
                           via pdf.js (a implementar)
    sampling/kmeans.ts     Fase 4 — clusterização de cor em Lab (implementado,
                           ainda sem testes)

  workers/                Fase 5 — Web Workers (a criar)

  types/color.ts          Tipos base: RGB, XYZ, Lab, iluminantes D65/D50

  components/             Fase 8 — UI real (a construir sobre o mockup)

  App.tsx                 Placeholder: mostra o status de cada fase
```

Essa separação existe para sustentar o ciclo de validação científica descrito
na metodologia: `core/` não depende de DOM, Canvas ou Web Workers — só
números entrando e números saindo — o que permite testá-lo isoladamente no
Vitest antes de integrar qualquer perfil ICC real ou UI.

## Documentação

Decisões, arquitetura, validação e limitações conhecidas estão em
`docs/DOCUMENTACAO.md`.

## Rodando o projeto

```bash
npm install
npm run dev      # sobe o servidor de desenvolvimento
npm test         # roda os testes unitários (Vitest)
```

## Status atual (mapeado ao roteiro de 8 fases)

- [x] **Fase 1** — Setup e fundamentação
- [x] **Fase 2** — Núcleo matemático colorimétrico (54/54 testes passando)
- [ ] **Fase 3** — Integração do motor de cor (lcms2-wasm)
- [ ] **Fase 4** — Extração de cor do PDF (esqueleto pronto, funções lançam
      `Error` de "ainda não implementado" propositalmente — ver TODOs em
      `lib/pdf/extractImages.ts`)
- [ ] **Fase 5** — Web Workers e performance
- [ ] **Fase 6** — Fluxo A: round-trip (foco principal do TCC)
- [ ] **Fase 7** — Fluxo B: referência vs. simulação (complementar)
- [ ] **Fase 8** — Interface, validação final e escrita

## Decisões de escopo relevantes para a monografia

- **Amostras de cor:** clusterização automática (k-means em Lab) sobre a
  imagem rasterizada, não parsing de content stream vetorial/spot colors do
  PDF — trade-off documentado para manter o escopo viável no prazo do TCC.
- **Tolerância do laudo:** inspirada nos limiares da ISO 12647-2, mas
  aplicada a um teste de round-trip de gamute (cor original vs. mesma cor
  após ida-e-volta pelo perfil ICC), não à medição espectrofotométrica de
  uma tiragem impressa real — essa distinção deve ficar explícita no texto
  para não superestimar o que o laudo garante.
- **Perfis ICC:** ISOcoated_v2 (caracterização FOGRA39) e PSOcoated_v3
  (caracterização FOGRA51) como perfis padrão, com suporte a perfil
  customizado do usuário. São caracterizações de impressão diferentes.
