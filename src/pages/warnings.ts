import type { SpotColor } from '../lib/pdf/spotColors';

/** Avisos genéricos de CMYK/spot que o banner de cores spot substitui (o arquivo usa Pantone, não CMYK puro). */
const SPOT_SUPERSEDED = /já está em CMYK|spot colors ou espaços de cor especiais/;

export function visibleWarnings(warnings: string[], spots: SpotColor[] | null): string[] {
  return spots && spots.length > 0 ? warnings.filter((w) => !SPOT_SUPERSEDED.test(w)) : warnings;
}
