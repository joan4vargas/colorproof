# ColorProof — Documentação técnica

Estado do projeto em **17/11/2026** · Fases 1 a 8 implementadas, interface final (253 testes) · Pendências: PDFs reais de produção (Fase 4)

Este documento registra o que foi decidido, o que foi construído, como foi validado e o que ainda é limitação. Ele é escrito para servir de base à seção prática da monografia e para quem for continuar o código.

---


## 8h. Sugestão de cor para amostras que não ficaram conformes

`src/lib/report/suggest.ts` (`suggestReproducible`), chamada por `evaluateFlowA` para amostras sRGB com veredito atenção ou reprovado; o resultado fica em `ColorFinding.suggestion`.

- **O que dá e o que não dá para ajustar.** Se a cor sai do gamut da condição de impressão, nenhum valor de ciano, magenta, amarelo ou preto faz a impressora chegar nela: o CMYK do perfil (B2A) já é o mais próximo que ela alcança. O que se pode mudar é a cor do projeto. A sugestão troca a cor por outra, de mesmo matiz, que a impressão reproduz.
- **Método.** Varre variações de luminosidade (±10 L*, passo 1) e de croma (de 100% a 0%, passo 2%), com o matiz fixo. Para cada candidata roda o round-trip pelo perfil e aceita a que fica com ΔE00 de round-trip ≤ 85% do limite de aprovação (2,55 com o limite padrão 3,0: a sugestão não nasce na beirada). Entre as aceitas escolhe a que menos se afasta da original. É um mapeamento de gamut simples, não uma otimização global do CMYK.
- **O que a tela e o laudo mostram.** A cor sugerida (sRGB e hexadecimal), o CMYK a especificar, a mudança em cada tinta (só as maiores que 1 ponto), a mudança visível em relação à original (ΔE00) e o ΔE00 entre a sugerida e a impressa dela. O laudo HTML ganha a seção "Sugestões" e o CSV, seis colunas (`sugestao_*`).
- **Medido (ISO Coated v2, relativo).** Azul sRGB 0, 70, 255: perda 15,6; a sugerida muda a cor em ΔE00 11,7 e imprime a 2,4 dela. Verde 0, 200, 120: perda 7,35; muda 4,46; imprime a 2,5. Vinho 108, 0, 34: perda 4,44; muda 2,11; imprime a 2,3, e o CMYK quase não muda (13/100/56/63 contra 13/100/57/62): o ajuste está na cor do projeto, não na tinta.
- **Limites.** Só caminho sRGB. Num PDF em CMYK a reprovação vem de outra causa (por exemplo, cobertura total de tinta alta), que este método não trata. A sugestão não diz que a cor original ficará mais fiel: a impressão não chega nela de qualquer modo. A troca é decisão de design, pesada pela "mudança visível". Cores de degradê ou foto (dispersão alta) têm sugestão aproximada, como o veredito.
- **Testes.** Perfil de mentira (croma máximo 40): sugestão reproduzível, matiz mantido, mudança de tintas, cor dentro do gamut, sem candidata. Com ISO Coated v2: três cores reais. Laudo HTML e CSV.


## 8i. Cores spot (Pantone) para CMYK

Demanda: o cliente tem arquivo e impressão em Pantone e quer um CMYK igual ou parecido. Página **Cores spot** (`src/pages/SpotsPage.tsx`, estado em `src/state/useSpots.ts`).

- **Valor de referência.** O app **não traz a biblioteca Pantone**: ela é proprietária, e nenhum valor foi escrito de memória no código. A referência vem de (1) o PDF, quando o arquivo declara o spot com alternativo Lab; (2) digitação em Lab (D50), hexadecimal (sRGB) ou CMYK, a partir do Pantone Connect, do Color Bridge ou de uma medição do impresso com espectrofotômetro, que é a referência mais fiel. Lab é preferível: o hexadecimal é uma conversão para tela.
- **Leitura do PDF** (`src/lib/pdf/spotColors.ts`). O MuPDF informa, a cada pintura, o espaço Separation com o nome do spot e a tinta. Os recursos da página (e dos formulários dentro dela) trazem o espaço alternativo e a função de tinta; calculamos a 100% de tinta as funções tipo 2 e tipo 4 (interpretador mínimo de PostScript). Alternativo Lab: o Lab do PDF é levado ao D50 (Bradford, pelo ponto branco do próprio espaço). Alternativo CMYK: é só um **substituto aproximado**, não o valor da Pantone; o app avisa. DeviceN e funções de outros tipos ficam com aviso. Só PDF; nada em imagens.
- **Cálculo** (`src/lib/spot/spotMatch.ts`, `matchSpot`). Lab de referência → CMYK pela B2A do perfil; em seguida busca local nos quatro canais (passos de 8 a 0,25) que minimiza o ΔE00 entre a referência e a previsão da A2B; arredonda para inteiros e fica com o melhor entre a busca e a B2A pura. Limite de tinta: o maior entre 300% e o que a B2A usou. ΔE00 e veredito pelos mesmos limites (3,0 e 5,0; ver D2).
- **Fora do gamut.** Muitos laranjas, verdes e azuis vivos, e as cores metálicas e fluorescentes, não existem em CMYK. O resultado é a melhor aproximação e o ΔE00 mostra a perda; o cartão explica. Não se promete igualdade.
- **Intent.** Relativo ao papel por padrão; absoluto como opção, para um Lab de referência medido com o papel incluído. A condição em que a Pantone mede os valores dela não foi verificada: ponto aberto antes de afirmar equivalência com o Color Bridge.
- **Diferença para o CMYK publicado pela Pantone.** O CMYK calculado aqui depende do perfil escolhido e pode diferir do que o fabricante publica, que usa outra condição de impressão.
- **Exportação.** Laudo HTML (imprime ou salva em PDF) e CSV (`spotToHtml`, `spotToCsv`), com a origem do valor de cada cor.
- **Testes.** Leitor de spots com PDF de alternativo Lab e de alternativo CMYK (`scripts/gerar-fixtures-spot.py`, valores inventados, não oficiais), interpretador PostScript, cálculo com perfil de mentira e com ISO Coated v2, mensagens do Worker, exportação e verificação no Chromium.

**Segunda opção (variação próxima).** Além do CMYK de menor ΔE00, cada cor mostra um segundo CMYK: o de menor ΔE00 entre os que diferem do primeiro em pelo menos 5 pontos de tinta em algum canal (busca local a partir de oito vizinhos). Serve para imprimir as duas opções ao lado do Pantone e escolher a olho; pelo cálculo, a primeira é a melhor, e se a busca achar um vizinho melhor os dois trocam de lugar. Exemplo (ISO Coated v2): PANTONE 293 C: 100/76/0/0 (ΔE00 3,52) e 100/75/0/6 (3,80). Uma tentativa anterior, que mantinha o matiz do CIELAB, foi descartada: no teste visual do usuário (293 C no CorelDRAW) ficou arroxeada e pior que a primeira, porque o ângulo de matiz do CIELAB não acompanha o matiz percebido nos azuis. A segunda opção entra no laudo HTML e em cinco colunas novas do CSV (alt_C a alt_deltaE00).

**Arte chapada nas cores dominantes (PDF em CMYK).** O k-means com k = 8 inventava cores num arquivo com poucas tintas: as bordas de texto e de filetes geram misturas (antialiasing) entre duas tintas, que apareciam como "roxos" e "azuis claros". Agora, se as 12 cores exatas mais frequentes cobrem pelo menos 60% da tinta, o arquivo é tratado como arte chapada: as cores dominantes são as tintas chapadas, e uma cor exata é descartada como mistura quando fica sobre o segmento entre duas outras (ou entre uma tinta e o papel), com tolerância de 6 em 255, é menos frequente que as duas pontas e tem menos de 2% da tinta. Fotos e degradês não passam no teste e seguem pelo k-means. Os limites são decisões do projeto, sem base normativa. Limite conhecido: um tom pequeno (menos de 2% da tinta) entre uma tinta e o papel é tratado como borda. Testes: 261.

**Precisão das amostras e dados do laudo (18/11/2026).** (1) A cor de uma amostra agora é sempre uma cor exata do arquivo: no caminho CMYK o Lab vem do CMYK exato mais frequente do grupo (antes vinha do centro do grupo, que podia ser uma cor inexistente), e o filtro de arte chapada passou a valer também no caminho RGB. (2) O laudo mostra Lab com duas casas, o Lab impresso, ΔE00, ΔE\*ab e ΔH\*ab de cada cor (o CSV ganhou cinco colunas) e uma seção com a origem dos limites (D2). Testes: 267.

**PDF com cores spot (18/11/2026).** Num PDF com Pantone, o app dizia "o PDF já está em CMYK", o que confundia: o arquivo é spot, e o CMYK mostrado é o substituto que o arquivo guarda. Agora, depois da análise, o app lista os spots do PDF em segundo plano (`fileSpots`); se houver, as páginas Visão geral, Simulação e Amostras mostram um aviso com os nomes e o botão "Ver CMYK de cada cor", que abre Cores spot, lê os spots do PDF e já calcula. Os avisos genéricos ("já está em CMYK", "spot colors ou espaços especiais") somem nesse caso. Testes: 269.

## 1. Objetivo

Aplicação web que roda inteiramente no navegador (sem servidor e sem software proprietário) e responde, para um arquivo PDF de arte gráfica, se as cores usadas **sobrevivem a um processo de impressão de referência** (por exemplo ISOcoated_v2 / FOGRA39), com um número objetivo (ΔE00, CIEDE2000) calculado no espaço CIE L\*a\*b\*, independente do monitor de quem consulta.

Duas saídas, com naturezas diferentes:

| Saída | Depende do monitor? | Função |
|---|---|---|
| **Laudo de conformidade** (ΔE00 por amostra, veredito conforme / não conforme) | Não | Resposta objetiva e auditável |
| **Simulação visual** (soft proof) | Sim (perfil ICC do monitor, opcional) | Ajuda perceptual |

---

## 2. Decisões de projeto

| # | Decisão | Alternativa descartada | Justificativa |
|---|---|---|---|
| 1 | Entrada principal: **PDF** | JPEG/PNG/TIFF como foco | PDF é o formato real de arte final e pode trazer `/OutputIntent`. Outros formatos ficam como extensão. |
| 2 | **Amostras por clusterização** (k-means em Lab) sobre a imagem rasterizada | Parsing de content stream (cores vetoriais, spot colors) ou grade fixa de pixels | Parsing vetorial equivale a reimplementar parte de um RIP e não cabe no prazo. Grade fixa gera centenas de amostras sem significado perceptual. |
| 3 | **Fluxo A (round-trip) é o foco**; Fluxo B (referência vs. simulação) é complementar | Os dois com a mesma profundidade | Prazo de TCC. O Fluxo B reaproveita quase todo o pipeline do A. |
| 4 | Motor de cor: **lcms2 compilado para WASM** | CMM próprio em TypeScript | Perfis CMYK reais são baseados em LUT multidimensional (tags A2B/B2A), com interpolação N-dimensional. Reimplementar isso é um projeto de pesquisa em si. |
| 5 | Cálculo de cor **fora do Canvas** sempre que possível | `getImageData` como fonte de verdade | Ver limitação L1 abaixo. |
| 6 | Tolerância inspirada na ISO 12647-2, declarada como **adaptação** | Afirmar "conformidade com a ISO 12647" | Ver limitação L4 abaixo. |
| 7 | Campo "Dot gain" do mockup deve ser **removido ou informativo** | Slider editável de dot gain | O ganho de ponto já está embutido na LUT do perfil. Um slider separado indica um modelo simplificado, mais fraco que o perfil real. |

---

## 3. Arquitetura

```
PDF de entrada
   │
   ▼
Rasterização e extração de cor        (pdf.js + k-means em Lab)       [Fase 4]
   │
   ▼
Motor de cor, em Web Worker           (lcms2-wasm sobre LUT do ICC)   [Fases 3 e 5]
   │
   ├──► Fluxo A: round-trip           (foco principal)                [Fase 6]
   └──► Fluxo B: referência vs. simulação (complementar)              [Fase 7]
              │
              ▼
Laudo: ΔE00 (CIEDE2000) vs. tolerância adotada
```

**Fluxo A, em termos de ICC.** Para cada cor extraída: Lab original → perfil de saída (direção PCS→dispositivo, tag **B2A**) → valor CMYK → de volta ao Lab (direção dispositivo→PCS, tag **A2B**) → ΔE00 entre o Lab original e o Lab de volta. ΔE baixo significa que a cor está dentro do gamut do processo. ΔE alto significa que está fora e será reproduzida de forma diferente. É, na prática, uma verificação de gamut, e o resultado depende do *rendering intent* e da compensação de ponto preto escolhidos. Esses parâmetros precisam ser fixados e registrados no laudo.

**Fluxo B.** Compara as amostras de uma referência RGB com as da simulação CMYK, usando o mesmo motor. Exige alinhar as duas imagens (mesmo layout), o que o Fluxo A não exige.

---

## 4. Stack

| Categoria | Ferramenta | Papel |
|---|---|---|
| Linguagem | TypeScript | Tipagem estrita para dados binários (ArrayBuffer, TypedArrays) |
| Build / dev server | Vite | Suporte nativo a TS, Web Workers e WASM |
| UI | React | Estado compartilhado entre os painéis da interface |
| API do navegador | Canvas API | Rasterização e leitura de pixels (apenas para exibição) |
| API do navegador | Web Workers + Transferable Objects | Cálculo fora da thread principal, sem cópia de buffers |
| API do navegador | File API / ArrayBuffer / TypedArrays | Leitura local de PDF e perfis ICC |
| Terceiros | `pdfjs-dist` | Rasterização das páginas do PDF em sRGB (caminho RGB) |
| Terceiros | `mupdf` 1.28 (MuPDF em WASM, **AGPL-3.0**) | Leitura das páginas do PDF em CMYK (caminho CMYK) |
| Terceiros | `lcms-wasm` 1.0.x (Little CMS em WASM, licença MIT) | Motor de cor: abre perfis ICC e converte CMYK e Lab pelas tabelas A2B e B2A |
| Testes | Vitest; `@napi-rs/canvas` (só em desenvolvimento) | Validação numérica do núcleo; canvas em Node para rasterizar PDFs nos testes |
| Desenvolvimento | Node.js, VS Code | Apenas tooling |
| Execução | Navegador (client-side) | Runtime final |

Versões instaladas (conforme `package.json`): React 19, Vite 8, TypeScript 6, Vitest 5, pdfjs-dist 4.x, lcms-wasm 1.0.x, mupdf 1.28.

---

## 5. Estrutura do código

| Arquivo | Conteúdo | Status |
|---|---|---|
| `src/types/color.ts` | Tipos `RGB`, `XYZ`, `Lab`, `WhitePoint` e iluminantes D65 e D50 | Pronto |
| `src/core/colorimetry.ts` | `rgbToXyzD65`, `adaptBradford`, `xyzToLab`, `rgbToLabD50`, `deltaE2000` | Pronto e testado (dataset completo de 34 pares) |
| `src/core/__tests__/colorimetry.test.ts` | 54 testes (ver seção 6) | Passando |
| `src/lib/sampling/kmeans.ts` | `kmeansLab`, `kmeansLabWeighted` (k-means ponderado em Lab, inicialização determinística) | Implementado e testado (seção 8) |
| `src/lib/pdf/cmykPdf.ts` | Caminho CMYK: `inspectPdfColorUsage` (conta o que o PDF pinta em cada espaço de cor, com um dispositivo do MuPDF) e `renderPdfPagesCmyk` (página em CMYK de 8 bits, com o ICC do MuPDF desligado). O MuPDF é injetado pelo chamador. |
| `src/lib/pdf/analyzePdf.ts` | `analyzePdf`: escolhe o caminho, devolve cores, avisos e o uso de espaços de cor. `CmykProfileRequiredError` quando o PDF tem CMYK e não há perfil. Se o MuPDF não carregar, cai para RGB e avisa. |
| `src/lib/sampling/dominantCmyk.ts` | `extractDominantCmykColors`: histograma exato de cores CMYK de 8 bits, papel = 0/0/0/0, conversão para Lab em lote pelo perfil e k-means ponderado. |
| `src/lib/icc/colorEngine.ts` | `cmyk8ToLab`: conversão CMYK para Lab em lote (blocos de 32768 cores). |
| `src/core/colorimetry.ts` | `labD50ToRgbClipped`: Lab para sRGB recortado, só para desenhar amostras na tela. |
| `src/lib/sampling/dominantColors.ts` | `extractDominantColors`: histograma exato, exclusão do papel, k-means ponderado | Implementado e testado (seção 8) |
| `src/lib/icc/colorEngine.ts` | `createColorEngine`, `loadProfile`, `cmykToLab`, `labToCmyk`, `roundTripLab`, `rgbToDeviceCmyk`, `srgbToLab` (ver seção 7) | Implementado e testado em Node |
| `src/lib/icc/iccTags.ts` | Leitura do cabeçalho e das tags de texto de um perfil ICC | Implementado e testado |
| `src/lib/icc/characterization.ts` | Leitura dos dados de caracterização (CGATS) embutidos no perfil (tag `targ`) | Implementado e testado |
| `src/lib/icc/__tests__/` | 32 testes: 9 do leitor ICC, do CGATS e da codificação de 16 bits (sem arquivo externo); 13 de sRGB contra o núcleo; 9 do perfil PSO Coated v3 (ignorados se o `.icc` não estiver na máquina); 1 de arquivo inválido | Passando |
| `src/types/lcms-wasm.d.ts` | Declaração de tipos do subconjunto usado do `lcms-wasm` (o pacote não publica tipos) | Pronto |
| `src/lib/pdf/renderPdf.ts` | `renderPdfPages`, `concatPages` (PDF para pixels, com pdf.js e canvas injetados) | Implementado e testado em Node e no navegador |
| `src/lib/pdf/browserPdf.ts` | Ligação ao navegador (Worker do pdf.js, canvas do DOM) e rasterização de imagens | Implementado, verificado no navegador |
| `src/lib/pdf/outputIntent.ts` | `extractOutputIntentProfile` | Pendente (lança erro explícito) |
| `src/lib/pdf/__fixtures__/`, `scripts/gerar-fixtures-pdf.py` | PDFs de teste e o script que os gera | Pronto |
| `src/App.tsx`, `src/components/*` | Interface final (Fase 8): perfil compartilhado e abas dos Fluxos A e B (seção 8f) | Implementado e verificado no Chromium |
| `src/lib/report/export.ts` | Laudo em HTML autônomo e CSV (seção 8f) | Implementado e testado |

`src/core/` não depende de DOM, Canvas ou Workers. Entram números e saem números, o que permite testar isoladamente.

---

## 6. Fase 2: núcleo colorimétrico

### 6.1 O que foi implementado

Arquivo `src/core/colorimetry.ts`, sem dependência de DOM, Canvas ou Web Workers. Cadeia completa:

```
sRGB (0–255) ─[1]→ XYZ D65 ─[2]→ XYZ D50 ─[3]→ Lab D50 ─[4]→ ΔE00 entre duas cores Lab
```

| Etapa | Função | O que faz | Parâmetros fixos no código |
|---|---|---|---|
| 1 | `rgbToXyzD65` | Remove a curva de gama sRGB (`c/12,92` se `c ≤ 0,04045`, senão `((c+0,055)/1,055)^2,4`) e aplica a matriz sRGB → XYZ. Saída na escala 0–100. | Matriz de 7 casas decimais (primeira linha: 0,4124564 / 0,3575761 / 0,1804375). Branco implícito D65 = (95,047; 100; 108,883). |
| 2 | `adaptBradford` | Leva o XYZ ao espaço de cones (matriz de Bradford), escala cada canal pela razão entre os brancos de destino e de origem e volta ao XYZ. | Origem D65, destino D50 (padrões). Matriz inversa digitada com 7 casas, não calculada. |
| 3 | `xyzToLab` | `f(t) = ∛t` se `t > (6/29)³`, senão `t/(3·(6/29)²) + 4/29`. Depois `L* = 116·f(Y/Yn) − 16`, `a* = 500·(f(X/Xn) − f(Y/Yn))`, `b* = 200·(f(Y/Yn) − f(Z/Zn))`. | Branco D50 = (96,422; 100; 82,521). |
| 4 | `deltaE2000` | CIEDE2000 conforme Sharma, Wu & Dalal (2005): G, a′, C′, h′, ΔL′, ΔC′, ΔH′, T, Δθ, R_C, S_L, S_C, S_H, R_T. Trata os casos limite (croma zero, descontinuidade do ângulo de matiz). | `kL = kC = kH = 1`, não parametrizáveis. |

`rgbToLabD50` é o atalho das etapas 1 a 3.

**Convenções e pontos de atenção**

- **Entrada:** RGB de 8 bits, interpretado como sRGB sem perfil embutido. Não há validação de faixa nem arredondamento: valores fora de 0–255 são aceitos e propagados.
- **Matriz sRGB:** a de 7 casas é uma variante de alta precisão amplamente publicada. A IEC 61966-2-1 publica a versão de 4 casas (0,4124 / 0,3576 / 0,1805 ...), que é a usada pelo colour-science. A maior diferença entre coeficientes é de ≈ 2×10⁻⁴. O comentário em `colorimetry.ts` atribui a matriz de 7 casas à especificação IEC, e isso deve ser ajustado para "variante de alta precisão".
- **Branco D50:** o ICC define o D50 do PCS como (0,9642; 1,0; 0,8249), em 4 casas. O núcleo usa (96,422; 100; 82,521). A diferença relativa em Z é ≈ 0,04 %, pequena, mas na Fase 3 o núcleo e o motor lcms2 precisam usar **a mesma definição de branco**, e ela deve ser registrada.
- **CIEDE2000 com `kL = kC = kH = 1`:** condição de referência da fórmula. Os fatores não são expostos.

### 6.2 Validação

Resultado: **54 de 54 testes passando** (Vitest 5.0.4).

| Grupo | Testes | O que cobre |
|---|---|---|
| CIEDE2000, dataset completo de Sharma, Wu & Dalal (2005) | 34 | Todos os 34 pares da Tabela 1, com 4 casas decimais |
| Propriedades do CIEDE2000 | 3 | Contagem e numeração do dataset, simetria ΔE(A,B) = ΔE(B,A) nos 34 pares, ΔE(A,A) = 0 |
| Pipeline sRGB → XYZ → Bradford → Lab (propriedades) | 7 | Branco (L\*≈100, croma≈0), preto (L\*≈0), Bradford com origem igual ao destino, Bradford leva D65 exatamente a D50, consistência do branco de referência, cinza 128 (L\*≈53,585), rampa de cinzas (croma≈0 e L\* crescente) |
| Pipeline contra implementação independente | 10 | Vermelho, verde, azul, amarelo, ciano, magenta, cinza 18%, laranja, marrom e verde escuro, comparados com colour-science 0.4.7 |

**Como os valores de referência foram conferidos**

- Os 34 pares e seus ΔE00 esperados foram comparados com uma implementação independente (colour-science 0.4.7, Python): **0 divergências** no nível de 4 casas decimais.
- As 10 cores do pipeline têm Lab de referência gerado pelo colour-science (sRGB com decodificação de gama, adaptação de Bradford para D50, Lab em D50). O script está no Apêndice A.
- A comparação do pipeline é feita em ΔE00 com limiar de **0,05**, não por casas decimais. As duas implementações usam matrizes sRGB diferentes: a do projeto tem 7 casas e a do colour-science, 4 casas (ver 6.1). Isso produz diferenças de 0,01 a 0,03 em a\*/b\* para cores saturadas. O limiar de 0,05 está muito abaixo do limiar perceptível (≈ 1).
- A tolerância do teste de Bradford com origem igual ao destino é de 4 casas decimais, porque matriz e inversa não são exatas em ponto flutuante (erro ≈ 1×10⁻⁶ em XYZ).

**A suíte detecta defeitos (teste de mutação).** Três defeitos foram introduzidos de propósito no código e revertidos em seguida:

| Defeito introduzido | Testes que falharam |
|---|---|
| Coeficiente 0,17 → 0,18 no termo T do CIEDE2000 | 28 |
| Remoção do ajuste da descontinuidade do ângulo de matiz | 4 (pares 16, 17, 19 e o teste de simetria) |
| Erro em um coeficiente da matriz sRGB → XYZ | 8 |

A suíte anterior (12 testes, só 6 pares) **passava com o defeito da descontinuidade de matiz**, o que mostra que a cobertura parcial deixava passar um erro real.

### 6.3 Evidência de execução

| Ambiente | Resultado |
|---|---|
| Máquina do desenvolvedor (Windows, PowerShell), 13/10/2026 | `Test Files 1 passed (1)`, `Tests 54 passed (54)`, duração 207 ms, Vitest 5.0.4 |
| Ambiente Linux em que o código foi gerado | 54 testes passando, Vitest 5.0.4 |

Para repetir: `npm test`, na pasta que contém o `package.json`. A saída do terminal pode ser usada como figura na monografia.

### 6.4 Limites que continuam valendo

- O pipeline é validado apenas para **sRGB assumido** (sem perfil embutido). Nada aqui valida conversão por perfil ICC, que é a Fase 3.
- A referência independente é outro software (colour-science), não instrumento de medição.
- O CIEDE2000 é validado para `kL = kC = kH = 1`. Outros valores desses fatores não foram testados porque não são expostos.

---

## 7. Fase 3: motor de cor (lcms-wasm)

### 7.1 Escolha do pacote

Foi escolhido o `lcms-wasm` (Little CMS compilado para WASM, licença MIT, assim como o Little CMS embutido). Funciona em navegador, Node.js e Web Workers e expõe a API do lcms2 de forma direta (`cmsOpenProfileFromMem`, `cmsCreateTransform`, `cmsDoTransform`). Alternativas consideradas:

- **jsColorEngine:** motor ICC em JavaScript que declara ser mais rápido que o lcms-wasm. Não é o lcms2, e a justificativa do projeto é usar o CMM de referência da indústria. A afirmação de desempenho é do próprio projeto e não foi verificada aqui.
- **node-lcms:** envolve o utilitário `transicc` e exige o LittleCMS instalado na máquina. Só funciona em Node.

Riscos assumidos: é um pacote pequeno, com um mantenedor, o que deve ser registrado como risco de dependência. Ele não publica tipos TypeScript (por isso existe `src/types/lcms-wasm.d.ts`). O wrapper só aceita amostras de 8 bits, 16 bits ou `Float32`, e o projeto usa 16 bits. No Vite, o arquivo `.wasm` precisa ser localizado com `import ... from 'lcms-wasm/dist/lcms.wasm?url'`.

### 7.2 O que foi implementado

| Função | Operação |
|---|---|
| `createColorEngine({ wasmUrl })` | Instancia o WASM. Em Node, `wasmUrl` é omitido. |
| `engine.loadProfile(bytes)` | Valida o arquivo (cabeçalho ICC, espaço CMYK) e abre o perfil no lcms2. |
| `profile.cmykToLab(cmyk, intent)` | CMYK (%) para Lab, pela tabela **A2B** |
| `profile.labToCmyk(lab, intent)` | Lab para CMYK (%), pela tabela **B2A** |
| `profile.roundTripLab(lab, intent)` | Lab → CMYK (B2A) → Lab (A2B), o round-trip do Fluxo A |
| `profile.rgbToDeviceCmyk(rgb, intent)` | sRGB para CMYK (%), para soft proofing |
| `engine.srgbToLab(rgb)` | sRGB para Lab D50 pelo lcms2, para conferir o núcleo (`src/core`) |

Os cálculos usam amostras de 16 bits (`CMYK_16`, `Lab_16`). A quantização do Lab de 16 bits é de cerca de 0,0015 em L\* e 0,0039 em a\* e b\*. A compensação de ponto preto está desligada (`flags = 0`). O rendering intent é parâmetro explícito, com padrão `relative`.

### 7.3 Perfil testado e dados de caracterização

O perfil principal usado foi o **PSO Coated v3**, da ECI: ICC v2.4, classe impressora (`prtr`), dados CMYK, espaço de conexão Lab, com as tabelas A2B0 a A2B2 e B2A0 a B2A2. A tag `targ` do próprio perfil traz os dados de caracterização **FOGRA51** (alvo ISO 12642-2, 1617 patches com CMYK, XYZ e Lab, medição D50, 2°, geometria 45/0, M1, base branca, papel premium coated). Esses dados serviram de referência sem exigir arquivo externo.

### 7.4 Resultados

Todos os valores em ΔE00. Média, percentil 95 e máximo sobre os 1617 patches. A tabela abaixo é do **PSO Coated v3 (FOGRA51)**; os resultados do ISO Coated v2 estão na seção 7.4.1.

| Verificação | Média | p95 | Máx |
|---|---|---|---|
| A2B com intent **absoluto** contra o Lab de caracterização | 0,10 | 0,25 | 0,66 |
| A2B com intent relativo contra o mesmo Lab (medição exploratória) | 3,45 | 5,42 | 6,72 |
| A2B com intent perceptual contra o mesmo Lab (medição exploratória) | 4,18 | 7,60 | 13,36 |
| Round-trip Lab → CMYK → Lab, intent relativo | 0,39 | 1,60 | 3,75 |
| Round-trip Lab → CMYK → Lab, intent absoluto | 0,33 | 1,16 | 2,84 |

Outras conferências:

- **Papel e sólidos:** papel L\* 95,00, a\* 1,50, b\* −6,03 (tabela: 95, 1,5, −6). Ciano, magenta, amarelo e preto 100% coincidem com a tabela em até 0,02 em cada canal.
- **sRGB: lcms2 contra o núcleo (`src/core`):** em 13 cores, a maior diferença foi ΔE00 = 0,016 (marrom). Isso **resolve a pendência L8**: a diferença entre o branco D50 do núcleo (Z = 82,521) e o do ICC (Z = 0,8249) não tem efeito perceptível.
- **sRGB para CMYK (sanidade):** branco resulta em 0/0/0/0. Preto resulta em C 84,5, M 68,0, Y 51,5, K 96,0, cerca de 300% de tinta total, coerente com o limite do perfil.

Os limites dos testes automatizados são guarda contra regressão, definidos com folga sobre estes valores. Não são tolerâncias da norma.

#### 7.4.1 ISO Coated v2 (ECI), caracterização FOGRA39

Mesmo procedimento, com o `ISOcoated_v2_eci.icc` (descrição "ISO Coated v2 (ECI)"). A tag `targ` traz 1617 patches, descritor `FOGRA39L`, ISO 12642-2, medição D50, 2°, geometria 45/0, sem filtro de polarização, base branca, conforme ISO 13655. No arquivo deste perfil o descritor está na chave `DESCRIPTOR` (no PSO Coated v3 é `FILE_DESCRIPTOR`); o leitor aceita as duas.

| Verificação | Média | p95 | Máx |
|---|---|---|---|
| A2B com intent **absoluto** contra o Lab de caracterização | 0,06 | 0,12 | 0,58 |
| A2B com intent relativo contra o mesmo Lab | 2,66 | 3,30 | 3,52 |
| Round-trip Lab → CMYK → Lab, intent relativo | 0,29 | 1,19 | 4,43 |
| Round-trip Lab → CMYK → Lab, intent absoluto | 0,34 | 1,18 | 3,58 |

Papel e sólidos C, M, Y e K em intent absoluto coincidem com a tabela em até ΔE00 0,09. Os dois perfis levam à mesma conclusão: só o intent absoluto reproduz os dados de caracterização, e o round-trip tem piso de erro de até cerca de 4 ΔE00 nos casos extremos.

### 7.5 Conclusões e decisões

1. **O rendering intent muda o resultado.** Os dados de caracterização são Lab absoluto, e só o intent absoluto os reproduz. Comparar contra alvos da norma exige intent absoluto. Para cores derivadas de sRGB, em que o branco é L\* = 100, o intent relativo é o coerente. A escolha para o laudo é uma **decisão de projeto em aberto** e deve constar na metodologia.
2. **O round-trip tem um piso de erro.** Mesmo para cores que o processo reproduz, a volta pela tabela B2A não devolve o Lab original exatamente, com desvios de até 3,8 ΔE00 nos patches de caracterização. O limiar de aprovação do laudo precisa ser pensado acima desse piso, ou o sistema reprova cores aceitáveis.
3. **Licença do perfil.** O aviso de direitos embutido no perfil diz que ele pode ser usado, embutido e trocado sem restrição, mas não pode ser distribuído, vendido ou alterado sem permissão escrita da ECI. Por isso os arquivos `.icc` ficam fora do Git (`*.icc` no `.gitignore`). Se a aplicação publicada servir o perfil aos usuários, isso precisa de permissão da ECI, ou o perfil deve ser fornecido pelo usuário.

### 7.6 Limites que continuam valendo

- A referência dos testes é o dado do **criador do perfil**. Não é validação independente. A conferência com ArgyllCMS (`xicclu`) continua pendente.
- Foram testados dois perfis (PSO Coated v3 e ISO Coated v2). Outras condições de impressão não foram avaliadas.
- Os testes automatizados rodam em Node. O build de produção compila e empacota o `.wasm`, mas o carregamento no navegador foi verificado (teste provisório da época, depois substituído pela interface da Fase 8) e dentro de um **Web Worker** na Fase 5 (seção 8b).
- Só perfis CMYK de saída são aceitos. Perfil de monitor entra em fase posterior.

---

## 8. Fase 4: extração de cor do PDF

### 8.1 Decisão: caminho híbrido

Cada página é rasterizada e as cores são lidas dos pixels. Isso captura tudo o que aparece (imagens, vetores, texto, transparências) com um único caminho de código, e é a decisão registrada desde o planejamento, em lugar de interpretar o content stream. Mas o pdf.js entrega sRGB: cores CMYK chegam convertidas por uma fórmula aproximada, sem perfil ICC (medido na seção 8.4, desvio de 3,7 a 10,9 ΔE00 contra o perfil).

Como o ambiente de uso do sistema é CMYK, foi adotado o **híbrido**:

- **PDF sem CMYK pintado:** caminho RGB, pdf.js rasteriza em sRGB (exato para cores RGB).
- **PDF com CMYK pintado:** caminho CMYK, o MuPDF (WASM) compõe a página direto em CMYK, os números C, M, Y, K do arquivo são lidos sem passar por RGB e o perfil ICC escolhido os leva a Lab (seção 8.5).

A escolha do caminho é automática (`analyzePdf`), por inspeção dos espaços de cor que o arquivo realmente pinta. A recomendação da L1 (o Canvas não é fonte de verdade do laudo) continua valendo para o caminho RGB.

### 8.2 O que foi implementado

| Arquivo | Função |
|---|---|
| `src/lib/pdf/renderPdf.ts` | `renderPdfPages`: pdf.js e canvas injetados pelo chamador (funciona no navegador e em Node). Papel branco opaco, escala padrão 1,5 (cerca de 108 dpi), limite de 4 milhões de pixels por página (a escala é reduzida se passar), limite de 10 páginas. Copia o buffer de entrada, porque o pdf.js assume a posse dele. |
| `src/lib/pdf/browserPdf.ts` | Ligação ao navegador: Web Worker do próprio pdf.js (empacotado pelo Vite) e canvas do DOM; também rasteriza imagens (PNG, JPEG), com fundo branco. |
| `src/lib/sampling/dominantColors.ts` | `extractDominantColors`: histograma **exato** de cores RGB distintas (sem quantização), exclusão do papel (L\* ≥ 99) e dos pixels transparentes, conversão para Lab D50 e k-means ponderado. Devolve, por cor: Lab do centróide, a cor RGB real mais frequente do cluster, fração dos pixels de tinta, fração de todos os pixels e dispersão. |
| `src/lib/sampling/kmeans.ts` | Reescrito: k-means **ponderado** em Lab, com inicialização determinística no estilo k-means++ (primeira cor = a de maior peso; as seguintes maximizam peso x distância²). Mesma entrada, mesma saída. Resolve a L7. |
| `scripts/gerar-fixtures-pdf.py` | Gera os PDFs de teste: retângulos de cor e área conhecidas em RGB e em CMYK, um PDF misto e duas imagens CMYK (Flate e JPEG). |
| `src/components/PdfColorTest.tsx` (removido na Fase 8) | Teste provisório no navegador: perfil `.icc` (opcional até o PDF precisar) e PDF ou imagem; mostra o caminho usado, os avisos e as cores dominantes. |

A **dispersão** de cada cor é o ΔE00 médio entre os pixels do cluster e o centróide. Ela indica se o centróide representa uma cor que existe no arquivo (dispersão 0 em cores sólidas) ou se junta cores diferentes, como num degradê ou numa fotografia.

O papel é descartado porque a folha em branco costuma ocupar boa parte da página e não é tinta. A fração de papel é reportada à parte (`paperPixels`). O limite L\* ≥ 99 é decisão de projeto: um tom muito claro, como um cinza de L\* 93, continua contando como tinta.

### 8.3 Testes

Ao todo, 159 testes no projeto (123 sem os `.icc` locais, 36 ignorados). Novos nesta fase:

- `kmeans.test.ts` (8): grupos distantes com pesos e centróides corretos, pesos somando 1, equivalência entre peso e repetição, determinismo, k maior que o número de cores, dispersão, cor minoritária (0,1%) não engolida por uma majoritária.
- `dominantColors.test.ts` (8): papel, frações de tinta e de pixels, centróide de cor sólida igual ao Lab da cor, tom claro que não é papel, transparência, imagem só de papel, buffer inválido, determinismo.
- `renderPdf.test.ts` (caminho RGB): tamanho por escala, limite de pixels, buffer do chamador preservado, fundo branco, as seis cores de um PDF RGB com 12,5% da página cada e RGB exato, e o desvio do CMYK do pdf.js (8.4).
- `cmykPdf.test.ts` (13, dois deles ligados ao perfil local): detecção de CMYK, RGB, misto e imagem CMYK; leitura exata dos números do arquivo (vetores, imagem Flate e imagem JPEG); papel 0/0/0/0; escala e limite de pixels; PDF com perfil embutido (ICCBased) montado na hora com o `.icc` local; o ICC do MuPDF volta a ficar ligado depois da leitura.
- `dominantCmyk.test.ts`: estatística com conversor falso e, com cada perfil, conversão em lote igual à conversão cor a cor (ΔE00 < 0,01, inclusive em mais de um bloco).
- `analyzePdf.test.ts`: escolha do caminho, erro sem perfil, queda para RGB se o MuPDF falhar, as seis cores CMYK com o Lab do perfil e 12,5% cada, comparação direta com o caminho do pdf.js, PDF misto, imagem CMYK em JPEG.
- `colorimetry.test.ts`: +2 testes de `labD50ToRgbClipped`.

Também foi conferido **no navegador** (Chromium via Playwright, build de produção): os PDFs de teste dão os mesmos resultados que em Node; um PDF CMYK sem perfil pede o perfil e, ao escolhê-lo, é reanalisado sozinho; o PDF misto avisa; PNG funciona. Tempos medidos de ponta a ponta numa página A4 com fotografia: 0,9 s em RGB (282 mil cores distintas) e 1,9 s em CMYK (852 mil cores distintas), incluindo a primeira carga do MuPDF. O tempo não separa renderização e clusterização; a medição de desempenho é da Fase 5.

### 8.4 Resultado: o CMYK do pdf.js não bate com o perfil

Nos PDFs de teste, cada cor CMYK (operador `k` do PDF, sem perfil) foi rasterizada e comparada com a conversão do perfil ICC (intent relativo). ΔE00 entre o sRGB que o pdf.js entrega e o Lab do perfil:

| CMYK (%) | pdf.js (sRGB) | ΔE00, ISO Coated v2 | ΔE00, PSO Coated v3 |
|---|---|---|---|
| 100/0/0/0 (ciano) | 0, 185, 242 | 10,9 | 9,8 |
| 0/100/0/0 (magenta) | 251, 49, 153 | 6,7 | 6,7 |
| 0/0/100/0 (amarelo) | 255, 235, 61 | 3,8 | 4,0 |
| 0/0/0/100 (preto) | 44, 46, 53 | 5,2 | 6,0 |
| 40/70/0/10 | 141, 92, 164 | 6,4 | 5,9 |
| 0/50/100/0 | 255, 144, 39 | 4,5 | 3,7 |

Os desvios ficam entre 3,7 e 10,9, acima do piso do round-trip (L9) e do que se costuma usar como tolerância. O PDF não declara perfil, então o "valor correto" depende da interpretação; aqui se usou o perfil de impressão alvo, que é o que o Fluxo A pretende simular. A conversão do pdf.js é uma fórmula de uso geral para exibição em tela. O ciano e o magenta ainda estão fora do gamut do sRGB, o que explica parte do desvio.

Foi verificado no `getOperatorList` do pdf.js que o CMYK já vem convertido para RGB (operador `setFillRGBColor`): **não há como recuperar o CMYK original pela API do pdf.js**, nem para vetores nem, em geral, para imagens.

### 8.5 O caminho CMYK (MuPDF)

O MuPDF compõe a página direto num pixmap CMYK de 8 bits (255 = 100% de tinta; papel = 0/0/0/0). Nos PDFs de teste os valores lidos são exatamente os do arquivo (40/70/0/10 % vira 102/178/0/25; imagens CMYK em Flate e em JPEG saem sem conversão). Resultado contra o perfil, nas mesmas seis cores da seção 8.4:

| Caminho | Desvio contra o perfil (ΔE00, intent relativo) |
|---|---|
| pdf.js (sRGB) | 3,7 a 10,9 |
| MuPDF (CMYK lido do arquivo) | < 0,25 (só o arredondamento a 8 bits: 70% vira 69,8%) |

**Achado: o ICC do MuPDF precisa ficar desligado.** Num PDF que declara um perfil CMYK embutido (ICCBased), o MuPDF com ICC ligado converte os valores para o seu CMYK padrão e os números do arquivo se perdem (medido com o ISO Coated v2 embutido: ciano 100% virou 255/31/4/0 e preto 100% virou 177/169/171/200). Com `disableICC()` durante a leitura, os números saem como estão no arquivo. A consequência de projeto: **o perfil embutido no PDF é ignorado e os números CMYK são interpretados pelo perfil que o usuário escolheu**, que é o que o Fluxo A pretende simular. A biblioteca é religada ao fim de cada leitura (estado global), e há teste para isso.

**Licença.** O MuPDF é AGPL-3.0 (há licença comercial da Artifex). Distribuir o sistema com ele obriga a disponibilizar o código-fonte do sistema sob termos compatíveis. Para um TCC com repositório aberto isso é viável, mas é uma decisão do autor, e deve ser registrada no trabalho (L14). O WASM tem cerca de 10 MB (4,8 MB comprimido) e só é baixado quando um PDF é analisado.

**Como o caminho é escolhido.** `inspectPdfColorUsage` percorre a página com um dispositivo do MuPDF e conta o que é pintado em CMYK, RGB, cinza e outros (degradês, spot). Basta pintar algo em CMYK para escolher o caminho CMYK.

### 8.6 Limites que continuam valendo

- **PDF misto (CMYK e RGB):** os elementos RGB são convertidos para CMYK pelo MuPDF, sem perfil, então suas cores são aproximadas. O sistema avisa (L15). Cinza (DeviceGray) também é convertido pelo MuPDF.
- **Intent:** a conversão CMYK para Lab usa o intent relativo por padrão. A escolha para o laudo continua em aberto (L10).
- **Oito bits:** o pixmap tem 8 bits por canal (passo de 0,39% de tinta), o que custa até cerca de 0,2 ΔE00.
- **Antialiasing:** bordas de formas e imagens redimensionadas geram cores intermediárias que aparecem como pequenos clusters (por exemplo 0,5% do ciano a 0,2% de cores mistas ao lado de uma imagem). O número de clusters e um filtro de participação mínima precisam ser definidos para arquivos reais.
- **Fotografias e degradês** geram clusters de dispersão alta (7 a 12 ΔE00 numa foto CMYK de teste): a "cor dominante" ali é uma média. O laudo deve usar a dispersão para sinalizar isso.
- **Overprint e transparência** seguem o que o MuPDF compõe; não foram testados com PDFs reais.
- **Spot colors e degradês** são lidos como o MuPDF os converte. O sistema avisa quando existem.
- **Os PDFs de teste são sintéticos.** Falta testar com PDFs reais de produção (InDesign, Illustrator, Canva).
- Leitura do `/OutputIntents` (L6) continua não implementada. `outputIntent.ts` mantém o erro explícito.
- O limite de 10 páginas e de 4 milhões de pixels por página continua valendo; a Fase 5 moveu o trabalho para um Web Worker e mediu os tempos (seção 8b), mas não mediu PDFs reais grandes.

---

## 8b. Fase 5: Web Worker e desempenho

### 8b.1 Arquitetura

Toda a análise (pdf.js, MuPDF, lcms-wasm, clusterização) roda em **um Web Worker de módulo** (`worker.format: 'es'` no Vite, porque o MuPDF usa top-level await e o formato padrão `iife` não aceita). A thread principal só recebe progresso e resultado.

| Arquivo | Papel |
|---|---|
| `src/lib/analysis/protocol.ts` | Mensagens entre a página e o Worker (`loadProfile`, `analyzePdf`, `analyzeImage` e as respostas `profileLoaded`, `progress`, `result`, `error`) |
| `src/lib/analysis/analysisHandler.ts` | Lógica do Worker sem depender do navegador (testável em Node). Processa as mensagens **em série**, então um `loadProfile` sempre termina antes da análise seguinte |
| `src/lib/analysis/analysisClient.ts` | Lado da página: promessas, progresso por etapa, `cancel()` (encerra o Worker e rejeita o que estava pendente; o perfil é reenviado ao Worker novo) |
| `src/workers/analysis.worker.ts` | Liga o handler ao navegador: `OffscreenCanvas`, Worker interno do pdf.js, `.wasm` do lcms por URL, `import('mupdf')` sob demanda, imagens por `createImageBitmap` |
| `src/lib/analysis/browserAnalysis.ts` | Cria o Worker (`new Worker(new URL(...), { type: 'module' })`) |

O PDF é enviado ao Worker como **cópia transferida** (o `ArrayBuffer` do chamador não é desanexado). `analyzePdf` passou a devolver `timings` (inspeção, leitura das páginas, agrupamento, total) e a avisar a etapa (`inspecting`, `rendering`, `clustering`).

### 8b.2 Verificação

- 15 testes novos em Node (`src/lib/analysis/__tests__/analysis.test.ts`), com um Worker de mentira que copia as mensagens como um Worker real: ordem das etapas, perfil obrigatório (`CmykProfileRequiredError` reconstruído do outro lado), perfil inválido, imagens, erro de uma análise sem derrubar a seguinte, ordem `loadProfile` antes da análise, cancelamento com reenvio do perfil, buffer do chamador preservado.
- **No Chromium (Playwright, build de produção):** pdf.js, MuPDF e lcms-wasm funcionam dentro do Worker, sem erros no console. PDF RGB: 6 cores de 12,5 % cada; PDF CMYK sem perfil pede o perfil; com ISO Coated v2 é reanalisado sozinho e dá os mesmos valores da versão na thread principal (CMYK 100/0/0/0 → Lab 58,2 / −38,7 / −50,3).

### 8b.3 Tempos medidos

Node 22 (sandbox), perfil ISO Coated v2 carregado, PDFs sintéticos A4 com 60 retângulos coloridos por página, k = 8, uma execução por caso (primeira chamada inclui carga do MuPDF/pdf.js, por isso varia). Os PDFs de teste ficam em `.bench/` (fora do Git).

| PDF | scale | caminho | total (ms) | inspeção | leitura | agrupamento |
|---|---|---|---|---|---|---|
| RGB, 1 pág. | 1 | pdf.js | 186 | 79 | 87 | 20 |
| RGB, 1 pág. | 2 | pdf.js | 74 | 2 | 23 | 49 |
| RGB, 10 pág. | 1 | pdf.js | 226 | 21 | 61 | 144 |
| RGB, 10 pág. | 2 | pdf.js | 525 | 9 | 134 | 382 |
| CMYK, 1 pág. | 1 | MuPDF | 62 | 2 | 8 | 53 |
| CMYK, 1 pág. | 2 | MuPDF | 68 | 4 | 19 | 45 |
| CMYK, 10 pág. | 1 | MuPDF | 166 | 6 | 31 | 129 |
| CMYK, 10 pág. | 2 | MuPDF | 554 | 4 | 106 | 443 |

Leitura: com gráficos vetoriais simples o custo dominante é a **clusterização** (cresce com o número de cores distintas e de páginas), não a leitura. Nos testes anteriores com fotografia A4 (282 mil a 852 mil cores distintas) o total foi de 0,9 s a 1,9 s. Estes números são de um ambiente e de PDFs sintéticos; **não** valem como desempenho em PDFs reais.

### 8b.4 Limites

- O cancelamento encerra o Worker inteiro; o próximo uso paga de novo a carga do WASM.
- A medição da thread principal (travamento da interface com e sem Worker) **não foi feita** de forma quantitativa; o ganho é estrutural (nada pesado roda na thread principal).
- Os limites de 10 páginas e 4 milhões de pixels por página seguem provisórios. Falta medir PDFs reais grandes e o uso de memória.

---

## 8c. Decisões de projeto tomadas em 17/11/2026

Decididas pelo autor com base nas medições das seções 7.4 e 8b. São escolhas de projeto, não valores da norma.

**D1. Rendering intent (L10).** Fluxo A (cor de PDF/sRGB, ida e volta pelo perfil): **relativo colorimétrico**. Fluxo B (CMYK contra os valores de referência da condição de impressão): **absoluto**, porque os dados de caracterização são Lab absoluto. Compensação de ponto preto (BPC): **desligada**, confirmada pela medição da Fase 6 (seção 8d.2).

**D2. Limiar de ΔE00 do veredito (L4, L9), revisado em 18/11/2026 com base na norma.** Três faixas: **aprovado ≤ 3,0**; **atenção de 3,0 a 5,0**; **reprovado > 5,0**; na simulação (Fluxo B), a média das regiões acima de **2,5** também impede o "aprovado". Antes eram 3,0 e 4,0, só decisão de projeto.

Origem dos números (consultados em 18/11/2026; as normas ISO são pagas e o texto completo não foi lido, então os valores vêm de fontes que os reproduzem):

| Valor | O que é | Fonte |
|---|---|---|
| 3,0 | ΔE\*00 máximo dos sólidos de cores primárias e de cores spot, prova contratual (ISO 12647-7:2016) | Fogra/bvdm, *MediaStandard Print 2018*, Tabelas 30 e 31 |
| 5,0 | ΔE\*00 máximo de todos os patches e P95 (ISO 12647-7:2016) | idem |
| 2,5 | ΔE\*00 médio de todos os patches (ISO 12647-7:2016) | idem |
| ΔE\*ab ≤ 5 | desvio de sólidos em tiragem (ISO 12647-2:2013), **normativo**; os valores em ΔE\*00 da mesma tabela (K 5; C, M, Y 3,5; flutuação 4 e 2,8) são **apenas informativos** | idem, Tabela 20; conferido em Typos, *Production Parameters and their Tolerances* (2019) |

O que é decisão do projeto: a faixa "atenção" entre 3,0 e 5,0 (a norma define limites de aprovação, não essa faixa) e usar o critério de prova (ISO 12647-7), o mais próximo do que o programa calcula (desvio entre a cor pedida e a que a condição de impressão reproduz), em vez do critério de tiragem (ISO 12647-2), que compara impresso medido com os valores-alvo. A norma avalia material impresso e medido com espectrofotômetro; o programa é uma simulação numérica, e o laudo traz ΔE\*ab e ΔH\*ab apenas como informação. Um artigo de Habekost (2013, *International Circular of Graphic Education and Research*, nº 6) também apresenta limites em ΔE\*00, mas são propostas do autor, não de norma. O piso de erro do round-trip (patches de caracterização, intent relativo) continua abaixo do corte de 5,0 em praticamente todos os casos dentro do gamut. Perda de gamut real é bem maior (sRGB verde puro 18 ΔE00, azul 14 a 16, ciano 14, vermelho 5 a 6, laranja 2,6 a 2,7; cinza 50 % 0,1).

Referências: FOGRA; BVDM. *MediaStandard Print 2018*. Disponível em: bvdm-online.de (arquivo MediaStandard_Print_2018.pdf). TYPOS. *Production Parameters and their Tolerances*, 1 mar. 2019. Disponível em: typos.cz. ISO 12647-2:2013 e ISO 12647-7:2016 (texto completo não consultado).

**D3. Licença do projeto (L14).** **AGPL-3.0** para o projeto inteiro (arquivo `LICENSE`), por causa do MuPDF. As demais dependências principais (lcms-wasm, MIT; pdf.js, Apache-2.0) foram conferidas só de forma geral quanto à compatibilidade. O autor não é jurista; para uso comercial seria preciso licença comercial da Artifex ou trocar o MuPDF. Os perfis `.icc` da ECI continuam fora do repositório e não são cobertos por esta licença.

---

## 8d. Fase 6: Fluxo A (round-trip e laudo)

### 8d.1 O que foi implementado

| Arquivo | Papel |
|---|---|
| `src/core/verdict.ts` | `classifyDeltaE` (aprovado ≤ 3,0; atenção ≤ 5,0; reprovado acima, limites inclusivos), `MEAN_DELTA_E_MAX` (2,5) e `worstVerdict` |
| `src/lib/report/flowA.ts` | `evaluateFlowA(analysis, profile)`: para cada cor dominante, faz Lab de origem → CMYK (B2A) → Lab (A2B), calcula ΔE00 e classifica; o veredito geral é o pior entre as cores |
| `src/lib/icc/colorEngine.ts` | nova opção `blackPointCompensation` em `loadProfile` (padrão desligada) |
| `src/lib/analysis/*` | o Worker devolve o laudo junto com a análise (`report`), que é `null` sem perfil carregado |
| `src/components/PdfColorTest.tsx` (removido na Fase 8; ver 8f) | tabela do laudo na tela; trocar o perfil reanalisa o último arquivo |

Como cada caminho é avaliado:

- **Caminho RGB (cor de tela):** o Lab de origem é o sRGB convertido pelo núcleo. O ΔE00 do round-trip mede o quanto a condição de impressão reproduz a cor (perda de gamut). É o caso principal do Fluxo A.
- **Caminho CMYK (números lidos do arquivo):** o Lab de origem é o que o perfil prevê para o CMYK (A2B). O round-trip confere se a cor é reprodutível (fica no piso de erro, L9). Informa-se também o ΔE00 de **exibição em tela** (Lab → sRGB recortado → Lab), que **não entra no veredito**: é limitação do monitor, não da impressão.
- A coluna "CMYK reproduzido" vem da B2A e pode diferir da separação original (K 100% vira um preto composto de 77/68/65/81 no ISO Coated v2). A comparação é de cor, não de percentuais de tinta.

### 8d.2 Medição da compensação de ponto preto (BPC)

Round-trip Lab → CMYK → Lab, intent relativo, ΔE00 (média / p95 / máx):

| Conjunto | ISO Coated v2, sem BPC | ISO Coated v2, com BPC | PSO Coated v3, sem BPC | PSO Coated v3, com BPC |
|---|---|---|---|---|
| 1617 patches de caracterização | 0,29 / 1,19 / 4,43 | 0,11 / 0,29 / 0,81 | 0,39 / 1,60 / 3,75 | 0,17 / 0,85 / 1,97 |
| 216 cores sRGB (grade 6×6×6) | 6,51 / 17,39 / 19,36 | 5,85 / 17,49 / 19,42 | 6,41 / 17,29 / 20,07 | 5,63 / 17,36 / 20,18 |
| sRGB escuras (L\* < 25, n = 20) | 7,25 / 13,16 / 13,16 | 3,34 / 10,68 / 10,68 | 8,04 / 14,63 / 14,63 | 3,32 / 10,92 / 10,92 |

Preto sRGB (L\* 0): sem BPC o round-trip volta em L\* 10,8 (ISO) e 14,7 (PSO), ΔE00 7,6 e 9,2; com BPC volta em L\* 0,7 e 1,0, ΔE00 0,6 e 3,3.

**Leitura e decisão.** Com BPC o erro do método cai (patches: p95 de 1,2 para 0,3 no ISO), mas isso acontece porque a ida e a volta se compensam: o preto "volta" quase em zero **mesmo que a impressão nunca chegue a esse preto**. Para o veredito, que pergunta se a cor impressa se parecerá com a de origem, isso esconderia uma perda real (o preto impresso é bem mais claro que o da tela). Por isso o padrão fica **BPC desligado**. O BPC seria adequado para exibição na tela (soft proofing visual), não para o veredito. Um teste automatizado (`flowA.test.ts`) fixa essa conclusão.

### 8d.3 Resultados nos PDFs de teste (ISO Coated v2)

PDF RGB (6 cores sólidas): 5 aprovadas (ΔE00 de 0,09 a 2,73) e o azul sRGB 30/60/200 reprovado (9,66, fora do gamut do offset); veredito geral: reprovado. PDF CMYK: todas aprovadas (0,22 a 0,72); o ciano 100% aparece com ΔE00 de 9,36 na tela, informativo. Verificado no Chromium, inclusive a reanálise ao trocar para o PSO Coated v3.

### 8d.4 Limites

- É uma **simulação numérica** (L4), não laudo ISO 12647. Os limites de ΔE00 são decisão de projeto (D2) e as tolerâncias numéricas da norma continuam não verificadas.
- O round-trip compara cores isoladas; não avalia cobertura de tinta total, sobreposição, nem fotografias como imagem (cores de degradê entram como médias, com aviso quando a dispersão passa de 5 ΔE00).
- O filtro de participação mínima existe (`minPixelShare`), mas o valor padrão é 0 e não foi calibrado com PDFs reais.
- O laudo exportável e a interface final ficam para a Fase 8 (o Fluxo B está na seção 8e).

---

## 8e. Fase 7: Fluxo B (referência contra simulação)

### 8e.1 O que foi implementado

Entrada: duas versões do **mesmo layout** (PDF ou imagem): a referência (por exemplo, a arte aprovada em RGB) e a simulação (por exemplo, a versão em CMYK). Cada página é dividida numa grade de 32 × 32 regiões, em **coordenadas normalizadas** (a resolução das duas versões pode ser diferente). De cada região guarda-se a cor **mais frequente** (moda), não a média, porque a média de uma borda entre duas cores é uma terceira cor que não existe no arquivo. Região a região, calcula-se o ΔE00 entre a referência e a simulação; regiões que são papel nas duas versões não entram na conta.

| Arquivo | Papel |
|---|---|
| `src/lib/compare/labGrid.ts` | Página rasterizada (RGBA ou CMYK de 8 bits) para grade de cores em Lab (CMYK passa pelo perfil, em lote) |
| `src/lib/compare/flowB.ts` | `comparePage`/`compareGrids`: ΔE00 por região, média, p95, máximo, participação por faixa, piores regiões, veredito; `LayoutMismatchError` se as proporções da página diferem mais de 2% |
| `src/lib/compare/compareFiles.ts` | De ponta a ponta: lê cada entrada pelo caminho certo (pdf.js em RGB, MuPDF com perfil em CMYK, imagem pelo navegador) e compara |
| `src/lib/analysis/*` | O Worker ganhou a mensagem `compare`; o cliente, `compare()` |
| `src/components/FlowBTest.tsx` (removido na Fase 8; ver 8f) | Tela provisória, com Worker e perfil próprios; trocar o perfil ou um dos arquivos refaz a comparação |
| `src/lib/pdf/__fixtures__/par-simulacao-cmyk.pdf` | Par CMYK de `cores-rgb.pdf` (mesmo layout), com o CMYK que o ISO Coated v2 escolhe para cada cor |

### 8e.2 Decisões desta fase (confirmadas pelo autor em 17/11/2026)

- **Veredito geral pelo percentil 95**, não pelo pior caso. O pior caso é dominado por regiões de borda, onde poucos pixels de deslocamento entre as versões trocam a cor dominante da região. O pior caso e as cinco piores regiões são informados à parte, junto com a fração de uniformidade da região (baixa = região mista). As faixas de ΔE00 são as de D2 (3,0 e 5,0); uma média acima de 2,5 impede o "aprovado" da página.
- **Intent padrão: relativo**, não absoluto como a decisão D1 previu para o Fluxo B. A D1 pensava em comparar CMYK com os valores de caracterização da condição de impressão. Para referência de tela contra versão impressa, o intent absoluto faz o branco do papel (L\* 95, b\* −2 a −6) contar como diferença da tela (L\* 100) e eleva o ΔE00 de todo o material. A opção `intent: 'absolute'` continua disponível.

### 8e.3 Resultados no par de teste (cores-rgb.pdf × par-simulacao-cmyk.pdf)

ΔE00 médio por bloco de cor (vermelho, verde, azul, laranja, cinza, marrom); regiões de papel excluídas (768 regiões comparadas):

| Perfil e intent | Vermelho | Verde | Azul | Laranja | Cinza | Marrom | Geral (p95) |
|---|---|---|---|---|---|---|---|
| ISO Coated v2, relativo | 1,20 | 0,48 | **9,38** | 2,76 | 1,04 | 2,21 | reprovado |
| ISO Coated v2, absoluto | 2,41 | 2,74 | **10,01** | 5,59 | 3,10 | 2,00 | reprovado |
| PSO Coated v3, relativo | 2,14 | 1,19 | **9,11** | 2,76 | 2,39 | 2,32 | reprovado |
| PSO Coated v3, absoluto | 3,19 | 4,28 | **8,91** | 6,01 | 4,35 | 2,71 | reprovado |

O CMYK do par foi calculado com o ISO Coated v2 (intent relativo): por isso o PSO Coated v3 dá desvios maiores nas outras cores (o mesmo número CMYK significa outra cor em outra condição de impressão). O azul sRGB 30/60/200 está fora do gamut do offset e é a pior região em todos os casos. Com intent absoluto, o laranja sobe de 2,76 para 5,59 e passa a reprovar, o que mostra o efeito do branco do papel e justifica o relativo como padrão.

Verificado no Chromium (build de produção): RGB × RGB do mesmo arquivo dá ΔE00 0,00 e aprovado; RGB × CMYK sem perfil pede o perfil; ao escolher o perfil a comparação é refeita sozinha; sem erros no console.

### 8e.4 Limites

- O Fluxo B **exige o mesmo layout**. Não há alinhamento automático; páginas com proporção diferente são recusadas.
- Elementos menores que uma região (cerca de 6,6 × 9,3 mm numa página A4 com grade 32) dentro de uma região dominada por outra cor, ou por papel, não aparecem. Texto fino não é avaliado.
- A comparação é de **cor dominante por região**, não de imagem pixel a pixel nem de percepção de diferenças locais.
- A interface final e a exportação vieram na Fase 8 (seção 8f). Falta testar com pares de arquivos reais.
- Uma mesma região pode virar "mista" por antialiasing; o aviso do laudo aparece quando as piores regiões têm menos de 50% de uniformidade.

---

## 8f. Fase 8: interface final e laudo exportável

### 8f.1 Interface

Uma única aplicação, sem servidor, em português, com visual de painel escuro (barra lateral, destaque verde-menta, indicadores, medidor, barras de ΔE00). No alto ficam os dois seletores: **arquivo de referência** (PDF ou imagem) e **condição de impressão** (perfil ICC CMYK). O menu lateral tem quatro páginas, todas lendo o mesmo estado (`src/state/useWorkspace.ts`):

- **Visão geral:** tudo numa tela: comparador da simulação, laudo em medidor (ΔE00 no p95 das regiões), indicadores, faixa de amostras e tabela das amostras analisadas.
- **Simulação (antigo Fluxo B):** a pessoa envia **um** arquivo e o programa gera a versão impressa (seção 8g). Comparador com divisor arrastável, lado a lado e mapa de ΔE00 por região, mais as regiões mais afetadas.
- **Amostras (antigo Fluxo A):** cada cor dominante como retângulo colorido, dividido em "Arquivo" e "Impresso", com a referência CMYK reproduzida (barras C, M, Y, K nas cores das tintas), Lab, ΔE00, área e veredito.
- **Relatório:** laudos exportáveis (amostras e simulação, em HTML/PDF por impressão e CSV) e o texto "Sobre o método".

Enviar um arquivo (ou trocar o perfil) roda no Worker, em sequência, a análise das amostras e a simulação. A comparação de **dois arquivos** (`compareFiles`, mensagem `compare` do Worker) continua no código e testada, mas saiu da interface. As telas provisórias das Fases 3 a 7 e o scaffold foram removidos.

| Arquivo | Papel |
|---|---|
| `src/App.tsx` | Menu lateral, seletores de arquivo e de perfil |
| `src/state/useWorkspace.ts` | Arquivo, perfil, resultados, progresso e cancelamento |
| `src/pages/*` | `OverviewPage`, `SimulationPage`, `SamplesPage`, `ReportPage` |
| `src/components/Comparator.tsx` | Divisor, lado a lado e mapa de ΔE00 |
| `src/components/ui.tsx`, `common.tsx`, `format.ts`, `samples.ts` | Cartão, indicador, medidor, tintas CMYK, gráficos, mapa de calor, área de soltar arquivo e cores das amostras |
| `src/components/AboutPanel.tsx` | Texto "Sobre o método" (dentro do Relatório) |
| `src/lib/browser/download.ts` | Baixar arquivo, imprimir pelo diálogo do navegador (salvar em PDF) e nome seguro de arquivo |
| `src/lib/report/export.ts` | `flowAToHtml`, `flowAToCsv`, `flowBToHtml`, `flowBToCsv` (funções puras, testadas em Node) |

Acessibilidade e layout: abas com `role="tablist"`, seletores de arquivo com rótulo e foco visível, resultado em região `aria-live`, cores de veredito acompanhadas de texto (não só cor), tema escuro (o laudo exportado segue claro, para impressão), comparador operável pelo teclado (campo de intervalo), tabelas com rolagem horizontal. Layout responsivo: em 390 px (celular) a barra lateral vira cabeçalho com o menu em uma linha. Verificado no Chromium em desktop e celular, sem rolagem horizontal da página.

### 8f.2 Laudo exportável

- **HTML autônomo:** abre em qualquer navegador e imprime ou salva em PDF pelo diálogo de impressão (estilo de impressão incluso). Traz arquivo(s), páginas, caminho de leitura da cor, perfil, rendering intent, limites de ΔE00, veredito geral e por cor (ou por região no Fluxo B), avisos, amostras de cor e o texto "como ler este laudo", que repete que é simulação numérica e não laudo ISO 12647 (L4), que os limites são decisão de projeto e que a compensação de ponto preto está desligada. Data e hora vêm de fora da função, para o texto ser reproduzível nos testes.
- **CSV:** separador `;`, decimal com vírgula e BOM UTF-8, que é o que o Excel em português abre sem converter. Valores de texto que começam com `=`, `+`, `-` ou `@` recebem um apóstrofo, para o nome de um arquivo não virar fórmula na planilha. Nomes de arquivo são escapados no HTML.
- Nada sai do computador: a geração e o download acontecem no navegador.

### 8f.3 Resumo da validação feita no projeto

| O que | Como foi verificado | Resultado |
|---|---|---|
| Núcleo colorimétrico (sRGB, Bradford, CIEDE2000) | 34 pares de Sharma et al. e conferência contra o lcms2 | Seções 6 e 7 |
| Motor de cor (A2B, B2A, round-trip) | Dados de caracterização embutidos em dois perfis (1617 patches cada) | Seção 7.4 |
| Leitura de cor do PDF | Fixtures sintéticas com proporções de pixel conhecidas, RGB, CMYK, misto e imagens | Seção 8 |
| Fluxo A e Fluxo B | Testes automatizados e verificação no Chromium | Seções 8d e 8e |
| Exportação | Testes de conteúdo, escape e CSV; abertura do HTML gerado | Esta seção |

**O que não foi validado:** PDFs reais de produção (InDesign, Illustrator, Canva); comparação independente do motor de cor (ArgyllCMS, `xicclu`); tolerâncias numéricas da ISO 12647-2 (não verificadas no texto da norma); comparação com impresso medido; uso de memória com PDFs grandes; acessibilidade com leitor de tela (só a estrutura foi cuidada).

### 8f.4 Limites

- O perfil não persiste entre sessões (precisa ser escolhido de novo ao abrir a página); isso evita guardar o `.icc` da ECI (L11).
- Só um arquivo (Fluxo A) ou um par (Fluxo B) por vez; sem histórico nem laudo em lote.
- A impressão usa o diálogo do navegador; o PDF final depende dele.

---


**Interface enxuta (18/11/2026).** A pedido do usuário ("muita informação escrita, pouco intuitivo"), o texto explicativo saiu das telas: sem subtítulos, o resultado em uma frase ("A impressão fica fiel ao arquivo"), o CMYK em destaque e o restante (detalhes, origem do valor, regiões mais afetadas, "Como funciona") em blocos recolhidos que abrem sob demanda. A visão geral ficou com comparador, nota e cores do arquivo; a tabela de amostras só existe na página Amostras. Os cálculos não mudaram.

## 8g. Simulação de impressão a partir de um arquivo

O programa gera sozinho a versão impressa (`src/lib/simulate/simulatePrint.ts`, `IccProfileHandle.simulateRgba` e `cmyk8ToRgba`):

- **Imagem ou PDF em RGB:** cada pixel vai de sRGB para CMYK (B2A do perfil) e volta para sRGB de tela (A2B), no intent escolhido (relativo, sem BPC). A diferença entre as duas imagens é o que a condição de impressão não reproduz.
- **PDF em CMYK:** os valores C, M, Y, K lidos pelo MuPDF (sem ICC) são mostrados pelo perfil. Não há versão RGB de referência, então não há comparação, só a imagem simulada (e um aviso).
- **Comparação:** a grade 32×32 do original contra a da simulação, ΔE00 por região, veredito pelo p95 (mesmo método da seção 8e, `compareGrids`). Só a primeira página entra na simulação; a visualização é limitada a 1,5 milhão de pixels.
- **Limites:** os dois lados são comparados depois de passar por sRGB (8 bits); o corte de gamut do sRGB e o arredondamento entram na conta. O mapa mostra a região, não o pixel. Elementos menores que uma região não aparecem (L do Fluxo B).
- **Validação:** testes com ISO Coated v2 (cinza volta com ΔE00 < 3; azul saturado fora do gamut > 8; vários lotes do WASM; papel vira branco; PDF em RGB e em CMYK) e verificação no Chromium (desktop e celular).

## 9. Limitações e riscos conhecidos

**L1. O Canvas altera os pixels antes de você lê-los.** Ao desenhar uma imagem com perfil ICC embutido, o navegador converte para o espaço do canvas (em geral sRGB) antes de `getImageData`. Não há flag padrão e confiável entre Chrome, Firefox e Safari para obter o dado cru. Consequência: o Canvas serve para exibição, mas não deve ser a fonte de verdade do laudo. Para o laudo, os valores devem vir do decoder (imagens extraídas do PDF) ou da cor declarada no próprio PDF.

**L2. CMYK não é tratado pelo Canvas.** Imagens CMYK (JPEG com marcador Adobe APP14, por exemplo) precisam ser decodificadas por código próprio ou por biblioteca que devolva os componentes sem convertê-los para RGB.

**L3. Perfis CMYK usam LUT, não matriz/TRC.** A conversão exige interpolação multidimensional, que é o papel do lcms2.

**L4. "Conformidade ISO 12647" não é o que o sistema mede.** A norma avalia uma prova ou tiragem impressa **medida com espectrofotômetro**, contra dados de caracterização (FOGRA39, FOGRA51). O sistema faz uma verificação numérica simulada de gamut. O texto do trabalho e o laudo devem dizer "simulação de conformidade" ou "pré-checagem", não "laudo de conformidade ISO 12647". O limiar de ΔE00 do veredito é uma **decisão de projeto** e precisa ser definido e citado. O valor ≤ 3,00 que aparece no mockup é provisório.

**L5. Spot colors não são tratados como tais.** Como a página é rasterizada (seção 8), vetores e imagens entram na análise, mas spot colors chegam como o pdf.js (RGB) ou o MuPDF (CMYK) os converte.

**L6. Output Intent.** Ler o `/OutputIntent` do PDF para sugerir o perfil de destino está previsto no esqueleto, mas não implementado.

**L7. Qualidade do k-means.** **Resolvida na Fase 4:** inicialização determinística no estilo k-means++, com pesos, e 8 testes (seção 8). Continua aberta a escolha de k e de um filtro de participação mínima para arquivos reais.

**L8. Definição do branco D50.** O núcleo usa Z = 82,521 e o ICC define o D50 do PCS com Z = 0,8249 (4 casas). Sem alinhar as duas definições, o Lab calculado pelo núcleo e o Lab devolvido pelo lcms2 podem diferir por um desvio sistemático pequeno que não tem relação com a cor em si (ver 6.1). **Resolvido na Fase 3:** a maior diferença medida entre o lcms2 e o núcleo foi ΔE00 = 0,016 (seção 7.4).

**L9. Piso de erro do round-trip.** Lab → CMYK → Lab não é idêntico nem para cores dentro do gamut: nos patches de caracterização do PSO Coated v3, a média ficou em 0,3 a 0,4 ΔE00 e o máximo em 2,8 a 3,8 (seção 7.4). O limiar do laudo deve considerar isso.

**L10. Rendering intent e ponto preto.** O intent muda o resultado de forma material (seção 7.4). Decidido na seção 8c (D1): relativo no Fluxo A, absoluto no Fluxo B, BPC desligado até medir.

**L11. Licença dos perfis ECI.** Os `.icc` não podem ser redistribuídos sem permissão escrita da ECI (seção 7.5). Não os coloque no repositório.

**L12. Dependência do `lcms-wasm`.** Pacote pequeno, de um mantenedor, sem tipos TypeScript publicados. Risco registrado (seção 7.1).

**L13. O pdf.js entrega sRGB.** O caminho RGB converte CMYK com fórmula aproximada (3,7 a 10,9 ΔE00 de desvio, seção 8.4). **Mitigada:** PDFs com CMYK passam pelo caminho CMYK (seção 8.5), que lê os números do arquivo. O caminho RGB continua valendo para PDFs sem CMYK e para imagens PNG/JPEG.

**L14. Licença do MuPDF (AGPL-3.0).** Distribuir o sistema com o MuPDF exige disponibilizar o código sob termos compatíveis com a AGPL (ou obter licença comercial da Artifex). Decisão do autor a registrar no trabalho; o repositório hoje não declara licença.

**L15. PDFs mistos.** Elementos RGB ou cinza dentro de um PDF com CMYK são convertidos pelo MuPDF sem perfil (seção 8.6).

**L16. O perfil embutido no PDF é ignorado.** Os números CMYK do arquivo são interpretados pelo perfil escolhido pelo usuário (seção 8.5).

---

## 10. Correções em relação ao que foi dito durante o planejamento

| Item | Dito antes | Correto |
|---|---|---|
| Perfis | "ISOcoated_v2 e PSOcoated_v3 (FOGRA39)" | ISOcoated_v2 corresponde à **FOGRA39**. PSOcoated_v3 corresponde à **FOGRA51**. São caracterizações diferentes. |
| Round-trip | "ida via A2B, volta via B2A" | Ida (Lab → CMYK) é **B2A**. Volta (CMYK → Lab) é **A2B**. |
| Cobertura de testes | "8 casos do dataset de referência" | Eram 6 pares do dataset e 2 testes de propriedade. **Resolvido:** agora são os 34 pares (seção 6). |
| Matriz sRGB | "Usa os coeficientes arredondados da especificação, e a referência deriva a matriz das primárias" | Invertido. O projeto usa a matriz de **7 casas** (alta precisão). O colour-science usa a da **IEC 61966-2-1, de 4 casas**. A diferença entre as duas é a origem dos desvios de 0,01 a 0,03 em a\*/b\* (seção 6.2). |
| README do projeto | Agrupava os dois perfis sob FOGRA39, dizia "12/12 testes" e chamava o k-means de "já pronto" | **Resolvido:** README.md corrigido (FOGRA39 e FOGRA51 separados, 54/54 testes, k-means "implementado, sem testes"). |

---

## 11. Roteiro e status

| Fase | Descrição | Status |
|---|---|---|
| 1 | Setup e fundamentação | Concluída |
| 2 | Núcleo matemático colorimétrico | Concluída (34 pares + pipeline validado, ver seção 6) |
| 3 | Integração do lcms2-wasm e perfis ICC | Concluída: testada em Node, no navegador e em Web Worker com PSO Coated v3 e ISO Coated v2 (seções 7 e 8b) |
| 4 | Extração de cor do PDF (pdf.js + clusterização) | Implementada e testada em Node e no navegador, com caminho híbrido RGB/CMYK (seção 8). Pendente: PDFs reais de produção |
| 5 | Web Workers e medição de desempenho | Implementada e verificada no Chromium (seção 8b). Pendente: PDFs reais grandes |
| 6 | Fluxo A: round-trip e laudo | Implementada e verificada no Chromium (seção 8d). Pendente: PDFs reais, laudo exportável |
| 7 | Fluxo B: referência vs. simulação | Implementada e verificada no Chromium (seção 8e). Pendente: pares de arquivos reais |
| 8 | Interface, laudo exportável, validação final e escrita | Interface e exportação implementadas e verificadas no Chromium (seção 8f). Pendente: validação com arquivos reais e a escrita do TCC |

**Pendências (Fases 3 e 4):**

0. ~~Decidir como tratar o CMYK dos PDFs.~~ Decidido: híbrido (seção 8). Licença decidida: AGPL-3.0 (seção 8c).

1. ~~Completar os 34 pares de Sharma et al. nos testes.~~ Feito.
2. ~~Adicionar testes de pipeline com cores sRGB de Lab conhecido.~~ Feito.
3. ~~Testar `kmeansLab` (determinismo, pesos somando 1, casos com poucos pontos).~~ Feito (seção 8.3).
4. ~~Obter os perfis `.icc` (ECI) e verificar a licença.~~ PSO Coated v3 obtido e licença lida (não redistribuir). ISOcoated_v2 obtido e testado.
5. Definir rendering intent, compensação de ponto preto e limiar de tolerância (seção 7.5, L9 e L10).
6. Escolher a referência externa de validação (ArgyllCMS, `xicclu`) e registrar os valores comparados. As referências atuais vêm do próprio perfil.
7. ~~Alinhar a definição do branco D50 entre o núcleo e o lcms2 (L8).~~ Feito: ΔE00 máximo de 0,016.
8. Ajustar o comentário da matriz sRGB em `colorimetry.ts` (6.1).

---

## 12. Como executar

Requisitos: Node.js (versão LTS) e VS Code.

```bash
cd colorproof        # a pasta que contém package.json
npm install
npm run dev          # http://localhost:5173
npm test             # 253 testes com os dois perfis locais; sem eles, os que dependem dos .icc são ignorados
```

**Perfis ICC.** Baixe `pso-coated_v3.zip` e `eci_offset_2009.zip` em https://eci.org/doku.php_id=en:downloads.html (seção *ICC profiles from ECI*), extraia e coloque `PSOcoated_v3.icc` e `ISOcoated_v2_eci.icc` em `public/profiles/`. Os `.icc` são ignorados pelo Git por causa da licença da ECI (seção 7.5). Sem os arquivos, os testes que dependem deles são ignorados.

**Armadilha comum:** o zip já contém uma pasta `colorproof`. Se for extraído dentro de outra pasta de mesmo nome, o projeto fica em `colorproof\colorproof`. No VS Code, abra a pasta que tem `package.json` na raiz. Se aparecer `ENOENT ... package.json`, o terminal está na pasta errada.

---

## 13. Referências

- Sharma, G.; Wu, W.; Dalal, E. N. *The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations.* Color Research & Application, 30(1), 21–30, 2005.
- CIE 142-2001. *Improvement to industrial colour-difference evaluation.*
- ISO 12647-2. *Graphic technology: process control for the production of halftone colour separations, proof and production prints. Offset lithographic processes.*
- ICC. *Specification ICC.1* (estrutura de perfis, tags A2B/B2A).
- Little CMS (lcms2): https://www.littlecms.com
- lcms-wasm (Matt DesLauriers): https://github.com/mattdesl/lcms-wasm
- ECI European Color Initiative. Downloads de perfis ICC: https://eci.org/doku.php_id=en:downloads.html
- PDF.js (Mozilla): https://mozilla.github.io/pdf.js/

---

## Apêndice A: como as referências do pipeline foram geradas

Script em Python, com `pip install colour-science` (versão usada: 0.4.7). Ele gera o Lab D50 das cores do grupo "Pipeline contra implementação independente".

```python
import numpy as np, colour

cs = colour.RGB_COLOURSPACES['sRGB']
D50 = colour.CCS_ILLUMINANTS['CIE 1931 2 Degree Standard Observer']['D50']

cores = {
    'vermelho': (255, 0, 0),   'verde': (0, 255, 0),     'azul': (0, 0, 255),
    'amarelo': (255, 255, 0),  'ciano': (0, 255, 255),   'magenta': (255, 0, 255),
    'cinza 18%': (46, 46, 46), 'laranja': (255, 128, 0),
    'marrom': (120, 72, 24),   'verde escuro': (40, 80, 40),
}

for nome, rgb in cores.items():
    xyz = colour.RGB_to_XYZ(np.array(rgb) / 255, cs, D50,
                            chromatic_adaptation_transform='Bradford',
                            apply_cctf_decoding=True)   # sem isto a gama não é removida
    lab = colour.XYZ_to_Lab(xyz, D50)
    print(nome, rgb, [round(float(v), 4) for v in lab])
```

O parâmetro `apply_cctf_decoding=True` é essencial. Sem ele o colour-science trata o RGB como linear, e o cinza 128 sai com L\* ≈ 76 em vez de 53,585.

**Conferência dos 34 pares de Sharma.** Cada par `(L1,a1,b1)` e `(L2,a2,b2)` da lista `SHARMA_PAIRS`, em `colorimetry.test.ts`, foi passado a `colour.difference.delta_E_CIE2000`. Exemplo do par 1:

```python
import numpy as np, colour
d = colour.difference.delta_E_CIE2000(np.array([50, 2.6772, -79.7751]),
                                      np.array([50, 0, -82.7485]))
print(round(float(d), 4))   # 2.0425
```
