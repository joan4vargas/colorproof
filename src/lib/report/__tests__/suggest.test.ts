import { describe, expect, it } from 'vitest';
import { deltaE2000 } from '../../../core/colorimetry';
import type { Cmyk, Lab } from '../../../types/color';
import type { RoundTripProfile } from '../flowA';
import { suggestReproducible, suggestionTarget } from '../suggest';

// Perfil de mentira: reproduz até croma 40 e corta o que passar disso.
const MAX_CHROMA = 40;
const fake: RoundTripProfile = {
  description: 'perfil de teste',
  roundTripLab(lab: Lab): Lab {
    const chroma = Math.hypot(lab.a, lab.b);
    if (chroma <= MAX_CHROMA) return lab;
    const k = MAX_CHROMA / chroma;
    return { l: lab.l, a: lab.a * k, b: lab.b * k };
  },
  labToCmyk(lab: Lab): Cmyk {
    return { c: 0, m: Math.min(100, Math.hypot(lab.a, lab.b)), y: 0, k: 100 - lab.l };
  },
};
const target = suggestionTarget(3);
const current: Cmyk = { c: 0, m: 100, y: 0, k: 20 };

describe('suggestReproducible', () => {
  it('cor fora do gamut: acha uma cor que a impressão reproduz dentro do alvo', () => {
    const original: Lab = { l: 50, a: 60, b: 20 }; // croma ~63, bem acima de 40
    const s = suggestReproducible(original, current, fake, { target })!;
    expect(s).not.toBeNull();
    expect(s.deltaEPrint).toBeLessThanOrEqual(target);
    expect(deltaE2000(s.lab, s.labPrinted)).toBeCloseTo(s.deltaEPrint, 6);
    // muda a cor do projeto menos do que a perda total da original
    const loss = deltaE2000(original, fake.roundTripLab(original));
    expect(s.deltaEFromOriginal).toBeGreaterThan(0);
    expect(s.deltaEFromOriginal).toBeLessThan(loss);
    expect(Math.hypot(s.lab.a, s.lab.b)).toBeLessThan(Math.hypot(original.a, original.b));
  });

  it('mantém o matiz: a e b mudam na mesma proporção', () => {
    const original: Lab = { l: 50, a: 60, b: 20 };
    const s = suggestReproducible(original, current, fake, { target })!;
    expect(s.lab.b / s.lab.a).toBeCloseTo(original.b / original.a, 6);
  });

  it('a mudança de cada tinta é a sugerida menos a atual', () => {
    const s = suggestReproducible({ l: 50, a: 60, b: 20 }, current, fake, { target })!;
    expect(s.cmykChange.m).toBeCloseTo(s.cmyk.m - current.m, 9);
    expect(s.cmykChange.k).toBeCloseTo(s.cmyk.k - current.k, 9);
  });

  it('cor já dentro do gamut: a sugerida é ela mesma', () => {
    const inside: Lab = { l: 60, a: 20, b: 10 };
    const s = suggestReproducible(inside, current, fake, { target })!;
    expect(s.deltaEFromOriginal).toBeCloseTo(0, 9);
  });

  it('sem nenhuma candidata dentro do alvo, devolve null', () => {
    const never: RoundTripProfile = { ...fake, roundTripLab: (l) => ({ l: l.l + 30, a: l.a, b: l.b }) };
    expect(suggestReproducible({ l: 50, a: 60, b: 20 }, current, never, { target })).toBeNull();
  });
});
