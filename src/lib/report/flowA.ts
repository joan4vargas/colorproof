// Fluxo A: simulação de conformidade por round-trip pelo perfil ICC.
//
// Para cada cor dominante extraída do arquivo:
//
//  - Caminho RGB (cor vinda de tela, sRGB): Lab de origem -> CMYK (B2A do
//    perfil) -> Lab (A2B). O ΔE00 entre o Lab de origem e o de volta mede o
//    quanto a condição de impressão consegue reproduzir aquela cor.
//    Intent relativo, sem compensação de ponto preto (decisão D1).
//
//  - Caminho CMYK (números C, M, Y, K lidos do arquivo): o Lab de origem já é
//    o que o perfil prevê para impressão (A2B). O round-trip Lab -> CMYK ->
//    Lab confere se a cor é reprodutível (piso de erro do método). Além disso
//    se informa o ΔE00 de exibição em tela (Lab -> sRGB recortado -> Lab), que
//    mede o quanto a tela consegue mostrar da cor impressa. Esse número NÃO
//    entra no veredito: é uma limitação do monitor, não da impressão.
//
// Isto é uma SIMULAÇÃO numérica (L4): não substitui medição com espectrofotômetro.

import { deltaE2000, deltaEab, deltaHab, labD50ToRgbClipped, rgbToLabD50 } from '../../core/colorimetry';
import {
  DEFAULT_THRESHOLDS,
  classifyDeltaE,
  worstVerdict,
  type Verdict,
  type VerdictThresholds,
} from '../../core/verdict';
import type { Cmyk, Lab, RGB } from '../../types/color';
import type { RenderingIntent } from '../icc/colorEngine';
import type { PdfAnalysis } from '../pdf/analyzePdf';
import { suggestReproducible, suggestionTarget, type ColorSuggestion } from './suggest';

/** O que o relatório precisa do perfil (o `IccProfileHandle` atende). */
export interface RoundTripProfile {
  description: string;
  labToCmyk(lab: Lab, intent?: RenderingIntent): Cmyk;
  roundTripLab(lab: Lab, intent?: RenderingIntent): Lab;
}

export interface ColorFinding {
  /** Cor de origem: sRGB (caminho RGB) ou CMYK (caminho CMYK). */
  source: { kind: 'rgb'; rgb: RGB } | { kind: 'cmyk'; cmyk: Cmyk };
  /** Lab de origem (sRGB convertido pelo núcleo, ou Lab que o perfil prevê para o CMYK). */
  labSource: Lab;
  /** Lab depois do round-trip pelo perfil. */
  labRoundTrip: Lab;
  /** CMYK (%) que o perfil usaria para reproduzir `labSource`. */
  cmykReproduced: Cmyk;
  /** ΔE00 entre `labSource` e `labRoundTrip`: base do veredito. */
  deltaE: number;
  /** ΔE*ab (CIE 1976), a métrica normativa da ISO 12647-2: informativa, não entra no veredito. */
  deltaEab: number;
  /** ΔH*ab (diferença de matiz, CIELAB). */
  deltaH: number;
  verdict: Verdict;
  /** Só caminho CMYK: ΔE00 entre a cor impressa prevista e o que um monitor sRGB mostra. */
  screenDeltaE?: number;
  /** Fração de todos os pixels (papel incluído) que esta cor ocupa. */
  pixelShare: number;
  /**
   * Só cores sRGB que não ficaram aprovadas: uma cor próxima que a impressão
   * reproduz dentro do limite. `null` quando a busca não achou nenhuma.
   */
  suggestion?: ColorSuggestion | null;
  /** Dispersão do cluster (ΔE00): alta indica degradê ou foto, cor "média". */
  spread: number;
}

export interface FlowAReport {
  profileDescription: string;
  intent: RenderingIntent;
  path: PdfAnalysis['path'];
  thresholds: VerdictThresholds;
  findings: ColorFinding[];
  /** Pior veredito entre as cores. */
  verdict: Verdict;
  warnings: string[];
}

export interface FlowAOptions {
  intent?: RenderingIntent;
  thresholds?: VerdictThresholds;
  /** Cores com participação menor que isto (fração de todos os pixels) são ignoradas. Padrão 0. */
  minPixelShare?: number;
}

/** Dispersão (ΔE00) a partir da qual a cor "dominante" é só uma média (ver docs 8.6). */
export const HIGH_SPREAD = 5;

export function evaluateFlowA(
  analysis: PdfAnalysis,
  profile: RoundTripProfile,
  options: FlowAOptions = {},
): FlowAReport {
  const { intent = 'relative', thresholds = DEFAULT_THRESHOLDS, minPixelShare = 0 } = options;
  const warnings = [...analysis.warnings];
  const findings: ColorFinding[] = [];

  const evaluate = (
    source: ColorFinding['source'],
    labSource: Lab,
    pixelShare: number,
    spread: number,
  ): void => {
    if (pixelShare < minPixelShare) return;
    const labRoundTrip = profile.roundTripLab(labSource, intent);
    const deltaE = deltaE2000(labSource, labRoundTrip);
    const finding: ColorFinding = {
      source,
      labSource,
      labRoundTrip,
      cmykReproduced: profile.labToCmyk(labSource, intent),
      deltaE,
      deltaEab: deltaEab(labSource, labRoundTrip),
      deltaH: deltaHab(labSource, labRoundTrip),
      verdict: classifyDeltaE(deltaE, thresholds),
      pixelShare,
      spread,
    };
    if (source.kind === 'rgb' && finding.verdict !== 'aprovado') {
      finding.suggestion = suggestReproducible(labSource, finding.cmykReproduced, profile, {
        intent,
        target: suggestionTarget(thresholds.approvedMax),
      });
    }
    if (source.kind === 'cmyk') {
      finding.screenDeltaE = deltaE2000(labSource, rgbToLabD50(labD50ToRgbClipped(labSource)));
    }
    findings.push(finding);
  };

  if (analysis.path === 'rgb') {
    if (!analysis.rgb) throw new Error('evaluateFlowA: análise RGB sem cores.');
    for (const c of analysis.rgb.colors) {
      evaluate({ kind: 'rgb', rgb: c.rgb }, rgbToLabD50(c.rgb), c.pixelShare, c.spread);
    }
  } else {
    if (!analysis.cmyk) throw new Error('evaluateFlowA: análise CMYK sem cores.');
    for (const c of analysis.cmyk.colors) {
      evaluate({ kind: 'cmyk', cmyk: c.cmyk }, c.labExact ?? c.lab, c.pixelShare, c.spread);
    }
  }

  if (findings.some((f) => f.spread > HIGH_SPREAD)) {
    warnings.push(
      `Há cores com dispersão acima de ${HIGH_SPREAD} ΔE00 (degradês ou fotografias): a cor dominante ali é uma média e o veredito dela é aproximado.`,
    );
  }
  if (findings.length === 0) warnings.push('Nenhuma cor com tinta foi encontrada para avaliar.');

  return {
    profileDescription: profile.description,
    intent,
    path: analysis.path,
    thresholds,
    findings,
    verdict: worstVerdict(findings.map((f) => f.verdict)),
    warnings,
  };
}
