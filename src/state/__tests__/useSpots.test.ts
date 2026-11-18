import { describe, expect, it } from 'vitest';
import { blankRow, rowToInput } from '../useSpots';

describe('rowToInput', () => {
  it('só o nome, sem valores: recusa em vez de virar preto (0/0/0)', () => {
    const r = rowToInput({ ...blankRow(), name: 'PANTONE 293 C' });
    expect('error' in r).toBe(true);
    if ('error' in r) expect(r.error).toContain('preencha L*, a* e b*');
  });
  it('CMYK vazio também é recusado; zero digitado é aceito', () => {
    expect('error' in rowToInput({ ...blankRow(), mode: 'cmyk' })).toBe(true);
    expect('input' in rowToInput({ ...blankRow(), mode: 'cmyk', c: '0', m: '0', y: '0', k: '0' })).toBe(true);
  });
  it('Lab com vírgula decimal é lido', () => {
    const r = rowToInput({ ...blankRow(), name: 'x', l: '32,55', a: '19,02', b: '-68' });
    expect('input' in r && r.input.ref.kind === 'lab' && r.input.ref.lab.l).toBe(32.55);
  });
});
