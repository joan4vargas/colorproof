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
  `lcms-wasm` (Little CMS compilado para WASM; motor de cor / CMM)
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
    icc/                  Fase 3 — integração com lcms2-wasm
      colorEngine.ts      CMYK <-> Lab, round-trip, sRGB -> Lab (testado em Node)
      iccTags.ts          leitura do cabeçalho e das tags de um perfil ICC
      characterization.ts dados de caracterização (CGATS) embutidos no perfil
    pdf/                  Fase 4 — PDF -> pixels (pdf.js e MuPDF); fixtures e testes
      renderPdf.ts        caminho RGB: rasteriza páginas (pdf.js e canvas injetados)
      cmykPdf.ts          caminho CMYK: lê os números C, M, Y, K (MuPDF)
      analyzePdf.ts       escolhe o caminho (híbrido RGB/CMYK)
      browserPdf.ts       ligação ao navegador; rasteriza imagens
      outputIntent.ts     leitura do /OutputIntents (pendente)
    sampling/             Fase 4 — cores dominantes
      kmeans.ts           k-means ponderado em Lab, determinístico
      dominantColors.ts   RGB: histograma exato + exclusão do papel + k-means
      dominantCmyk.ts     CMYK: o mesmo, com Lab pelo perfil ICC

  scripts/                gerar-fixtures-pdf.py (PDFs de teste; usa reportlab)

  workers/                Fase 5 — Web Workers (a criar)

  types/color.ts          Tipos base: RGB, XYZ, Lab, iluminantes D65/D50

  components/             ProfileSmokeTest e PdfColorTest (provisórios); UI real na Fase 8

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

### Perfis ICC (não acompanham o repositório)

O aviso de direitos dos perfis da ECI não permite redistribuí-los sem
permissão escrita, por isso `*.icc` está no `.gitignore`. Baixe-os em
https://eci.org/doku.php_id=en:downloads.html (seção *ICC profiles from ECI*):

- `pso-coated_v3.zip` contém `PSOcoated_v3.icc` (FOGRA51)
- `eci_offset_2009.zip` contém `ISOcoated_v2_eci.icc` (FOGRA39)

Coloque os arquivos `.icc` em `public/profiles/`. Sem eles, os testes que
dependem de perfil são ignorados (os demais continuam rodando).

## Status atual (mapeado ao roteiro de 8 fases)

- [x] **Fase 1** — Setup e fundamentação
- [x] **Fase 2** — Núcleo matemático colorimétrico (54/54 testes passando)
- [ ] **Fase 3** — Integração do motor de cor (lcms2-wasm): implementada,
      testada em Node e no navegador com PSO Coated v3 e ISO Coated v2; falta
      verificar em Web Worker (Fase 5)
- [x] **Fase 4** — Extração de cor do PDF. Híbrido: PDFs sem CMYK pelo
      pdf.js (sRGB); PDFs com CMYK pelo MuPDF, que lê os números C, M, Y, K do
      arquivo (o pdf.js os converte de forma aproximada, 3,7 a 10,9 ΔE00 de
      desvio). Testada em Node e no navegador. Atenção: o MuPDF é AGPL-3.0;
      ver `docs/DOCUMENTACAO.md`, seção 8 e L14
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
