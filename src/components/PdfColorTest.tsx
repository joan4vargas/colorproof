// Teste provisório da Fase 4 no navegador (será substituído pela UI da Fase 8).
//
// 1. (opcional até ser preciso) escolha um perfil CMYK .icc;
// 2. escolha um PDF ou imagem.
//
// PDF sem CMYK: lido em sRGB pelo pdf.js. PDF com CMYK: lido em CMYK pelo MuPDF
// e levado a Lab pelo perfil. Tudo roda no navegador; nada é enviado a servidor.

import { useRef, useState } from 'react';
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { createColorEngine, type IccProfileHandle } from '../lib/icc/colorEngine';
import { analyzePdfInBrowser, rasterizeImageInBrowser } from '../lib/pdf/browserPdf';
import { CmykProfileRequiredError, type PdfAnalysis } from '../lib/pdf/analyzePdf';
import { extractDominantColors, type ColorExtraction } from '../lib/sampling/dominantColors';
import type { Lab, RGB } from '../types/color';

interface Row {
  rgb: RGB;
  nome: string;
  pixelShare: number;
  lab: Lab;
  spread: number;
}

interface Result {
  arquivo: string;
  detalhe: string;
  ms: number;
  caminho: string;
  avisos: string[];
  linhas: Row[];
  totalPixels: number;
  paperPixels: number;
  distinctColors: number;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtCmyk = (c: { c: number; m: number; y: number; k: number }) =>
  `${c.c.toFixed(0)} / ${c.m.toFixed(0)} / ${c.y.toFixed(0)} / ${c.k.toFixed(0)}`;

function fromRgb(e: ColorExtraction): Pick<Result, 'linhas' | 'totalPixels' | 'paperPixels' | 'distinctColors'> {
  return {
    linhas: e.colors.map((c) => ({
      rgb: c.rgb,
      nome: `sRGB ${c.rgb.r}, ${c.rgb.g}, ${c.rgb.b}`,
      pixelShare: c.pixelShare,
      lab: c.lab,
      spread: c.spread,
    })),
    totalPixels: e.totalPixels,
    paperPixels: e.paperPixels,
    distinctColors: e.distinctColors,
  };
}

export default function PdfColorTest() {
  const profile = useRef<IccProfileHandle | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // PDF que parou por falta de perfil: é reanalisado quando o perfil for escolhido.
  const waitingForProfile = useRef<File | null>(null);

  async function onProfile(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      const engine = await createColorEngine({ wasmUrl });
      profile.current?.libera();
      profile.current = await engine.loadProfile(new Uint8Array(await file.arrayBuffer()));
      setProfileName(profile.current.description);
      if (waitingForProfile.current) {
        const pending = waitingForProfile.current;
        waitingForProfile.current = null;
        await onFile(pending);
      }
    } catch (e) {
      profile.current = null;
      setProfileName(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    waitingForProfile.current = null;
    if (!file) return;
    setBusy(true);
    try {
      const t0 = performance.now();
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      let partial: Pick<Result, 'linhas' | 'totalPixels' | 'paperPixels' | 'distinctColors'>;
      let detalhe: string;
      let caminho: string;
      let avisos: string[] = [];
      if (isPdf) {
        const a: PdfAnalysis = await analyzePdfInBrowser(await file.arrayBuffer(), {
          profile: profile.current ?? undefined,
          k: 8,
        });
        avisos = a.warnings;
        detalhe = a.analyzedPages < a.numPages ? `${a.analyzedPages} de ${a.numPages} páginas` : `${a.numPages} página(s)`;
        if (a.path === 'cmyk' && a.cmyk) {
          caminho = `CMYK lido do arquivo (MuPDF), Lab pelo perfil ${profile.current?.description ?? ""}`;
          partial = {
            linhas: a.cmyk.colors.map((c) => ({
              rgb: labD50ToRgbClipped(c.lab),
              nome: `CMYK ${fmtCmyk(c.cmyk)}`,
              pixelShare: c.pixelShare,
              lab: c.lab,
              spread: c.spread,
            })),
            totalPixels: a.cmyk.totalPixels,
            paperPixels: a.cmyk.paperPixels,
            distinctColors: a.cmyk.distinctColors,
          };
        } else {
          caminho = 'sRGB (pdf.js)';
          partial = fromRgb(a.rgb!);
        }
      } else {
        const img = await rasterizeImageInBrowser(file);
        detalhe = 'imagem';
        caminho = 'sRGB (navegador)';
        partial = fromRgb(extractDominantColors(img.data, { k: 8 }));
      }
      setResult({ arquivo: file.name, detalhe, ms: performance.now() - t0, caminho, avisos, ...partial });
    } catch (e) {
      if (e instanceof CmykProfileRequiredError) waitingForProfile.current = file;
      setError(
        e instanceof CmykProfileRequiredError
          ? `${e.message} Escolha o perfil no primeiro campo e o PDF será analisado.`
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Teste da extração de cores (provisório)</h2>
      <p>
        Tudo roda no seu navegador; nada é enviado a servidor. O papel branco é descartado.
        PDFs com CMYK precisam de um perfil de saída (primeiro campo); os demais não.
      </p>
      <p>
        <label>
          Perfil CMYK (.icc):{' '}
          <input type="file" accept=".icc,.icm" onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ''; // permite escolher o mesmo arquivo de novo
              void onProfile(f);
            }}
          />
        </label>
        {profileName && <strong> {profileName}</strong>}
      </p>
      <p>
        <label>
          PDF ou imagem:{' '}
          <input
            type="file"
            accept=".pdf,application/pdf,image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = ''; // permite escolher o mesmo arquivo de novo
              void onFile(f);
            }}
          />
        </label>
      </p>
      {busy && <p>Processando…</p>}
      {error && <p role="alert">Erro: {error}</p>}
      {result && (
        <div>
          <p>
            <strong>{result.arquivo}</strong> · {result.detalhe} · {result.ms.toFixed(0)} ms ·{' '}
            {result.totalPixels.toLocaleString('pt-BR')} px, {pct(result.paperPixels / result.totalPixels)} de papel ·{' '}
            {result.distinctColors.toLocaleString('pt-BR')} cores distintas
          </p>
          <p>Leitura: {result.caminho}</p>
          {result.avisos.map((w, i) => (
            <p key={i} role="status">
              Aviso: {w}
            </p>
          ))}
          <table>
            <thead>
              <tr>
                <th>Cor</th>
                <th>Valor lido</th>
                <th>Participação</th>
                <th>Lab D50</th>
                <th>Dispersão ΔE00</th>
              </tr>
            </thead>
            <tbody>
              {result.linhas.map((c, i) => (
                <tr key={i}>
                  <td>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 28,
                        height: 18,
                        border: '1px solid #888',
                        background: `rgb(${c.rgb.r}, ${c.rgb.g}, ${c.rgb.b})`,
                      }}
                    />
                  </td>
                  <td>{c.nome}</td>
                  <td>{pct(c.pixelShare)}</td>
                  <td>
                    {c.lab.l.toFixed(1)} / {c.lab.a.toFixed(1)} / {c.lab.b.toFixed(1)}
                  </td>
                  <td>{c.spread.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>A amostra de cor na tela é uma aproximação em sRGB; o que vale é o Lab.</p>
        </div>
      )}
    </section>
  );
}
