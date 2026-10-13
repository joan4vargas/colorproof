// Fase 3 do roteiro: integração do motor de cor (lcms2-wasm).
//
// Este módulo isola toda a dependência de lcms2 do resto do código: o
// núcleo matemático (src/core) não sabe nada sobre perfis ICC, e o resto
// da aplicação só conversa com as funções abaixo. Isso mantém o core
// testável de forma pura (Fase 2) e concentra num único lugar a decisão
// de qual biblioteca WASM está sendo usada.
//
// Dependência a resolver quando esta fase começar: um build de lcms2
// compilado para WASM (ex: via Emscripten) exposto como pacote npm ou
// como asset próprio em /public.

import type { Lab, RGB } from '../../types/color';

export type IccProfileId = 'ISOcoated_v2' | 'PSOcoated_v3' | 'custom';

export interface ColorEngine {
  /** Carrega um perfil ICC a partir dos bytes do arquivo (.icc/.icm). */
  loadProfile(profileBytes: Uint8Array): Promise<IccProfileHandle>;
}

export interface IccProfileHandle {
  id: IccProfileId | string;

  /**
   * Transforma uma cor Lab para dentro do gamute deste perfil e de volta
   * para Lab — a operação de "round-trip" que sustenta o Fluxo A (ver
   * núcleo matemático da proposta). Uma via A2B seguida de B2A na mesma LUT.
   */
  roundTripLab(lab: Lab): Promise<Lab>;

  /** Transforma RGB de origem para os valores CMYK equivalentes neste perfil (soft proofing). */
  rgbToDeviceCmyk(rgb: RGB): Promise<{ c: number; m: number; y: number; k: number }>;

  libera(): void;
}

/**
 * TODO (Fase 3): inicializar o módulo WASM do lcms2 (instância única,
 * reaproveitada pelos Web Workers) e implementar loadProfile usando as
 * funções cmsOpenProfileFromMem / cmsCreateTransform da API do Little CMS.
 */
export async function createColorEngine(): Promise<ColorEngine> {
  throw new Error('createColorEngine: ainda não implementado (Fase 3 do roteiro)');
}

/** Perfis padrão embutidos no sistema, conforme a proposta do projeto. */
export const BUNDLED_PROFILES: Record<Exclude<IccProfileId, 'custom'>, string> = {
  ISOcoated_v2: '/profiles/ISOcoated_v2_eci.icc',
  PSOcoated_v3: '/profiles/PSOcoated_v3.icc',
};
