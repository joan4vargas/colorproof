import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, MEAN_DELTA_E_MAX, classifyDeltaE, worstVerdict } from '../verdict';

describe('classifyDeltaE (limites 3,0 e 5,0, da ISO 12647-7:2016)', () => {
  it('limites inclusivos: 3,0 é aprovado e 5,0 é atenção', () => {
    expect(classifyDeltaE(0)).toBe('aprovado');
    expect(classifyDeltaE(3.0)).toBe('aprovado');
    expect(classifyDeltaE(3.0001)).toBe('atencao');
    expect(classifyDeltaE(5.0)).toBe('atencao');
    expect(classifyDeltaE(5.0001)).toBe('reprovado');
    expect(classifyDeltaE(20)).toBe('reprovado');
  });

  it('aceita limites próprios', () => {
    expect(classifyDeltaE(2.5, { approvedMax: 2, attentionMax: 3 })).toBe('atencao');
  });

  it('recusa valores inválidos e limites invertidos', () => {
    expect(() => classifyDeltaE(NaN)).toThrow();
    expect(() => classifyDeltaE(-1)).toThrow();
    expect(() => classifyDeltaE(1, { approvedMax: 5, attentionMax: 4 })).toThrow();
  });
});

describe('worstVerdict', () => {
  it('devolve o pior; lista vazia é aprovado', () => {
    expect(worstVerdict([])).toBe('aprovado');
    expect(worstVerdict(['aprovado', 'atencao'])).toBe('atencao');
    expect(worstVerdict(['atencao', 'reprovado', 'aprovado'])).toBe('reprovado');
  });
});

describe('limites de referência', () => {
  it('valores da ISO 12647-7:2016 (Fogra MediaStandard Print 2018, Tabelas 30 e 31)', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ approvedMax: 3.0, attentionMax: 5.0 });
    expect(MEAN_DELTA_E_MAX).toBe(2.5);
  });
});
