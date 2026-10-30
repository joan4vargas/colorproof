// Perfis ICC de impressão publicados pela ECI trazem, na tag `targ`, os dados
// de caracterização que deram origem ao perfil (arquivo CGATS, ISO 28178):
// para cada patch, o CMYK impresso (em %) e o XYZ/Lab medido. Isso dá uma
// referência para conferir o motor de cor sem depender de arquivo externo.
//
// Atenção: é a referência do próprio criador do perfil, não uma validação
// independente. A validação independente (ex.: ArgyllCMS) continua pendente.

import type { Cmyk, Lab } from '../../types/color';
import { readIccTextTag } from './iccTags';

export interface CharacterizationPatch {
  id: number;
  cmyk: Cmyk;
  lab: Lab;
}

export interface CharacterizationData {
  /** Nome da caracterização, ex.: "FOGRA51". */
  descriptor: string | null;
  patches: CharacterizationPatch[];
}

function metadata(lines: string[], key: string): string | null {
  for (const line of lines) {
    const match = new RegExp(`^${key}\\s+"?(.*?)"?\\s*$`).exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

/** Interpreta o texto CGATS, localizando as colunas pelo nome (não pela posição). */
export function parseCharacterizationData(text: string): CharacterizationData {
  const lines = text.split(/\r?\n/);
  const trimmed = lines.map((l) => l.trim());

  const formatStart = trimmed.indexOf('BEGIN_DATA_FORMAT');
  const formatEnd = trimmed.indexOf('END_DATA_FORMAT');
  const dataStart = trimmed.indexOf('BEGIN_DATA');
  const dataEnd = trimmed.indexOf('END_DATA');
  if (formatStart < 0 || formatEnd < 0 || dataStart < 0 || dataEnd < 0) {
    throw new Error('Texto CGATS inválido: faltam marcadores BEGIN/END_DATA(_FORMAT).');
  }

  const fields = trimmed
    .slice(formatStart + 1, formatEnd)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);
  const col = (name: string): number => {
    const index = fields.indexOf(name);
    if (index < 0) throw new Error(`Texto CGATS sem a coluna ${name}.`);
    return index;
  };
  const iId = col('SAMPLE_ID');
  const iC = col('CMYK_C');
  const iM = col('CMYK_M');
  const iY = col('CMYK_Y');
  const iK = col('CMYK_K');
  const iL = col('LAB_L');
  const iA = col('LAB_A');
  const iB = col('LAB_B');

  const patches: CharacterizationPatch[] = [];
  for (const line of trimmed.slice(dataStart + 1, dataEnd)) {
    if (!line) continue;
    const v = line.split(/\s+/).map(Number);
    if (v.length < fields.length || v.some((n) => Number.isNaN(n))) {
      throw new Error(`Linha de dados CGATS inválida: "${line}"`);
    }
    patches.push({
      id: v[iId],
      cmyk: { c: v[iC], m: v[iM], y: v[iY], k: v[iK] },
      lab: { l: v[iL], a: v[iA], b: v[iB] },
    });
  }

  return { descriptor: metadata(lines, 'FILE_DESCRIPTOR'), patches };
}

/** Extrai e interpreta a tag `targ` de um perfil, se existir. */
export function readCharacterizationFromProfile(
  profileBytes: Uint8Array,
): CharacterizationData | null {
  const text = readIccTextTag(profileBytes, 'targ');
  return text ? parseCharacterizationData(text) : null;
}
