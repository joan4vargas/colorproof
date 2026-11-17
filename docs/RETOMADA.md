# ColorProof: ponto de retomada (17/11/2026)

Este arquivo resume onde o projeto parou e como continuar. A documentação técnica completa está em `DOCUMENTACAO.md`.

## Estado do código

Fases 1 a 8 implementadas, 218 testes passando (com os dois perfis). Conferir `git log` para saber o que já foi enviado ao GitHub.

| Fase | Situação |
|---|---|
| 1 e 2 | Concluídas (núcleo colorimétrico, 54 testes) |
| 3 | Motor de cor com lcms-wasm. Testado em Node e no navegador com PSO Coated v3 e ISO Coated v2. Verificado também em Web Worker (Fase 5) |
| 4 | Extração de cores do PDF, caminho híbrido: PDF sem CMYK pelo pdf.js (sRGB); PDF com CMYK pelo MuPDF, que lê os números C, M, Y, K do arquivo e o perfil ICC os leva a Lab. Testada em Node e no navegador |
| 5 | Análise inteira em Web Worker (pdf.js, MuPDF, lcms), com progresso, cancelamento e tempos por etapa. Verificada no Chromium. Pendente: PDFs reais grandes e memória |
| 6 | Fluxo A: `evaluateFlowA` (round-trip B2A→A2B, ΔE00, veredito 3,0/4,0), laudo na tela, BPC medido e mantido desligado. Verificada no Chromium (seção 8d) |
| 7 | Fluxo B: duas versões do mesmo layout, grade 32×32, ΔE00 por região, veredito pelo p95; intent relativo por padrão (diverge do D1, ver 8e.2; confirmado). Verificada no Chromium (seção 8e) |
| 8 | Interface final (perfil compartilhado + abas dos Fluxos A e B), laudo exportável em HTML (imprime/salva em PDF) e CSV. Verificada no Chromium (seção 8f). Pendente: validação com arquivos reais e a escrita do TCC |

## Como retomar em outro computador

1. `git clone https://github.com/joan4vargas/colorproof.git`, entrar na pasta e `npm install`.
2. Baixar os perfis em https://eci.org/doku.php_id=en:downloads.html (`pso-coated_v3.zip` e `eci_offset_2009.zip`) e colocar `PSOcoated_v3.icc` e `ISOcoated_v2_eci.icc` em `public/profiles/`. Os `.icc` não vão para o Git (licença da ECI; `*.icc` no `.gitignore`). Guardar uma cópia deles fora do repositório.
3. `npm test`: com os dois perfis, 218 passam; sem eles, os testes que dependem dos `.icc` são ignorados.
4. `npm run dev` e abrir http://localhost:5173/ para usar a interface (escolher o perfil `.icc` na tela).
5. Configurar a identidade do Git só neste repositório: `git config user.name "Seu Nome"` e `git config user.email "seu-email"`.
6. Em PC compartilhado, apagar o login do GitHub no Gerenciador de Credenciais do Windows ao terminar.

## Decisões tomadas (17/11/2026, detalhes em DOCUMENTACAO.md seção 8c)

- **Licença:** AGPL-3.0 (arquivo `LICENSE`), por causa do MuPDF.
- **Intent:** relativo no Fluxo A; absoluto no Fluxo B. BPC desligado (medido na Fase 6: com BPC o round-trip do preto some e esconde a perda real).
- **Limiar de ΔE00:** aprovado ≤ 3,0; atenção de 3,0 a 4,0; reprovado > 4,0. Tolerâncias da ISO 12647-2 não verificadas: achar bibliografia antes de citar.

- **Fluxo B (confirmado em 17/11/2026, 8e.2):** veredito geral pelo p95 das regiões; intent relativo como padrão (a D1 previa absoluto para comparar com dados de caracterização).

## Decisões em aberto

- **Licença da ECI no site publicado:** servir o `.icc` aos usuários exige permissão escrita da ECI; alternativa é o usuário fornecer o perfil (L11).
- **k e filtro de participação mínima** das cores dominantes em arquivos reais.

## Pendências técnicas

- Testar com PDFs reais de produção (InDesign, Illustrator, Canva): transparência, overprint, spot colors, degradês.
- Medir desempenho com PDFs reais grandes (tempo, memória, travamento da interface) e revisar os limites de páginas e pixels.
- Validação independente do motor de cor (ArgyllCMS, `xicclu`); hoje a referência é o dado do próprio criador do perfil.
- Leitura do `/OutputIntents` do PDF (L6); `src/lib/pdf/outputIntent.ts` ainda lança erro explícito.
- Ajustar o comentário da matriz sRGB em `colorimetry.ts` (variante de alta precisão, não a da IEC).

## Achados para a monografia

- O pdf.js converte CMYK para RGB de forma aproximada: desvio de 3,7 a 10,9 ΔE00 contra o perfil nas seis cores de teste. Lendo o CMYK do arquivo com o MuPDF, o desvio cai para menos de 0,25 (só arredondamento a 8 bits).
- Num PDF com perfil CMYK embutido (ICCBased), o MuPDF com ICC ligado altera os valores (ciano 100% virou 255/31/4/0). Com o ICC desligado, os números saem como estão no arquivo. Decisão de projeto: o perfil embutido no PDF é ignorado e os números são interpretados pelo perfil escolhido pelo usuário.
- Os dois perfis testados (FOGRA39 e FOGRA51) mostram o mesmo padrão: A2B com intent absoluto reproduz a tabela de caracterização (média 0,06 a 0,10 ΔE00); o intent relativo não (média 2,7 a 3,5).
- O sistema deve ser descrito como "simulação de conformidade" ou "pré-checagem", não como laudo de conformidade ISO 12647 (L4): a norma avalia material impresso medido com espectrofotômetro.
- Os PDFs de teste são sintéticos; os resultados em arquivos reais ainda não foram medidos.
