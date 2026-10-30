import { describe, expect, it } from 'vitest';
import { readIccHeader, readIccTag, readIccTextTag } from '../iccTags';
import { parseCharacterizationData } from '../characterization';
import { decodeCmyk16, decodeLab16, encodeCmyk16, encodeLab16 } from '../colorEngine';

// Estes testes não dependem de nenhum arquivo .icc: usam um perfil mínimo
// montado em memória e um trecho CGATS sintético.

function buildMinimalProfile(): Uint8Array {
  const text = new TextEncoder().encode('text\0\0\0\0Ola ECI\0');
  const headerAndTable = 128 + 4 + 12;
  const bytes = new Uint8Array(headerAndTable + text.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length);
  bytes[8] = 2;
  bytes[9] = 0x40; // versão 2.4.0
  bytes.set(new TextEncoder().encode('prtr'), 12);
  bytes.set(new TextEncoder().encode('CMYK'), 16);
  bytes.set(new TextEncoder().encode('Lab '), 20);
  bytes.set(new TextEncoder().encode('acsp'), 36);
  view.setUint32(128, 1); // uma tag
  bytes.set(new TextEncoder().encode('cprt'), 132);
  view.setUint32(136, headerAndTable);
  view.setUint32(140, text.length);
  bytes.set(text, headerAndTable);
  return bytes;
}

describe('Leitura de perfil ICC (iccTags)', () => {
  it('lê o cabeçalho: versão, classe, espaço de cor e PCS', () => {
    expect(readIccHeader(buildMinimalProfile())).toMatchObject({
      version: '2.4.0',
      deviceClass: 'prtr',
      colorSpace: 'CMYK',
      pcs: 'Lab',
    });
  });

  it('lê uma tag de texto e devolve null para tag inexistente', () => {
    const profile = buildMinimalProfile();
    expect(readIccTextTag(profile, 'cprt')).toBe('Ola ECI');
    expect(readIccTag(profile, 'desc')).toBeNull();
  });

  it('rejeita arquivos que não são perfis ICC', () => {
    expect(() => readIccHeader(new Uint8Array(10))).toThrow(/pequeno demais/);
    expect(() => readIccHeader(new Uint8Array(200))).toThrow(/acsp/);
  });

  it('rejeita tabela de tags truncada', () => {
    const profile = buildMinimalProfile().slice(0, 140);
    expect(() => readIccTag(profile, 'cprt')).toThrow(/truncada/);
  });
});

const CGATS = [
  'ISO28178',
  'FILE_DESCRIPTOR\t\t"FOGRA51"',
  'NUMBER_OF_FIELDS\t11',
  'BEGIN_DATA_FORMAT',
  'SAMPLE_ID CMYK_C CMYK_M CMYK_Y CMYK_K XYZ_X XYZ_Y XYZ_Z LAB_L LAB_A LAB_B ',
  'END_DATA_FORMAT',
  'NUMBER_OF_SETS\t2',
  'BEGIN_DATA',
  '1 \t0.00 \t0.00 \t0.00 \t0.00 \t80.00 \t83.00 \t60.00 \t95.00 \t1.50 \t-6.00 \t',
  '2 \t100.00 \t0.00 \t0.00 \t0.00 \t17.00 \t24.00 \t52.00 \t56.12 \t-34.90 \t-52.52 \t',
  'END_DATA',
].join('\r\n');

describe('Dados de caracterização (CGATS)', () => {
  it('interpreta descritor, CMYK e Lab pelo nome das colunas', () => {
    const data = parseCharacterizationData(CGATS);
    expect(data.descriptor).toBe('FOGRA51');
    expect(data.patches).toHaveLength(2);
    expect(data.patches[1]).toEqual({
      id: 2,
      cmyk: { c: 100, m: 0, y: 0, k: 0 },
      lab: { l: 56.12, a: -34.9, b: -52.52 },
    });
  });

  it('falha com mensagem clara quando falta uma coluna ou marcador', () => {
    expect(() => parseCharacterizationData(CGATS.replace('LAB_B', 'OUTRA'))).toThrow(/LAB_B/);
    expect(() => parseCharacterizationData('sem marcadores')).toThrow(/marcadores/);
  });
});

describe('Codificação de amostras de 16 bits', () => {
  it('Lab -> Lab_16 -> Lab erra menos de 0,005 em cada canal', () => {
    for (const lab of [
      { l: 0, a: 0, b: 0 },
      { l: 100, a: 0, b: 0 },
      { l: 95, a: 1.5, b: -6 },
      { l: 48.06, a: 75.3, b: -5.19 },
      { l: 56.12, a: -34.9, b: -52.54 },
    ]) {
      const back = decodeLab16(encodeLab16(lab));
      expect(Math.abs(back.l - lab.l)).toBeLessThan(0.005);
      expect(Math.abs(back.a - lab.a)).toBeLessThan(0.005);
      expect(Math.abs(back.b - lab.b)).toBeLessThan(0.005);
    }
  });

  it('CMYK em % -> 16 bits -> % erra menos de 0,001 ponto percentual', () => {
    const cmyk = { c: 12.5, m: 99, y: 0, k: 100 };
    const back = decodeCmyk16(encodeCmyk16(cmyk));
    for (const key of ['c', 'm', 'y', 'k'] as const) {
      expect(Math.abs(back[key] - cmyk[key])).toBeLessThan(0.001);
    }
  });

  it('limita valores fora da faixa e recusa NaN', () => {
    expect(encodeLab16({ l: 120, a: 500, b: -500 })).toEqual([65535, 65535, 0]);
    expect(encodeCmyk16({ c: -5, m: 150, y: 0, k: 0 })).toEqual([0, 65535, 0, 0]);
    expect(() => encodeLab16({ l: NaN, a: 0, b: 0 })).toThrow(/não numéricos/);
  });
});
