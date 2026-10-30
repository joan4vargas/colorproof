// O pacote lcms-wasm não publica declarações de tipo. Este arquivo descreve
// apenas o subconjunto da API que o projeto usa (ver lib/icc/colorEngine.ts).
// Os nomes e a ordem dos parâmetros seguem lcms-wasm/lib/api.js (v1.0.5).

declare module 'lcms-wasm' {
  export interface LcmsModule {
    cmsOpenProfileFromMem(bytes: Uint8Array, size: number): number;
    cmsCloseProfile(profile: number): void;
    cmsCreate_sRGBProfile(): number;
    /** `null` usa o branco D50 padrão do lcms2. */
    cmsCreateLab4Profile(whitePoint?: ArrayLike<number> | null): number;
    cmsGetProfileInfoASCII(
      profile: number,
      info: number,
      languageCode: string,
      countryCode: string,
    ): string;
    cmsGetColorSpaceASCII(profile: number): string | null;
    cmsGetHeaderRenderingIntent(profile: number): number;
    cmsCreateTransform(
      input: number,
      inputFormat: number,
      output: number,
      outputFormat: number,
      intent: number,
      flags: number,
    ): number;
    /**
     * O wrapper só suporta amostras de 8 bits, 16 bits ou Float32. O projeto
     * usa somente 16 bits, por isso a assinatura é restrita a Uint16Array.
     */
    cmsDoTransform(transform: number, input: Uint16Array, size: number): Uint16Array;
    cmsDeleteTransform(transform: number): void;
  }

  export function instantiate(options?: {
    locateFile?: (name: string) => string;
  }): Promise<LcmsModule>;
}
