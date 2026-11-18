// Veredito por faixas de ΔE00 (simulação de conformidade).
//
// ORIGEM DOS LIMITES (revisão de 18/11/2026; antes eram 3,0 e 4,0, só decisão de projeto):
//
//  - 3,0 (aprovado): ΔE*00 máximo dos sólidos de cores primárias e de cores spot na
//    ISO 12647-7:2016 (prova contratual), Tabelas 30 e 31 do Fogra MediaStandard Print 2018.
//  - 5,0 (atenção, depois reprovado): ΔE*00 máximo de TODOS os patches e P95 na mesma
//    ISO 12647-7:2016 (Tabelas 30 e 31). Na ISO 12647-2:2013, o desvio de sólidos é
//    normativo em ΔE*ab ≤ 5 (Tabela 20 do MediaStandard Print 2018); os valores em ΔE*00
//    daquela tabela (K 5; C, M, Y 3,5) são apenas informativos.
//  - 2,5 (média): ΔE*00 médio de todos os patches (ISO 12647-7:2016, Tabelas 30 e 31),
//    usado no veredito da simulação junto com o P95.
//
// A norma define limites de aprovação; a FAIXA "atenção" entre 3,0 e 5,0 é interpretação
// do projeto (entre o limite dos sólidos e o limite de todos os patches). A norma avalia
// impressos medidos com espectrofotômetro: este programa é uma simulação numérica.
// Referências completas em docs/DOCUMENTACAO.md, seção 8c.

export type Verdict = 'aprovado' | 'atencao' | 'reprovado';

export interface VerdictThresholds {
  /** Até este valor (inclusive): aprovado. */
  approvedMax: number;
  /** Até este valor (inclusive): atenção; acima: reprovado. */
  attentionMax: number;
}

export const DEFAULT_THRESHOLDS: VerdictThresholds = { approvedMax: 3.0, attentionMax: 5.0 };

/** ΔE*00 médio máximo (ISO 12647-7:2016, Tabelas 30 e 31): acima disso a simulação não passa de "atenção". */
export const MEAN_DELTA_E_MAX = 2.5;

export function classifyDeltaE(
  deltaE: number,
  thresholds: VerdictThresholds = DEFAULT_THRESHOLDS,
): Verdict {
  if (!Number.isFinite(deltaE) || deltaE < 0) {
    throw new Error(`classifyDeltaE: ΔE inválido (${deltaE}).`);
  }
  if (thresholds.approvedMax > thresholds.attentionMax) {
    throw new Error('classifyDeltaE: o limite de aprovado não pode passar o de atenção.');
  }
  if (deltaE <= thresholds.approvedMax) return 'aprovado';
  if (deltaE <= thresholds.attentionMax) return 'atencao';
  return 'reprovado';
}

const ORDER: Record<Verdict, number> = { aprovado: 0, atencao: 1, reprovado: 2 };

/** O pior veredito de uma lista (o do laudo como um todo). Lista vazia: aprovado. */
export function worstVerdict(verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((w, v) => (ORDER[v] > ORDER[w] ? v : w), 'aprovado');
}
