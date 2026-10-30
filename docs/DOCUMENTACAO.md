# ColorProof — Documentação técnica

Estado do projeto em **13/10/2026** · Fases 1 e 2 concluídas e validadas (54 testes) · Fase 3 a iniciar

Este documento registra o que foi decidido, o que foi construído, como foi validado e o que ainda é limitação. Ele é escrito para servir de base à seção prática da monografia e para quem for continuar o código.

---

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
| Terceiros | `pdfjs-dist` | Estrutura do PDF (páginas, imagens, Output Intent) |
| Terceiros | `lcms-wasm` 1.0.x (Little CMS em WASM, licença MIT) | Motor de cor: abre perfis ICC e converte CMYK e Lab pelas tabelas A2B e B2A |
| Testes | Vitest | Validação numérica do núcleo |
| Desenvolvimento | Node.js, VS Code | Apenas tooling |
| Execução | Navegador (client-side) | Runtime final |

Versões instaladas (conforme `package.json`): React 19, Vite 8, TypeScript 6, Vitest 5, pdfjs-dist 4.x, lcms-wasm 1.0.x.

---

## 5. Estrutura do código

| Arquivo | Conteúdo | Status |
|---|---|---|
| `src/types/color.ts` | Tipos `RGB`, `XYZ`, `Lab`, `WhitePoint` e iluminantes D65 e D50 | Pronto |
| `src/core/colorimetry.ts` | `rgbToXyzD65`, `adaptBradford`, `xyzToLab`, `rgbToLabD50`, `deltaE2000` | Pronto e testado (dataset completo de 34 pares) |
| `src/core/__tests__/colorimetry.test.ts` | 54 testes (ver seção 6) | Passando |
| `src/lib/sampling/kmeans.ts` | `kmeansLab(points, k, maxIterations)` com inicialização por amostragem espaçada | Implementado, **sem testes** |
| `src/lib/icc/colorEngine.ts` | `createColorEngine`, `loadProfile`, `cmykToLab`, `labToCmyk`, `roundTripLab`, `rgbToDeviceCmyk`, `srgbToLab` (ver seção 7) | Implementado e testado em Node |
| `src/lib/icc/iccTags.ts` | Leitura do cabeçalho e das tags de texto de um perfil ICC | Implementado e testado |
| `src/lib/icc/characterization.ts` | Leitura dos dados de caracterização (CGATS) embutidos no perfil (tag `targ`) | Implementado e testado |
| `src/lib/icc/__tests__/` | 32 testes: 9 do leitor ICC, do CGATS e da codificação de 16 bits (sem arquivo externo); 13 de sRGB contra o núcleo; 9 do perfil PSO Coated v3 (ignorados se o `.icc` não estiver na máquina); 1 de arquivo inválido | Passando |
| `src/types/lcms-wasm.d.ts` | Declaração de tipos do subconjunto usado do `lcms-wasm` (o pacote não publica tipos) | Pronto |
| `src/components/ProfileSmokeTest.tsx` | Teste provisório no navegador: escolhe um `.icc` e mostra papel e sólidos em Lab | Provisório (substituído na Fase 8) |
| `src/lib/pdf/extractImages.ts` | `extractImagesFromPdf`, `extractOutputIntentProfile` com `TODO` da Fase 4 | Esqueleto |
| `src/App.tsx` | Placeholder que lista o status das fases | Provisório |

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
- Os testes automatizados rodam em Node. O build de produção compila e empacota o `.wasm`, mas o carregamento **no navegador** e dentro de um **Web Worker** ainda não foi verificado. O teste provisório na tela (`ProfileSmokeTest`) serve para a verificação no navegador.
- Só perfis CMYK de saída são aceitos. Perfil de monitor entra em fase posterior.

---

## 8. Limitações e riscos conhecidos

**L1. O Canvas altera os pixels antes de você lê-los.** Ao desenhar uma imagem com perfil ICC embutido, o navegador converte para o espaço do canvas (em geral sRGB) antes de `getImageData`. Não há flag padrão e confiável entre Chrome, Firefox e Safari para obter o dado cru. Consequência: o Canvas serve para exibição, mas não deve ser a fonte de verdade do laudo. Para o laudo, os valores devem vir do decoder (imagens extraídas do PDF) ou da cor declarada no próprio PDF.

**L2. CMYK não é tratado pelo Canvas.** Imagens CMYK (JPEG com marcador Adobe APP14, por exemplo) precisam ser decodificadas por código próprio ou por biblioteca que devolva os componentes sem convertê-los para RGB.

**L3. Perfis CMYK usam LUT, não matriz/TRC.** A conversão exige interpolação multidimensional, que é o papel do lcms2.

**L4. "Conformidade ISO 12647" não é o que o sistema mede.** A norma avalia uma prova ou tiragem impressa **medida com espectrofotômetro**, contra dados de caracterização (FOGRA39, FOGRA51). O sistema faz uma verificação numérica simulada de gamut. O texto do trabalho e o laudo devem dizer "simulação de conformidade" ou "pré-checagem", não "laudo de conformidade ISO 12647". O limiar de ΔE00 do veredito é uma **decisão de projeto** e precisa ser definido e citado. O valor ≤ 3,00 que aparece no mockup é provisório.

**L5. Cores vetoriais e spot colors não são analisadas.** Só as imagens rasterizadas entram na análise. Vai como trabalho futuro.

**L6. Output Intent.** Ler o `/OutputIntent` do PDF para sugerir o perfil de destino está previsto no esqueleto, mas não implementado.

**L7. Qualidade do k-means.** A inicialização é por amostragem espaçada. Se os clusters ficarem instáveis, a alternativa documentada no código é k-means++.

**L8. Definição do branco D50.** O núcleo usa Z = 82,521 e o ICC define o D50 do PCS com Z = 0,8249 (4 casas). Sem alinhar as duas definições, o Lab calculado pelo núcleo e o Lab devolvido pelo lcms2 podem diferir por um desvio sistemático pequeno que não tem relação com a cor em si (ver 6.1). **Resolvido na Fase 3:** a maior diferença medida entre o lcms2 e o núcleo foi ΔE00 = 0,016 (seção 7.4).

**L9. Piso de erro do round-trip.** Lab → CMYK → Lab não é idêntico nem para cores dentro do gamut: nos patches de caracterização do PSO Coated v3, a média ficou em 0,3 a 0,4 ΔE00 e o máximo em 2,8 a 3,8 (seção 7.4). O limiar do laudo deve considerar isso.

**L10. Rendering intent e ponto preto.** O intent muda o resultado de forma material (seção 7.4). Intent e compensação de ponto preto ainda precisam ser definidos para o laudo.

**L11. Licença dos perfis ECI.** Os `.icc` não podem ser redistribuídos sem permissão escrita da ECI (seção 7.5). Não os coloque no repositório.

**L12. Dependência do `lcms-wasm`.** Pacote pequeno, de um mantenedor, sem tipos TypeScript publicados. Risco registrado (seção 7.1).

---

## 9. Correções em relação ao que foi dito durante o planejamento

| Item | Dito antes | Correto |
|---|---|---|
| Perfis | "ISOcoated_v2 e PSOcoated_v3 (FOGRA39)" | ISOcoated_v2 corresponde à **FOGRA39**. PSOcoated_v3 corresponde à **FOGRA51**. São caracterizações diferentes. |
| Round-trip | "ida via A2B, volta via B2A" | Ida (Lab → CMYK) é **B2A**. Volta (CMYK → Lab) é **A2B**. |
| Cobertura de testes | "8 casos do dataset de referência" | Eram 6 pares do dataset e 2 testes de propriedade. **Resolvido:** agora são os 34 pares (seção 6). |
| Matriz sRGB | "Usa os coeficientes arredondados da especificação, e a referência deriva a matriz das primárias" | Invertido. O projeto usa a matriz de **7 casas** (alta precisão). O colour-science usa a da **IEC 61966-2-1, de 4 casas**. A diferença entre as duas é a origem dos desvios de 0,01 a 0,03 em a\*/b\* (seção 6.2). |
| README do projeto | Agrupava os dois perfis sob FOGRA39, dizia "12/12 testes" e chamava o k-means de "já pronto" | **Resolvido:** README.md corrigido (FOGRA39 e FOGRA51 separados, 54/54 testes, k-means "implementado, sem testes"). |

---

## 10. Roteiro e status

| Fase | Descrição | Status |
|---|---|---|
| 1 | Setup e fundamentação | Concluída |
| 2 | Núcleo matemático colorimétrico | Concluída (34 pares + pipeline validado, ver seção 6) |
| 3 | Integração do lcms2-wasm e perfis ICC | Implementada e testada em Node com PSO Coated v3 e ISO Coated v2 (seção 7). Pendentes: navegador e Web Worker |
| 4 | Extração de cor do PDF (pdf.js + clusterização) | Pendente |
| 5 | Web Workers e medição de desempenho | Pendente |
| 6 | Fluxo A: round-trip e laudo | Pendente |
| 7 | Fluxo B: referência vs. simulação | Pendente |
| 8 | Interface, validação final e escrita | Pendente |

**Pendências antes ou durante a Fase 3:**

1. ~~Completar os 34 pares de Sharma et al. nos testes.~~ Feito.
2. ~~Adicionar testes de pipeline com cores sRGB de Lab conhecido.~~ Feito.
3. Testar `kmeansLab` (determinismo, pesos somando 1, casos com poucos pontos).
4. ~~Obter os perfis `.icc` (ECI) e verificar a licença.~~ PSO Coated v3 obtido e licença lida (não redistribuir). ISOcoated_v2 obtido e testado.
5. Definir rendering intent, compensação de ponto preto e limiar de tolerância (seção 7.5, L9 e L10).
6. Escolher a referência externa de validação (ArgyllCMS, `xicclu`) e registrar os valores comparados. As referências atuais vêm do próprio perfil.
7. ~~Alinhar a definição do branco D50 entre o núcleo e o lcms2 (L8).~~ Feito: ΔE00 máximo de 0,016.
8. Ajustar o comentário da matriz sRGB em `colorimetry.ts` (6.1).

---

## 11. Como executar

Requisitos: Node.js (versão LTS) e VS Code.

```bash
cd colorproof        # a pasta que contém package.json
npm install
npm run dev          # http://localhost:5173
npm test             # 95 testes com os dois perfis locais; sem eles, 77 passam e 18 são ignorados
```

**Perfis ICC.** Baixe `pso-coated_v3.zip` e `eci_offset_2009.zip` em https://eci.org/doku.php_id=en:downloads.html (seção *ICC profiles from ECI*), extraia e coloque `PSOcoated_v3.icc` e `ISOcoated_v2_eci.icc` em `public/profiles/`. Os `.icc` são ignorados pelo Git por causa da licença da ECI (seção 7.5). Sem os arquivos, os testes que dependem deles são ignorados.

**Armadilha comum:** o zip já contém uma pasta `colorproof`. Se for extraído dentro de outra pasta de mesmo nome, o projeto fica em `colorproof\colorproof`. No VS Code, abra a pasta que tem `package.json` na raiz. Se aparecer `ENOENT ... package.json`, o terminal está na pasta errada.

---

## 12. Referências

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
