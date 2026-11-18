// Melhor CMYK para uma cor spot (Pantone) numa condição de impressão.
//
// Entrada: o valor de referência da cor em Lab (D50), ou em sRGB ou CMYK (que
// o código converte). A biblioteca de cores Pantone é proprietária e NÃO vem
// com o app; o valor de referência vem do arquivo (Lab do spot), de quem
// digita (Pantone Connect, Color Bridge) ou de uma medição do impresso.
//
// Método:
//  1. Lab -> CMYK pela B2A do perfil (ponto de partida, respeita o limite de tinta do perfil).
//  2. Busca local nos 4 canais, em passos decrescentes, minimizando o ΔE00 entre o
//     Lab de referência e o que a A2B do perfil prevê para o CMYK. Ajuda quando a cor
//     está fora do gamut: a B2A recorta pelo critério do perfil, e a busca procura o
//     CMYK realmente mais próximo.
//  3. Arredonda para inteiros (é o que se digita num arquivo) e guarda o melhor
//     entre o resultado da busca e o da B2A.
// Fora do gamut nenhum CMYK chega na cor: o resultado é a melhor aproximação e o
// ΔE00 dela diz o tamanho da perda.

import { deltaE2000, labD50ToRgbClipped, rgbToLabD50 } from '../../core/colorimetry';
import { DEFAULT_THRESHOLDS, classifyDeltaE, type Verdict, type VerdictThresholds } from '../../core/verdict';
import type { Cmyk, Lab, RGB } from '../../types/color';
import type { RenderingIntent } from '../icc/colorEngine';

export interface SpotProfile {
  description: string;
  labToCmyk(lab: Lab, intent?: RenderingIntent): Cmyk;
  cmykToLab(cmyk: Cmyk, intent?: RenderingIntent): Lab;
}

export type SpotReference = { kind: 'lab'; lab: Lab } | { kind: 'srgb'; rgb: RGB } | { kind: 'cmyk'; cmyk: Cmyk };

export interface SpotInput {
  name: string;
  ref: SpotReference;
}

/** Variação próxima: outro CMYK, com ΔE00 o menor possível, que difere do principal em pelo menos ALT_MIN_STEP pontos em algum canal. */
export interface SpotAlternative {
  cmyk: Cmyk;
  labPrinted: Lab;
  deltaE: number;
  verdict: Verdict;
  totalInk: number;
  /** ΔE00 desta opção menos o da principal (≥ 0). */
  deltaEExtra: number;
}

export interface SpotMatch {
  name: string;
  /** Lab (D50) usado como referência. */
  labTarget: Lab;
  /** Melhor CMYK (%), inteiros. */
  cmyk: Cmyk;
  /** Como a impressão reproduz esse CMYK (Lab). */
  labPrinted: Lab;
  deltaE: number;
  verdict: Verdict;
  /** Soma das tintas (%). */
  totalInk: number;
  /** Resultado só pela B2A, para comparação. */
  cmykB2A: Cmyk;
  deltaEB2A: number;
  /** A busca melhorou o ΔE00 em relação à B2A em mais de 0,05? */
  improved: boolean;
  /** ΔE00 dentro do limite de aprovação: a cor é reproduzível em CMYK. */
  reproducible: boolean;
  /** Segunda opção para comparar em prova impressa (ver `SpotAlternative`). */
  alternative: SpotAlternative;
}

/** Diferença mínima (pontos de tinta, em algum canal) para a segunda opção contar como outra. */
export const ALT_MIN_STEP = 5;

export interface SpotOptions {
  intent?: RenderingIntent;
  thresholds?: VerdictThresholds;
}

const CHANNELS = ['c', 'm', 'y', 'k'] as const;
const sum = (c: Cmyk) => c.c + c.m + c.y + c.k;
const clamp = (v: number) => Math.min(100, Math.max(0, v));
const roundCmyk = (c: Cmyk): Cmyk => ({ c: Math.round(c.c), m: Math.round(c.m), y: Math.round(c.y), k: Math.round(c.k) });

const maxChannelDiff = (a: Cmyk, b: Cmyk) => Math.max(...CHANNELS.map((ch) => Math.abs(a[ch] - b[ch])));

/** Melhor CMYK (menor ΔE00) a pelo menos ALT_MIN_STEP do principal: parte de 8 vizinhos a 6 pontos de distância. */
function nearbyAlternative(main: Cmyk, error: (c: Cmyk) => number, maxInk: number): Cmyk {
  const minDiff = ALT_MIN_STEP + 0.5; // folga para o arredondamento final
  let best: Cmyk | null = null;
  let bestE = Infinity;
  for (const ch of CHANNELS) {
    for (const dir of [1, -1]) {
      const start = { ...main, [ch]: clamp(main[ch] + dir * (minDiff + 0.5)) };
      if (maxChannelDiff(start, main) < minDiff || sum(start) > maxInk) continue;
      let cur = start;
      let curE = error(cur);
      for (let step = 4; step >= 0.25; step /= 2) {
        for (let guard = 0, improved = true; improved && guard < 60; guard++) {
          improved = false;
          for (const c2 of CHANNELS) {
            for (const d2 of [1, -1]) {
              const cand = { ...cur, [c2]: clamp(cur[c2] + d2 * step) };
              if (cand[c2] === cur[c2] || sum(cand) > maxInk || maxChannelDiff(cand, main) < minDiff) continue;
              const e = error(cand);
              if (e < curE - 1e-6) {
                cur = cand;
                curE = e;
                improved = true;
              }
            }
          }
        }
      }
      if (curE < bestE) {
        best = cur;
        bestE = curE;
      }
    }
  }
  // Sem vizinho possível (por exemplo, tudo no limite de tinta): devolve o principal deslocado, o que não deve ocorrer.
  return roundCmyk(best ?? main);
}

export function referenceToLab(ref: SpotReference, profile: SpotProfile, intent: RenderingIntent): Lab {
  if (ref.kind === 'lab') return ref.lab;
  if (ref.kind === 'srgb') return rgbToLabD50(ref.rgb);
  return profile.cmykToLab(ref.cmyk, intent);
}

export function matchSpot(input: SpotInput, profile: SpotProfile, options: SpotOptions = {}): SpotMatch {
  const { intent = 'relative', thresholds = DEFAULT_THRESHOLDS } = options;
  const target = referenceToLab(input.ref, profile, intent);
  const error = (c: Cmyk) => deltaE2000(target, profile.cmykToLab(c, intent));

  const b2a = profile.labToCmyk(target, intent);
  const maxInk = Math.max(300, sum(b2a)); // não passa do que a B2A já usou, nem de 300% quando ela usa menos
  let best: Cmyk = { ...b2a };
  let bestE = error(best);
  for (let step = 8; step >= 0.25; step /= 2) {
    for (let guard = 0, improved = true; improved && guard < 60; guard++) {
      improved = false;
      for (const ch of CHANNELS) {
        for (const dir of [1, -1]) {
          const cand = { ...best, [ch]: clamp(best[ch] + dir * step) };
          if (cand[ch] === best[ch] || sum(cand) > maxInk) continue;
          const e = error(cand);
          if (e < bestE - 1e-6) {
            best = cand;
            bestE = e;
            improved = true;
          }
        }
      }
    }
  }

  const rounded = roundCmyk(best);
  const b2aRounded = roundCmyk(b2a);
  const eRounded = error(rounded);
  const eB2a = error(b2aRounded);
  const useSearch = eRounded <= eB2a;
  let cmyk = useSearch ? rounded : b2aRounded;
  let deltaE = useSearch ? eRounded : eB2a;

  let altCmyk = nearbyAlternative(cmyk, error, maxInk);
  let altE = error(altCmyk);
  if (altE < deltaE - 1e-6) {
    // A busca local não achou o melhor: o vizinho é melhor, então passa a ser a primeira opção.
    [cmyk, altCmyk] = [altCmyk, cmyk];
    [deltaE, altE] = [altE, deltaE];
  }

  return {
    name: input.name,
    labTarget: target,
    cmyk,
    labPrinted: profile.cmykToLab(cmyk, intent),
    deltaE,
    verdict: classifyDeltaE(deltaE, thresholds),
    totalInk: sum(cmyk),
    cmykB2A: b2aRounded,
    deltaEB2A: eB2a,
    improved: eB2a - deltaE > 0.05,
    reproducible: deltaE <= thresholds.approvedMax,
    alternative: {
      cmyk: altCmyk,
      labPrinted: profile.cmykToLab(altCmyk, intent),
      deltaE: altE,
      verdict: classifyDeltaE(altE, thresholds),
      totalInk: sum(altCmyk),
      deltaEExtra: Math.max(0, altE - deltaE),
    },
  };
}

/** Cores de tela do alvo e do impresso, para as amostras na interface. */
export const spotSwatches = (m: SpotMatch) => ({ target: labD50ToRgbClipped(m.labTarget), printed: labD50ToRgbClipped(m.labPrinted) });
