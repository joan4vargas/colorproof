// Leitura mínima da estrutura binária de um perfil ICC: cabeçalho (128 bytes)
// e tabela de tags. Serve para validar o arquivo antes de entregá-lo ao lcms2
// e para extrair tags de texto (descrição, direitos autorais e os dados de
// caracterização embutidos, tag `targ`). Não interpreta LUTs: isso é papel
// do lcms2.

export interface IccHeader {
  /** Tamanho declarado no cabeçalho, em bytes. */
  size: number;
  /** Versão do perfil, ex.: "2.4.0". */
  version: string;
  /** Classe do dispositivo, ex.: "prtr" (impressora), "mntr" (monitor). */
  deviceClass: string;
  /** Espaço de cor dos dados do dispositivo, ex.: "CMYK", "RGB". */
  colorSpace: string;
  /** Espaço de conexão do perfil (PCS): "Lab" ou "XYZ". */
  pcs: string;
}

const HEADER_SIZE = 128;
const TAG_ENTRY_SIZE = 12;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = offset; i < offset + length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

export function readIccHeader(bytes: Uint8Array): IccHeader {
  if (bytes.length < HEADER_SIZE + 4) {
    throw new Error('Arquivo pequeno demais para ser um perfil ICC.');
  }
  if (ascii(bytes, 36, 4) !== 'acsp') {
    throw new Error('Assinatura "acsp" ausente: o arquivo não parece ser um perfil ICC.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    size: view.getUint32(0),
    version: `${bytes[8]}.${bytes[9] >> 4}.${bytes[9] & 0x0f}`,
    deviceClass: ascii(bytes, 12, 4),
    colorSpace: ascii(bytes, 16, 4).trim(),
    pcs: ascii(bytes, 20, 4).trim(),
  };
}

/** Devolve os bytes de uma tag (incluindo o cabeçalho de tipo) ou `null` se ela não existir. */
export function readIccTag(bytes: Uint8Array, signature: string): Uint8Array | null {
  readIccHeader(bytes); // valida o arquivo
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(HEADER_SIZE);
  const tableEnd = HEADER_SIZE + 4 + count * TAG_ENTRY_SIZE;
  if (tableEnd > bytes.length) {
    throw new Error('Tabela de tags do perfil ICC está truncada.');
  }
  for (let i = 0; i < count; i++) {
    const entry = HEADER_SIZE + 4 + i * TAG_ENTRY_SIZE;
    if (ascii(bytes, entry, 4) !== signature) continue;
    const offset = view.getUint32(entry + 4);
    const size = view.getUint32(entry + 8);
    if (offset + size > bytes.length) {
      throw new Error(`A tag "${signature}" aponta para fora do arquivo.`);
    }
    return bytes.subarray(offset, offset + size);
  }
  return null;
}

/**
 * Lê uma tag do tipo `text` (ex.: `cprt`, `targ`). O conteúdo é ASCII/Latin-1,
 * logo após a assinatura de tipo e 4 bytes reservados.
 */
export function readIccTextTag(bytes: Uint8Array, signature: string): string | null {
  const tag = readIccTag(bytes, signature);
  if (!tag || tag.length < 8 || ascii(tag, 0, 4) !== 'text') return null;
  const text = new TextDecoder('latin1').decode(tag.subarray(8));
  return text.replace(/\0+$/, '');
}
