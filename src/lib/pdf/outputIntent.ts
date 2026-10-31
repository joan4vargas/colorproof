// Pendente (fase posterior): ler o perfil ICC declarado no /OutputIntents do
// PDF, para o laudo sugerir o perfil que o próprio arquivo pretende seguir.
//
// O pdf.js não expõe o /OutputIntents numa API pública (conferido na versão
// 4.x), então isto exige ler o catálogo do PDF por outro caminho. Não é
// necessário para a Fase 4 e continua como lançamento explícito de erro, para
// ninguém confundir "sem perfil" com "ainda não implementado".

export async function extractOutputIntentProfile(
  _fileBuffer: ArrayBuffer,
): Promise<Uint8Array | null> {
  throw new Error('extractOutputIntentProfile: ainda não implementado');
}
