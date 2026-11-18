import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSpotColors, runPsFunction } from '../spotColors';

const fixture = (n: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'src/lib/pdf/__fixtures__', n)));
const mupdf = await import('mupdf');

describe('runPsFunction', () => {
  it('calcula a função de tinta que o reportlab grava (tinta 1 e 0,5)', () => {
    const fn = '{0.0 exch dup 0.9 mul exch dup 0.8 mul exch pop 0.0}';
    expect(runPsFunction(fn, [1]).map((v) => +v.toFixed(3))).toEqual([0, 0.9, 0.8, 0]);
    expect(runPsFunction(fn, [0.5]).map((v) => +v.toFixed(3))).toEqual([0, 0.45, 0.4, 0]);
  });
  it('roll e index', () => {
    expect(runPsFunction('{1 2 3 3 1 roll}', [])).toEqual([3, 1, 2]);
    expect(runPsFunction('{5 6 1 index}', [])).toEqual([5, 6, 5]);
  });
  it('operador desconhecido vira erro explícito', () => {
    expect(() => runPsFunction('{foo}', [1])).toThrow(/não suportado/);
  });
});

describe('listSpotColors', () => {
  it('Lab como alternativo: devolve nome, tintas usadas e o Lab em D50', () => {
    const spots = listSpotColors(mupdf, fixture('spot-lab.pdf'));
    expect(spots).toHaveLength(1);
    const s = spots[0];
    expect(s.name).toBe('PANTONE LAB TESTE C');
    expect(s.alternate).toBe('Lab');
    expect(s.tints).toEqual([1, 0.5]);
    // o arquivo declara 45/70/40 com branco D50: sem adaptação, o Lab volta igual
    expect(s.lab!.l).toBeCloseTo(45, 0);
    expect(s.lab!.a).toBeCloseTo(70, 0);
    expect(s.lab!.b).toBeCloseTo(40, 0);
    expect(s.cmyk).toBeUndefined();
  });

  it('CMYK como alternativo: devolve o CMYK e avisa que é só um substituto', () => {
    const spots = listSpotColors(mupdf, fixture('spot-cmyk.pdf'));
    const names = spots.map((s) => s.name).sort();
    expect(names).toEqual(['PANTONE TESTE A C', 'PANTONE TESTE B C']);
    const a = spots.find((s) => s.name === 'PANTONE TESTE A C')!;
    expect(a.alternate).toBe('DeviceCMYK');
    expect(a.tints).toEqual([1, 0.5]);
    expect(a.cmyk!.m).toBeCloseTo(90, 3);
    expect(a.cmyk!.y).toBeCloseTo(80, 3);
    expect(a.note).toMatch(/substituto/);
  });

  it('PDF sem spot: lista vazia', () => {
    expect(listSpotColors(mupdf, fixture('par-simulacao-cmyk.pdf'))).toEqual([]);
  });
});
