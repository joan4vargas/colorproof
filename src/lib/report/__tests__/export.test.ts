import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisOutcome } from '../../analysis/analysisClient';
import { compareFiles, type CompareDeps } from '../../compare/compareFiles';
import { createColorEngine, type ColorEngine, type IccProfileHandle } from '../../icc/colorEngine';
import { analyzePdf } from '../../pdf/analyzePdf';
import type { RenderOptions } from '../../pdf/renderPdf';
import { escapeHtml, flowAToCsv, flowAToHtml, flowBToCsv, flowBToHtml } from '../export';
import { evaluateFlowA } from '../flowA';

const FIXTURES = resolve(process.cwd(), 'src/lib/pdf/__fixtures__');
const fixture = (name: string) => new Uint8Array(readFileSync(resolve(FIXTURES, name)));
const PROFILE_PATH = resolve(process.cwd(), 'public/profiles/ISOcoated_v2_eci.icc');
const hasProfile = existsSync(PROFILE_PATH);
const META = { generatedAt: new Date('2026-11-17T19:00:00Z'), appVersion: '0.0.0' };

const deps: CompareDeps = {
  rgb: {
    pdfjs: pdfjs as unknown as RenderOptions['pdfjs'],
    createCanvas: (w, h) => createCanvas(w, h) as unknown as ReturnType<RenderOptions['createCanvas']>,
  },
  loadMupdf: () => import('mupdf'),
  rasterizeImage: async () => {
    throw new Error('sem imagens neste teste');
  },
};

describe('escapeHtml', () => {
  it('escapa os caracteres que quebram HTML', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });
});

describe.skipIf(!hasProfile)('exportação com ISO Coated v2', () => {
  let engine: ColorEngine;
  let profile: IccProfileHandle;
  let analysisRgb: AnalysisOutcome;
  let analysisCmyk: AnalysisOutcome;

  beforeAll(async () => {
    engine = await createColorEngine();
    profile = await engine.loadProfile(new Uint8Array(readFileSync(PROFILE_PATH)));
    const a = await analyzePdf(fixture('cores-rgb.pdf'), deps, { scale: 1, k: 6, profile });
    analysisRgb = { ...a, report: evaluateFlowA(a, profile) };
    const b = await analyzePdf(fixture('cores-cmyk.pdf'), deps, { scale: 1, k: 6, profile });
    analysisCmyk = { ...b, report: evaluateFlowA(b, profile) };
  });
  afterAll(() => {
    profile?.libera();
    engine?.dispose();
  });

  it('laudo HTML do Fluxo A: parâmetros, veredito, linhas e aviso de que não é ISO 12647', () => {
    const html = flowAToHtml({ fileName: 'arte.pdf', analysis: analysisRgb, report: analysisRgb.report! }, META);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain('ISO Coated v2 (ECI)');
    expect(html).toContain('colorimétrico relativo');
    expect(html).toContain('Reprovado'); // o azul do PDF de teste
    expect(html.match(/<tr><td><span class="sw"/g)).toHaveLength(6);
    expect(html).toContain('não</strong> é um laudo de conformidade ISO 12647');
    expect(html).toContain('2026-11-17 19:00 UTC');
    expect(html).not.toContain('ΔE00 na tela'); // só no caminho CMYK
  });

  it('caminho CMYK inclui a coluna de ΔE00 na tela', () => {
    const html = flowAToHtml({ fileName: 'a.pdf', analysis: analysisCmyk, report: analysisCmyk.report! }, META);
    expect(html).toContain('ΔE00 na tela (informativo)');
  });

  it('nome de arquivo malicioso é escapado no HTML', () => {
    const name = '"><script>alert(1)</script>.pdf';
    const html = flowAToHtml({ fileName: name, analysis: analysisRgb, report: analysisRgb.report! }, META);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('CSV do Fluxo A: BOM, separador ;, decimais com vírgula, uma linha por cor', () => {
    const csv = flowAToCsv({ fileName: 'arte.pdf', analysis: analysisRgb, report: analysisRgb.report! });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(7);
    expect(lines[0].split(';')[0]).toBe('arquivo');
    expect(lines[1]).toMatch(/;\d+,\d{4};/); // decimal com vírgula
    expect(lines[1].split(';')).toHaveLength(15);
  });

  it('CSV neutraliza nome de arquivo que parece fórmula de planilha', () => {
    const csv = flowAToCsv({ fileName: '=HYPERLINK("x")', analysis: analysisRgb, report: analysisRgb.report! });
    expect(csv.split('\r\n')[1].startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
  });

  it('laudo HTML e CSV do Fluxo B', async () => {
    const outcome = await compareFiles(
      { file: fixture('cores-rgb.pdf'), mime: 'application/pdf' },
      { file: fixture('par-simulacao-cmyk.pdf'), mime: 'application/pdf' },
      deps,
      { profile },
    );
    const data = { referenceName: 'ref.pdf', simulationName: 'sim.pdf', profileDescription: profile.description, outcome };
    const html = flowBToHtml(data, META);
    expect(html).toContain('ref.pdf (sRGB)');
    expect(html).toContain('sim.pdf (CMYK (MuPDF + perfil))');
    expect(html).toContain('percentil 95');
    expect(html).toContain('32 × 32');
    expect(html).toContain('Reprovado');
    const csv = flowBToCsv(data);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(1 + outcome.report.pages[0].worst.length);
    expect(lines[0]).toContain('uniformidade');
  });

  it('Fluxo B sem perfil informa que ele não foi usado', async () => {
    const pdf = fixture('cores-rgb.pdf');
    const outcome = await compareFiles({ file: pdf, mime: 'application/pdf' }, { file: pdf, mime: 'application/pdf' }, deps);
    const html = flowBToHtml({ referenceName: 'a.pdf', simulationName: 'a.pdf', profileDescription: null, outcome }, META);
    expect(html).toContain('não usado');
    expect(html).toContain('Aprovado');
  });
});
