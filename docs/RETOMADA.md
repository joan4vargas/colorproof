# ColorProof: ponto de retomada (30/10/2026)

Este arquivo resume onde o projeto parou e como continuar. A documentação técnica completa está em `DOCUMENTACAO.md`.

## Estado do código

Último commit no momento desta anotação: `07a3db2` ("Fase 4: extração de cores do PDF, caminho híbrido"), com 159 testes passando.

| Fase | Situação |
|---|---|
| 1 e 2 | Concluídas (núcleo colorimétrico, 54 testes) |
| 3 | Motor de cor com lcms-wasm. Testado em Node e no navegador com PSO Coated v3 e ISO Coated v2. Falta verificar em Web Worker (Fase 5) |
| 4 | Extração de cores do PDF, caminho híbrido: PDF sem CMYK pelo pdf.js (sRGB); PDF com CMYK pelo MuPDF, que lê os números C, M, Y, K do arquivo e o perfil ICC os leva a Lab. Testada em Node e no navegador |
| 5 a 8 | Pendentes: Web Workers e desempenho; Fluxo A (round-trip e laudo); Fluxo B (referência vs. simulação); interface e escrita |

## Como retomar em outro computador

1. `git clone https://github.com/joan4vargas/colorproof.git`, entrar na pasta e `npm install`.
2. Baixar os perfis em https://eci.org/doku.php_id=en:downloads.html (`pso-coated_v3.zip` e `eci_offset_2009.zip`) e colocar `PSOcoated_v3.icc` e `ISOcoated_v2_eci.icc` em `public/profiles/`. Os `.icc` não vão para o Git (licença da ECI; `*.icc` no `.gitignore`). Guardar uma cópia deles fora do repositório.
3. `npm test`: com os dois perfis, 159 passam; sem eles, 123 passam e 36 são ignorados.
4. `npm run dev` e abrir http://localhost:5173/ para os testes provisórios na tela.
5. Configurar a identidade do Git só neste repositório: `git config user.name "Seu Nome"` e `git config user.email "seu-email"`.
6. Em PC compartilhado, apagar o login do GitHub no Gerenciador de Credenciais do Windows ao terminar.

## Decisões em aberto

- **Licença do projeto.** O MuPDF é AGPL-3.0. Distribuir o sistema com ele exige abrir o código sob termos compatíveis, ou licença comercial da Artifex. O repositório não declara licença. Registrar a escolha no trabalho (L14).
- **Rendering intent e compensação de ponto preto** do laudo (L10). Só o intent absoluto reproduz os dados de caracterização do perfil.
- **Limiar de ΔE00 do veredito.** Precisa ficar acima do piso do round-trip (até cerca de 4 ΔE00 nos casos extremos, L9). É decisão de projeto e precisa ser citada.
- **Licença da ECI no site publicado:** servir o `.icc` aos usuários exige permissão escrita da ECI; alternativa é o usuário fornecer o perfil (L11).
- **k e filtro de participação mínima** das cores dominantes em arquivos reais.

## Pendências técnicas

- Testar com PDFs reais de produção (InDesign, Illustrator, Canva): transparência, overprint, spot colors, degradês.
- Verificar o motor de cor dentro de um Web Worker e medir desempenho (Fase 5).
- Validação independente do motor de cor (ArgyllCMS, `xicclu`); hoje a referência é o dado do próprio criador do perfil.
- Leitura do `/OutputIntents` do PDF (L6); `src/lib/pdf/outputIntent.ts` ainda lança erro explícito.
- Ajustar o comentário da matriz sRGB em `colorimetry.ts` (variante de alta precisão, não a da IEC).

## Achados para a monografia

- O pdf.js converte CMYK para RGB de forma aproximada: desvio de 3,7 a 10,9 ΔE00 contra o perfil nas seis cores de teste. Lendo o CMYK do arquivo com o MuPDF, o desvio cai para menos de 0,25 (só arredondamento a 8 bits).
- Num PDF com perfil CMYK embutido (ICCBased), o MuPDF com ICC ligado altera os valores (ciano 100% virou 255/31/4/0). Com o ICC desligado, os números saem como estão no arquivo. Decisão de projeto: o perfil embutido no PDF é ignorado e os números são interpretados pelo perfil escolhido pelo usuário.
- Os dois perfis testados (FOGRA39 e FOGRA51) mostram o mesmo padrão: A2B com intent absoluto reproduz a tabela de caracterização (média 0,06 a 0,10 ΔE00); o intent relativo não (média 2,7 a 3,5).
- O sistema deve ser descrito como "simulação de conformidade" ou "pré-checagem", não como laudo de conformidade ISO 12647 (L4): a norma avalia material impresso medido com espectrofotômetro.
- Os PDFs de teste são sintéticos; os resultados em arquivos reais ainda não foram medidos.
