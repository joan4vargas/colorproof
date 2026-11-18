// Fase 3 do roteiro: integração do motor de cor (lcms2 compilado para WASM,
// pacote npm `lcms-wasm`, licença MIT; o Little CMS embutido também é MIT).
//
// Este módulo isola toda a dependência de lcms2 do resto do código: o núcleo
// matemático (src/core) não sabe nada sobre perfis ICC, e o resto da
// aplicação só conversa com as funções abaixo.
//
// Decisões que valem entrar na monografia:
//  - Os cálculos usam amostras de 16 bits (CMYK_16 e Lab_16 do lcms2). A
//    quantização do Lab de 16 bits é de cerca de 0,0015 em L* e 0,0039 em
//    a* e b*, desprezível frente às tolerâncias de ΔE.
//  - O rendering intent é parâmetro explícito. Os dados de caracterização
//    (ISO 12642) são Lab ABSOLUTO: só o intent 'absolute' os reproduz.
//    O padrão é 'relative', coerente com Lab derivado de sRGB, em que o
//    branco é L* = 100 (relativo ao papel). Decisão D1 (docs, seção 8c):
//    relativo no Fluxo A e absoluto no Fluxo B.
//  - Compensação de ponto preto (BPC) desligada por padrão (opção
//    `blackPointCompensation` em `loadProfile`). Medido (docs 8c): ligada, o
//    round-trip do preto fica perto de zero porque a ida e a volta se
//    compensam, o que esconde que o preto impresso é bem mais claro que o da tela.
//  - Só perfis CMYK de saída são aceitos por enquanto. Perfil de monitor
//    (soft proofing visual) entra em outra fase.

import { instantiate, type LcmsModule } from 'lcms-wasm';
import type { Cmyk, Lab, RGB } from '../../types/color';
import { readIccHeader } from './iccTags';

export type IccProfileId = 'ISOcoated_v2' | 'PSOcoated_v3' | 'custom';
export type RenderingIntent = 'perceptual' | 'relative' | 'saturation' | 'absolute';

export interface ColorEngineOptions {
  /**
   * URL do arquivo lcms.wasm. No navegador com Vite, importe-o com
   * `import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url'` e passe aqui.
   * Em Node (testes), omita: o pacote localiza o arquivo sozinho.
   */
  wasmUrl?: string;
}

export interface LoadProfileOptions {
  /**
   * Compensação de ponto preto (flag do lcms2). Só tem efeito nos intents
   * relativo, perceptual e saturação; o lcms2 a ignora no absoluto.
   * Padrão: desligada (decisão D1, docs seção 8c).
   */
  blackPointCompensation?: boolean;
}

export interface ColorEngine {
  /** Carrega um perfil CMYK de saída a partir dos bytes do arquivo (.icc/.icm). */
  loadProfile(
    profileBytes: Uint8Array,
    id?: IccProfileId | string,
    options?: LoadProfileOptions,
  ): Promise<IccProfileHandle>;

  /**
   * sRGB (perfil sRGB embutido no lcms2) para L*a*b* D50, com intent relativo.
   * Existe para conferir o núcleo matemático (src/core) contra o lcms2.
   */
  srgbToLab(rgb: RGB): Lab;

  /** Libera os perfis internos do motor. Libere os handles antes. */
  dispose(): void;
}

// O WASM é síncrono: só o carregamento é assíncrono. Em lote e dentro de Web
// Workers (Fase 5), a ideia é passar buffers inteiros, não cor a cor.
export interface IccProfileHandle {
  id: IccProfileId | string;
  /** Descrição embutida no perfil (ex.: "PSO Coated v3"). */
  description: string;

  /** CMYK (%) -> Lab pela tabela A2B do perfil. */
  cmykToLab(cmyk: Cmyk, intent?: RenderingIntent): Lab;

  /**
   * Converte muitas cores de uma vez. `samples` traz 4 bytes por cor (C, M, Y, K
   * de 0 a 255, onde 255 = 100% de tinta, como nos pixmaps CMYK de 8 bits).
   * Equivale a chamar `cmykToLab` em cada uma, mas sem o custo por chamada.
   */
  cmyk8ToLab(samples: ArrayLike<number>, intent?: RenderingIntent): Lab[];

  /** Lab -> CMYK (%) pela tabela B2A do perfil. */
  labToCmyk(lab: Lab, intent?: RenderingIntent): Cmyk;

  /**
   * Round-trip do Fluxo A: Lab -> CMYK (B2A) -> Lab (A2B). A comparação
   * entre o Lab de entrada e o devolvido é o desvio de gamut.
   * O resultado tem um "piso de erro" próprio das tabelas do perfil
   * (ver docs/DOCUMENTACAO.md), mesmo para cores dentro do gamut.
   */
  roundTripLab(lab: Lab, intent?: RenderingIntent): Lab;

  /** sRGB -> CMYK (%) deste perfil (soft proofing). Sanidade testada; validação plena fica para a Fase 7. */
  rgbToDeviceCmyk(rgb: RGB, intent?: RenderingIntent): Cmyk;

  /**
   * Simulação de impressão de uma imagem inteira: sRGB (RGBA, 8 bits) -> CMYK
   * pelo perfil (B2A) -> sRGB de tela (A2B). Devolve RGBA do mesmo tamanho; o
   * alfa é mantido. Cores fora do gamut do perfil voltam diferentes das de
   * entrada, e é isso que a simulação mostra.
   */
  simulateRgba(rgba: ArrayLike<number>, intent?: RenderingIntent): Uint8ClampedArray;

  /** CMYK de 8 bits (255 = 100%) -> sRGB RGBA, pelo perfil: como a tela mostra essa tinta. */
  cmyk8ToRgba(samples: ArrayLike<number>, intent?: RenderingIntent): Uint8ClampedArray;

  libera(): void;
}

// --- Constantes do lcms2 --------------------------------------------------
// Macros TYPE_* de lcms2.h (COLORSPACE_SH | CHANNELS_SH | BYTES_SH).
// Valores conferidos contra lcms-wasm/lib/constants.js.
const TYPE_RGB_16 = 262170;
const TYPE_CMYK_16 = 393250;
const TYPE_Lab_16 = 655386;
const INFO_DESCRIPTION = 0;
const NO_FLAGS = 0;
const FLAGS_BLACKPOINTCOMPENSATION = 0x2000; // cmsFLAGS_BLACKPOINTCOMPENSATION em lcms2.h

const INTENT_CODE: Record<RenderingIntent, number> = {
  perceptual: 0,
  relative: 1,
  saturation: 2,
  absolute: 3,
};

// --- Codificação de amostras de 16 bits -------------------------------------

function clamp16(value: number): number {
  return Math.min(65535, Math.max(0, Math.round(value)));
}

function assertFinite(label: string, ...values: number[]): void {
  if (values.some((v) => !Number.isFinite(v))) {
    throw new Error(`${label}: valores não numéricos (${values.join(', ')}).`);
  }
}

/** Lab -> amostras Lab_16 do lcms2 (L* 0-100 em 0-65535; a* e b* com deslocamento de 128). */
export function encodeLab16(lab: Lab): [number, number, number] {
  assertFinite('encodeLab16', lab.l, lab.a, lab.b);
  return [clamp16(lab.l * 655.35), clamp16((lab.a + 128) * 257), clamp16((lab.b + 128) * 257)];
}

export function decodeLab16(samples: ArrayLike<number>, offset = 0): Lab {
  return {
    l: samples[offset] / 655.35,
    a: samples[offset + 1] / 257 - 128,
    b: samples[offset + 2] / 257 - 128,
  };
}

export function encodeCmyk16(cmyk: Cmyk): [number, number, number, number] {
  assertFinite('encodeCmyk16', cmyk.c, cmyk.m, cmyk.y, cmyk.k);
  return [cmyk.c, cmyk.m, cmyk.y, cmyk.k].map((p) => clamp16((p / 100) * 65535)) as [
    number,
    number,
    number,
    number,
  ];
}

export function decodeCmyk16(samples: ArrayLike<number>, offset = 0): Cmyk {
  const pct = (v: number) => (v / 65535) * 100;
  return {
    c: pct(samples[offset]),
    m: pct(samples[offset + 1]),
    y: pct(samples[offset + 2]),
    k: pct(samples[offset + 3]),
  };
}

function encodeRgb16(rgb: RGB): [number, number, number] {
  assertFinite('encodeRgb16', rgb.r, rgb.g, rgb.b);
  return [clamp16(rgb.r * 257), clamp16(rgb.g * 257), clamp16(rgb.b * 257)];
}

// --- Motor ------------------------------------------------------------------

export async function createColorEngine(options: ColorEngineOptions = {}): Promise<ColorEngine> {
  const { wasmUrl } = options;
  const lcms: LcmsModule = await instantiate(
    wasmUrl ? { locateFile: (name) => (name.endsWith('.wasm') ? wasmUrl : name) } : undefined,
  );

  let srgbProfile = 0;
  let labProfile = 0;
  let srgbToLabTransform = 0;

  function transformOrThrow(handle: number, what: string): number {
    if (!handle) throw new Error(`lcms2 não conseguiu criar a transformação ${what}.`);
    return handle;
  }

  return {
    async loadProfile(profileBytes, id = 'custom', options = {}) {
      const flags = options.blackPointCompensation ? FLAGS_BLACKPOINTCOMPENSATION : NO_FLAGS;
      const header = readIccHeader(profileBytes); // lança erro claro se não for ICC
      if (header.colorSpace !== 'CMYK') {
        throw new Error(
          `Só perfis CMYK de saída são suportados nesta fase (o perfil é ${header.colorSpace}).`,
        );
      }
      const profile = lcms.cmsOpenProfileFromMem(profileBytes, profileBytes.byteLength);
      if (!profile) throw new Error('lcms2 não conseguiu abrir o perfil ICC.');
      const lab = lcms.cmsCreateLab4Profile(null);
      let srgb = 0;
      let alive = true;
      const transforms = new Map<string, number>();

      const assertAlive = () => {
        if (!alive) throw new Error('Este perfil já foi liberado (libera()).');
      };

      const transform = (kind: 'a2b' | 'b2a' | 'rgb' | 'a2rgb', intent: RenderingIntent): number => {
        assertAlive();
        const key = `${kind}:${intent}`;
        let t = transforms.get(key);
        if (t === undefined) {
          const code = INTENT_CODE[intent];
          if (kind === 'a2b') {
            t = lcms.cmsCreateTransform(profile, TYPE_CMYK_16, lab, TYPE_Lab_16, code, flags);
          } else if (kind === 'b2a') {
            t = lcms.cmsCreateTransform(lab, TYPE_Lab_16, profile, TYPE_CMYK_16, code, flags);
          } else if (kind === 'rgb') {
            srgb ||= lcms.cmsCreate_sRGBProfile();
            t = lcms.cmsCreateTransform(srgb, TYPE_RGB_16, profile, TYPE_CMYK_16, code, flags);
          } else {
            srgb ||= lcms.cmsCreate_sRGBProfile();
            t = lcms.cmsCreateTransform(profile, TYPE_CMYK_16, srgb, TYPE_RGB_16, code, flags);
          }
          transformOrThrow(t, `${kind} (${intent})`);
          transforms.set(key, t);
        }
        return t;
      };

      const labToCmyk16 = (l: Lab, intent: RenderingIntent) =>
        lcms.cmsDoTransform(transform('b2a', intent), Uint16Array.from(encodeLab16(l)), 1);
      const cmykToLab16 = (samples: Uint16Array, intent: RenderingIntent) =>
        lcms.cmsDoTransform(transform('a2b', intent), samples, 1);

      const cmykToLab16Many = (samples: Uint16Array, n: number, intent: RenderingIntent) =>
        lcms.cmsDoTransform(transform('a2b', intent), samples, n);

      return {
        id,
        description: lcms.cmsGetProfileInfoASCII(profile, INFO_DESCRIPTION, 'en', 'US'),

        cmykToLab(cmyk, intent = 'relative') {
          const out = cmykToLab16(Uint16Array.from(encodeCmyk16(cmyk)), intent);
          return decodeLab16(out);
        },

        cmyk8ToLab(samples, intent = 'relative') {
          if (samples.length % 4 !== 0) {
            throw new Error('cmyk8ToLab: o número de amostras precisa ser múltiplo de 4.');
          }
          const total = samples.length / 4;
          const labs: Lab[] = new Array(total);
          const CHUNK = 32768; // cores por chamada ao WASM
          for (let start = 0; start < total; start += CHUNK) {
            const n = Math.min(CHUNK, total - start);
            const input = new Uint16Array(n * 4);
            for (let i = 0; i < input.length; i++) input[i] = samples[start * 4 + i] * 257;
            const out = cmykToLab16Many(input, n, intent);
            for (let i = 0; i < n; i++) {
              labs[start + i] = decodeLab16(out, i * 3);
            }
          }
          return labs;
        },

        labToCmyk(l, intent = 'relative') {
          return decodeCmyk16(labToCmyk16(l, intent));
        },

        roundTripLab(l, intent = 'relative') {
          return decodeLab16(cmykToLab16(labToCmyk16(l, intent), intent));
        },

        rgbToDeviceCmyk(rgb, intent = 'relative') {
          const out = lcms.cmsDoTransform(
            transform('rgb', intent),
            Uint16Array.from(encodeRgb16(rgb)),
            1,
          );
          return decodeCmyk16(out);
        },

        simulateRgba(rgba, intent = 'relative') {
          if (rgba.length % 4 !== 0) throw new Error('simulateRgba: o número de amostras precisa ser múltiplo de 4.');
          const total = rgba.length / 4;
          const out = new Uint8ClampedArray(rgba.length);
          const toCmyk = transform('rgb', intent);
          const toRgb = transform('a2rgb', intent);
          const CHUNK = 32768;
          for (let start = 0; start < total; start += CHUNK) {
            const n = Math.min(CHUNK, total - start);
            const input = new Uint16Array(n * 3);
            for (let i = 0; i < n; i++) {
              const o = (start + i) * 4;
              input[i * 3] = rgba[o] * 257;
              input[i * 3 + 1] = rgba[o + 1] * 257;
              input[i * 3 + 2] = rgba[o + 2] * 257;
            }
            const cmyk = lcms.cmsDoTransform(toCmyk, input, n);
            const rgb = lcms.cmsDoTransform(toRgb, cmyk, n);
            for (let i = 0; i < n; i++) {
              const o = (start + i) * 4;
              out[o] = Math.round(rgb[i * 3] / 257);
              out[o + 1] = Math.round(rgb[i * 3 + 1] / 257);
              out[o + 2] = Math.round(rgb[i * 3 + 2] / 257);
              out[o + 3] = rgba[o + 3];
            }
          }
          return out;
        },

        cmyk8ToRgba(samples, intent = 'relative') {
          if (samples.length % 4 !== 0) throw new Error('cmyk8ToRgba: o número de amostras precisa ser múltiplo de 4.');
          const total = samples.length / 4;
          const out = new Uint8ClampedArray(total * 4);
          const toRgb = transform('a2rgb', intent);
          const CHUNK = 32768;
          for (let start = 0; start < total; start += CHUNK) {
            const n = Math.min(CHUNK, total - start);
            const input = new Uint16Array(n * 4);
            for (let i = 0; i < input.length; i++) input[i] = samples[start * 4 + i] * 257;
            const rgb = lcms.cmsDoTransform(toRgb, input, n);
            for (let i = 0; i < n; i++) {
              const o = (start + i) * 4;
              out[o] = Math.round(rgb[i * 3] / 257);
              out[o + 1] = Math.round(rgb[i * 3 + 1] / 257);
              out[o + 2] = Math.round(rgb[i * 3 + 2] / 257);
              out[o + 3] = 255;
            }
          }
          return out;
        },

        libera() {
          if (!alive) return;
          alive = false;
          for (const t of transforms.values()) lcms.cmsDeleteTransform(t);
          transforms.clear();
          if (srgb) lcms.cmsCloseProfile(srgb);
          lcms.cmsCloseProfile(lab);
          lcms.cmsCloseProfile(profile);
        },
      };
    },

    srgbToLab(rgb) {
      if (!srgbToLabTransform) {
        srgbProfile = lcms.cmsCreate_sRGBProfile();
        labProfile = lcms.cmsCreateLab4Profile(null);
        srgbToLabTransform = transformOrThrow(
          lcms.cmsCreateTransform(
            srgbProfile,
            TYPE_RGB_16,
            labProfile,
            TYPE_Lab_16,
            INTENT_CODE.relative,
            NO_FLAGS,
          ),
          'sRGB -> Lab',
        );
      }
      const out = lcms.cmsDoTransform(srgbToLabTransform, Uint16Array.from(encodeRgb16(rgb)), 1);
      return decodeLab16(out);
    },

    dispose() {
      if (srgbToLabTransform) lcms.cmsDeleteTransform(srgbToLabTransform);
      if (srgbProfile) lcms.cmsCloseProfile(srgbProfile);
      if (labProfile) lcms.cmsCloseProfile(labProfile);
      srgbToLabTransform = srgbProfile = labProfile = 0;
    },
  };
}

/**
 * Nomes dos perfis padrão da proposta. Os arquivos .icc NÃO acompanham o
 * repositório: o aviso de direitos da ECI não permite redistribuí-los sem
 * permissão escrita. Cada pessoa baixa os perfis em eci.org e os coloca em
 * public/profiles/ (pasta ignorada pelo Git) ou os carrega pela interface.
 */
export const BUNDLED_PROFILES: Record<Exclude<IccProfileId, 'custom'>, string> = {
  ISOcoated_v2: '/profiles/ISOcoated_v2_eci.icc',
  PSOcoated_v3: '/profiles/PSOcoated_v3.icc',
};
