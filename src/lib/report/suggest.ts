// Sugestão de cor reproduzível para uma amostra que não ficou conforme.
//
// O que se pode ajustar, e o que não: se a cor sai do gamut da condição de
// impressão, nenhum valor de ciano, magenta, amarelo ou preto faz a impressora
// chegar nela, porque o CMYK que o perfil já usa é o mais próximo que ela
// alcança. O que dá para mudar é a cor do projeto: trocá-la por uma que a
// impressão reproduz de verdade. Esta função procura essa cor.
//
// Método: parte da cor de origem em Lab e varre variações de luminosidade
// (±MAX_DL) e de croma (de 100% a 0%), com o matiz (hue) fixo. Para cada
// candidata roda o round-trip pelo perfil e aceita a que fica com ΔE00 de
// round-trip dentro do alvo. Escolhe a aceita que menos se afasta da original
// (ΔE00). Não é uma otimização global do CMYK: é um mapeamento de gamut
// simples, fácil de explicar numa banca.

import { deltaE2000, labD50ToRgbClipped } from '../../core/colorimetry';
import type { Cmyk, Lab, RGB } from '../../types/color';
import type { RenderingIntent } from '../icc/colorEngine';
import type { RoundTripProfile } from './flowA';

export interface ColorSuggestion {
  /** Lab da cor sugerida (a que se coloca no projeto). */
  lab: Lab;
  /** Essa cor em sRGB (recortada), para o arquivo de tela. */
  rgb: RGB;
  /** CMYK (%) que o perfil usa para reproduzi-la. */
  cmyk: Cmyk;
  /** Como a impressão a reproduz (Lab depois do round-trip). */
  labPrinted: Lab;
  /** ΔE00 entre a sugerida e a impressa dela: fica dentro do alvo de conformidade. */
  deltaEPrint: number;
  /** ΔE00 entre a original e a sugerida: o quanto a cor muda no projeto. */
  deltaEFromOriginal: number;
  /** Mudança em cada tinta, em pontos percentuais, em relação ao CMYK que o perfil usaria na original. */
  cmykChange: Cmyk;
}

export interface SuggestOptions {
  intent?: RenderingIntent;
  /** ΔE00 de round-trip aceito para a sugerida. */
  target: number;
  /** Variação máxima de luminosidade (L*) explorada. Padrão 10. */
  maxDeltaL?: number;
  /** Passo do croma (fração). Padrão 0,02. */
  chromaStep?: number;
}

export const SUGGESTION_MARGIN = 0.85;

/** Alvo de round-trip: uma margem abaixo do limite de aprovação, para a sugestão não nascer na beirada. */
export const suggestionTarget = (approvedMax: number) => approvedMax * SUGGESTION_MARGIN;

export function suggestReproducible(
  lab: Lab,
  currentCmyk: Cmyk,
  profile: RoundTripProfile,
  options: SuggestOptions,
): ColorSuggestion | null {
  const { intent = 'relative', target, maxDeltaL = 10, chromaStep = 0.02 } = options;
  let best: { lab: Lab; printed: Lab; roundTrip: number; cost: number } | null = null;

  for (let dl = -maxDeltaL; dl <= maxDeltaL; dl++) {
    const l = lab.l + dl;
    if (l < 0 || l > 100) continue;
    for (let s = 1; s >= -1e-9; s -= chromaStep) {
      const scale = Math.max(0, s);
      const candidate: Lab = { l, a: lab.a * scale, b: lab.b * scale };
      const printed = profile.roundTripLab(candidate, intent);
      const roundTrip = deltaE2000(candidate, printed);
      if (roundTrip > target) continue;
      const cost = deltaE2000(lab, candidate);
      if (!best || cost < best.cost) best = { lab: candidate, printed, roundTrip, cost };
      break; // mais croma já foi testado; a primeira que passa é a de maior croma desta luminosidade
    }
  }
  if (!best) return null;

  const cmyk = profile.labToCmyk(best.lab, intent);
  return {
    lab: best.lab,
    rgb: labD50ToRgbClipped(best.lab),
    cmyk,
    labPrinted: best.printed,
    deltaEPrint: best.roundTrip,
    deltaEFromOriginal: best.cost,
    cmykChange: { c: cmyk.c - currentCmyk.c, m: cmyk.m - currentCmyk.m, y: cmyk.y - currentCmyk.y, k: cmyk.k - currentCmyk.k },
  };
}
