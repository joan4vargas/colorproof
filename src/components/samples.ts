// Cores de tela de cada amostra do Fluxo A.

import { labD50ToRgbClipped } from '../core/colorimetry';
import type { RGB } from '../types/color';
import type { ColorFinding } from '../lib/report/flowA';
import { fmtCmyk } from './format';

export const rgbCss = (c: RGB) => `rgb(${c.r}, ${c.g}, ${c.b})`;

/** Cor da amostra como está no arquivo (sRGB, ou o CMYK do arquivo visto pelo perfil). */
export const sourceRgb = (f: ColorFinding): RGB => (f.source.kind === 'rgb' ? f.source.rgb : labD50ToRgbClipped(f.labSource));

/** Cor da amostra depois da impressão simulada (ida e volta pelo perfil). */
export const printedRgb = (f: ColorFinding): RGB => labD50ToRgbClipped(f.labRoundTrip);

export const originText = (f: ColorFinding) =>
  f.source.kind === 'rgb' ? `sRGB ${f.source.rgb.r}, ${f.source.rgb.g}, ${f.source.rgb.b}` : `CMYK ${fmtCmyk(f.source.cmyk)}`;
