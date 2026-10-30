import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../colorEngine';
import { readCharacterizationFromProfile, type CharacterizationPatch } from '../characterization';
import { deltaE2000, rgbToLabD50 } from '../../../core/colorimetry';
import type { RGB } from '../../../types/color';

// ---------------------------------------------------------------------------
// Parte 1: motor de cor contra o núcleo matemático (não precisa de .icc)
// ---------------------------------------------------------------------------

let engine: ColorEngine;
beforeAll(async () => {
  engine = await createColorEngine();
});
afterAll(() => engine?.dispose());

const SRGB_SAMPLES: Record<string, RGB> = {
  branco: { r: 255, g: 255, b: 255 },
  preto: { r: 0, g: 0, b: 0 },
  vermelho: { r: 255, g: 0, b: 0 },
  verde: { r: 0, g: 255, b: 0 },
  azul: { r: 0, g: 0, b: 255 },
  amarelo: { r: 255, g: 255, b: 0 },
  ciano: { r: 0, g: 255, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  'cinza 18%': { r: 119, g: 119, b: 119 },
  laranja: { r: 255, g: 128, b: 0 },
  marrom: { r: 139, g: 69, b: 19 },
  'verde escuro': { r: 0, g: 100, b: 0 },
  'cinza claro': { r: 200, g: 200, b: 200 },
};

describe('sRGB -> Lab D50: lcms2 contra o núcleo (src/core)', () => {
  // Fecha a pendência L8 da documentação: o núcleo usa o branco D50 com
  // Z = 82,521 e o lcms2 usa o do ICC (Z = 0,8249). Na execução observada a
  // maior diferença foi ΔE00 ≈ 0,016 (marrom); o limite abaixo é guarda de
  // regressão com folga de cerca de 3x.
  for (const [name, rgb] of Object.entries(SRGB_SAMPLES)) {
    it(`${name}: ΔE00 < 0,05`, () => {
      const dE = deltaE2000(engine.srgbToLab(rgb), rgbToLabD50(rgb));
      expect(dE).toBeLessThan(0.05);
    });
  }
});

// ---------------------------------------------------------------------------
// Parte 2: perfil PSO Coated v3 (precisa do .icc local, que não vai para o Git)
// ---------------------------------------------------------------------------

const PROFILE_PATH =
  process.env.PSOCOATED_V3_PATH ?? resolve(process.cwd(), 'public/profiles/PSOcoated_v3.icc');
const hasProfile = existsSync(PROFILE_PATH);

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return { mean, p95: sorted[Math.floor(0.95 * sorted.length)], max: sorted[sorted.length - 1] };
}

describe.skipIf(!hasProfile)('PSO Coated v3 (FOGRA51): dados de caracterização do próprio perfil', () => {
  let profile: IccProfileHandle;
  let patches: CharacterizationPatch[];

  beforeAll(async () => {
    const bytes = new Uint8Array(readFileSync(PROFILE_PATH));
    profile = await engine.loadProfile(bytes, 'PSOcoated_v3');
    const data = readCharacterizationFromProfile(bytes);
    expect(data?.descriptor).toBe('FOGRA51');
    patches = data!.patches;
  });
  afterAll(() => profile?.libera());

  it('abre o perfil e lê a descrição', () => {
    expect(profile.description).toBe('PSO Coated v3');
  });

  it('o perfil traz 1617 patches de caracterização', () => {
    expect(patches).toHaveLength(1617);
  });

  it('A2B absoluto reproduz o Lab de caracterização (média < 0,20; p95 < 0,50; máx < 1,00 ΔE00)', () => {
    const s = stats(patches.map((p) => deltaE2000(profile.cmykToLab(p.cmyk, 'absolute'), p.lab)));
    expect(s.mean).toBeLessThan(0.2);
    expect(s.p95).toBeLessThan(0.5);
    expect(s.max).toBeLessThan(1.0);
  });

  it('papel e sólidos C, M, Y, K coincidem com a tabela (ΔE00 < 0,10)', () => {
    const solids = [
      { c: 0, m: 0, y: 0, k: 0 },
      { c: 100, m: 0, y: 0, k: 0 },
      { c: 0, m: 100, y: 0, k: 0 },
      { c: 0, m: 0, y: 100, k: 0 },
      { c: 0, m: 0, y: 0, k: 100 },
    ];
    for (const cmyk of solids) {
      const ref = patches.find(
        (p) => p.cmyk.c === cmyk.c && p.cmyk.m === cmyk.m && p.cmyk.y === cmyk.y && p.cmyk.k === cmyk.k,
      );
      expect(ref, `patch ${JSON.stringify(cmyk)} não encontrado`).toBeDefined();
      expect(deltaE2000(profile.cmykToLab(cmyk, 'absolute'), ref!.lab)).toBeLessThan(0.1);
    }
  });

  it('o intent relativo NÃO reproduz o Lab absoluto da tabela (o intent importa)', () => {
    // Documenta a conclusão da Fase 3: comparar com os alvos da norma exige
    // intent absoluto. Se este teste falhar, a conclusão precisa ser revista.
    const s = stats(patches.map((p) => deltaE2000(profile.cmykToLab(p.cmyk, 'relative'), p.lab)));
    expect(s.mean).toBeGreaterThan(1);
  });

  it('round-trip Lab -> CMYK -> Lab nos patches: piso de erro conhecido', () => {
    // Estes limites são guarda contra regressão, calculados a partir da
    // execução observada. Não são tolerâncias da norma.
    for (const intent of ['relative', 'absolute'] as const) {
      const s = stats(patches.map((p) => deltaE2000(profile.roundTripLab(p.lab, intent), p.lab)));
      expect(s.mean, `média (${intent})`).toBeLessThan(0.6);
      expect(s.p95, `p95 (${intent})`).toBeLessThan(2.0);
      expect(s.max, `máx (${intent})`).toBeLessThan(4.5);
    }
  });

  it('labToCmyk devolve percentuais válidos e preto aproximado para Lab escuro', () => {
    const cmyk = profile.labToCmyk({ l: 16, a: 0, b: 0 }, 'absolute');
    for (const v of [cmyk.c, cmyk.m, cmyk.y, cmyk.k]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(cmyk.k).toBeGreaterThan(80);
  });

  it('rgbToDeviceCmyk (sanidade): branco sem tinta, preto com muita tinta', () => {
    const white = profile.rgbToDeviceCmyk({ r: 255, g: 255, b: 255 });
    expect(white.c + white.m + white.y + white.k).toBeLessThan(5);
    const black = profile.rgbToDeviceCmyk({ r: 0, g: 0, b: 0 });
    expect(black.k).toBeGreaterThan(80);
  });

  it('libera() é idempotente e bloqueia uso posterior', async () => {
    const extra = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)));
    extra.libera();
    extra.libera();
    expect(() => extra.cmykToLab({ c: 0, m: 0, y: 0, k: 0 })).toThrow(/liberado/);
  });
});

describe('loadProfile: entradas inválidas', () => {
  it('recusa arquivo que não é perfil ICC', async () => {
    await expect(engine.loadProfile(new Uint8Array(500))).rejects.toThrow(/acsp/);
  });
});
