import { describe, expect, it } from 'vitest';
import { spotToCsv, spotToHtml, type SpotExport } from '../export';
import type { SpotMatch } from '../../spot/spotMatch';

const match = (over: Partial<SpotMatch> = {}): SpotMatch => ({
  name: 'PANTONE 186 C',
  labTarget: { l: 45, a: 70, b: 40 },
  cmyk: { c: 0, m: 100, y: 82, k: 13 },
  labPrinted: { l: 44, a: 68, b: 38 },
  deltaE: 1.35,
  verdict: 'aprovado',
  totalInk: 195,
  cmykB2A: { c: 2, m: 100, y: 82, k: 8 },
  deltaEB2A: 1.97,
  improved: true,
  reproducible: true,
  alternative: { cmyk: { c: 5, m: 100, y: 82, k: 13 }, labPrinted: { l: 44, a: 67, b: 38 }, deltaE: 1.9, verdict: 'aprovado', totalInk: 200, deltaEExtra: 0.55 },
  ...over,
});
const data = (rows: SpotExport['rows']): SpotExport => ({ profileDescription: 'ISO Coated v2 (ECI)', intent: 'relative', thresholds: { approvedMax: 3, attentionMax: 4 }, rows });
const META = { generatedAt: new Date('2026-11-18T10:00:00Z') };

describe('exportação das cores spot', () => {
  it('HTML: nome, origem, CMYK, perfil, aviso de gamut e ressalva sobre a biblioteca Pantone', () => {
    const html = spotToHtml(data([{ match: match(), origin: 'Lab declarado no PDF' }, { match: match({ name: 'Neon', verdict: 'reprovado', reproducible: false, deltaE: 9 }), origin: 'digitado' }]), META);
    expect(html).toContain('PANTONE 186 C');
    expect(html).toContain('Lab declarado no PDF');
    expect(html).toContain('0 / 100 / 82 / 13');
    expect(html).toContain('ISO Coated v2 (ECI)');
    expect(html).toContain('Fora do gamut: aproximação');
    expect(html).toContain('não distribui a biblioteca Pantone');
  });

  it('HTML escapa nome malicioso', () => {
    const html = spotToHtml(data([{ match: match({ name: '<img src=x onerror=alert(1)>' }), origin: 'digitado' }]), META);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('CSV: BOM, ;, vírgula decimal, 15 colunas e proteção contra fórmula', () => {
    const csv = spotToCsv(data([{ match: match({ name: '=SOMA(1)' }), origin: 'digitado' }]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines[0].split(';')).toHaveLength(20);
    expect(lines[1].startsWith(`"'=SOMA(1)"`) || lines[1].startsWith(`'=SOMA(1)`)).toBe(true);
    expect(lines[1]).toMatch(/1,35/);
  });

  it('exporta a segunda opção no HTML e no CSV', () => {
    const d = data([{ match: match(), origin: 'x' }]);
    expect(spotToHtml(d, META)).toContain('Segunda opção (variação próxima)');
    expect(spotToHtml(d, META)).toContain('5 / 100 / 82 / 13');
    expect(spotToCsv(d).trim().split('\r\n')[1].split(';').slice(15, 19)).toEqual(['5', '100', '82', '13']);
  });
});
