import { describe, expect, it } from 'vitest';
import type { SpotColor } from '../../lib/pdf/spotColors';
import { visibleWarnings } from '../warnings';

const W = ['O PDF já está em CMYK: a imagem mostra como o perfil reproduz esses valores.', 'O PDF tem degradês, spot colors ou espaços de cor especiais, lidos como o MuPDF os converte.', 'Outro aviso.'];
const spot = { name: 'PANTONE 293 C' } as SpotColor;

describe('visibleWarnings', () => {
  it('com spots no PDF, esconde os avisos genéricos de CMYK/spot e mantém os outros', () => {
    expect(visibleWarnings(W, [spot])).toEqual(['Outro aviso.']);
  });
  it('sem spots (ou ainda desconhecido), mantém todos', () => {
    expect(visibleWarnings(W, [])).toEqual(W);
    expect(visibleWarnings(W, null)).toEqual(W);
  });
});
