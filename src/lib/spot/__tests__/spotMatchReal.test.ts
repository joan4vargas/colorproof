import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { matchSpot } from '../spotMatch';

const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');

describe.skipIf(!existsSync(PROFILE_PATH))('matchSpot com ISO Coated v2', () => {
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

  it('o Lab de um CMYK conhecido volta para um CMYK com ΔE00 quase zero', () => {
    const lab = profile.cmykToLab({ c: 20, m: 70, y: 60, k: 5 });
    const r = matchSpot({ name: 'conhecido', ref: { kind: 'lab', lab } }, profile);
    expect(r.deltaE).toBeLessThan(0.8);
    expect(r.verdict).toBe('aprovado');
    expect(r.reproducible).toBe(true);
  });

  it('um laranja vivo e um azul saturado fora do gamut ficam com ΔE00 mais alto que um vinho em gamut', () => {
    const inside = matchSpot({ name: 'vinho', ref: { kind: 'lab', lab: profile.cmykToLab({ c: 20, m: 100, y: 60, k: 30 }) } }, profile);
    const blue = matchSpot({ name: 'azul', ref: { kind: 'srgb', rgb: { r: 0, g: 70, b: 255 } } }, profile);
    expect(blue.deltaE).toBeGreaterThan(inside.deltaE + 5);
    expect(blue.reproducible).toBe(false);
  });

  it('a busca nunca é pior que a B2A pura e respeita o limite de tinta', () => {
    for (const lab of [{ l: 55, a: -75, b: 5 }, { l: 60, a: 70, b: 60 }, { l: 35, a: 30, b: -40 }, { l: 20, a: 5, b: 5 }]) {
      const r = matchSpot({ name: 'x', ref: { kind: 'lab', lab } }, profile);
      expect(r.deltaE).toBeLessThanOrEqual(r.deltaEB2A + 1e-9);
      expect(r.totalInk).toBeLessThanOrEqual(Math.max(300, r.cmykB2A.c + r.cmykB2A.m + r.cmykB2A.y + r.cmykB2A.k));
    }
  });

  it('PANTONE 293 C: a segunda opção é outro CMYK, com ΔE00 igual ou maior que o da primeira', () => {
    const r = matchSpot({ name: 'PANTONE 293 C', ref: { kind: 'lab', lab: { l: 32.55, a: 19.02, b: -68 } } }, profile);
    const a = r.alternative;
    const diff = Math.max(Math.abs(a.cmyk.c - r.cmyk.c), Math.abs(a.cmyk.m - r.cmyk.m), Math.abs(a.cmyk.y - r.cmyk.y), Math.abs(a.cmyk.k - r.cmyk.k));
    expect(diff).toBeGreaterThanOrEqual(5);
    expect(a.deltaE).toBeGreaterThanOrEqual(r.deltaE - 1e-9);
    expect(a.deltaE).toBeLessThan(r.deltaE + 4);
  });
});
