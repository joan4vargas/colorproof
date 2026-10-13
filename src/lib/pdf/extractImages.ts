// Fase 4 do roteiro: extração de cor do PDF.
//
// Responsabilidade deste módulo: usar pdf.js para navegar a árvore de
// objetos do PDF e extrair os XObjects de imagem embutidos, junto do
// colorspace declarado (quando disponível) — sem rasterizar a página
// inteira via canvas, para não perder a informação de cor original antes
// da hora (ver discussão sobre getImageData no início do projeto).
//
// Dependência a instalar quando esta fase começar: `pdfjs-dist`.
//   npm install pdfjs-dist

export interface ExtractedImage {
  /** Índice da página (1-based) de onde a imagem foi extraída. */
  pageNumber: number;
  /** Bytes crus da imagem, antes de qualquer decodificação de cor. */
  data: Uint8Array;
  /** Nome do colorspace declarado no PDF, quando disponível (ex: 'DeviceCMYK', 'ICCBased'). */
  declaredColorSpace?: string;
  width: number;
  height: number;
}

/**
 * Extrai as imagens embutidas de um PDF.
 *
 * TODO (Fase 4): implementar usando pdfjs-dist —
 *   1. `getDocument(arrayBuffer)` para carregar o documento.
 *   2. Para cada página, `page.getOperatorList()` + `page.objs` para
 *      localizar os XObjects de imagem sem rasterizar a página inteira.
 *   3. Também extrair `/OutputIntent`, se presente, pois ele indica o
 *      perfil ICC de destino pretendido pelo próprio PDF.
 */
export async function extractImagesFromPdf(
  _fileBuffer: ArrayBuffer,
): Promise<ExtractedImage[]> {
  throw new Error('extractImagesFromPdf: ainda não implementado (Fase 4 do roteiro)');
}

/**
 * Extrai o perfil ICC de destino declarado no /OutputIntent do PDF, se existir.
 * Útil para o laudo indicar automaticamente qual perfil o próprio arquivo
 * pretende seguir, em vez de depender só da escolha manual do usuário.
 */
export async function extractOutputIntentProfile(
  _fileBuffer: ArrayBuffer,
): Promise<Uint8Array | null> {
  throw new Error('extractOutputIntentProfile: ainda não implementado (Fase 4 do roteiro)');
}
