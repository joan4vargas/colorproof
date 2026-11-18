import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deltaE2000, rgbToLabD50 } from '../../../core/colorimetry';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { suggestReproducible, suggestionTarget } from '../suggest';

const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');

describe.skipIf(!existsSync(PROFILE_PATH))('sugestão com ISO Coated v2', () => {
  let engine: ColorEngine;
  let profile: IccProfileHandle;
  beforeAll(async () => {
    engine = await createColorEngine();
    profile = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)));
  });
  afterAll(() => {
    profile?.libera();
    engine?.dispose();
  });

  const cases = [
    { name: 'azul saturado', rgb: { r: 0, g: 70, b: 255 } },
    { name: 'vinho escuro', rgb: { r: 108, g: 0, b: 34 } },
    { name: 'verde vivo', rgb: { r: 0, g: 200, b: 120 } },
  ];

  it.each(cases)('$name: a sugerida é reproduzível e a original só muda o necessário', ({ rgb }) => {
    const lab = rgbToLabD50(rgb);
    const current = profile.labToCmyk(lab);
    const loss = deltaE2000(lab, profile.roundTripLab(lab));
    const s = suggestReproducible(lab, current, profile, { target: suggestionTarget(3) })!;
    expect(s).not.toBeNull();
    expect(s.deltaEPrint).toBeLessThanOrEqual(suggestionTarget(3) + 1e-9);
    expect(s.deltaEFromOriginal).toBeLessThan(loss + 1e-9);
  });
});
