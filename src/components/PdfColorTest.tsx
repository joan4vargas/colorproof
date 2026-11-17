// Teste provisório das Fases 4 e 5 no navegador (será substituído pela UI da Fase 8).
//
// 1. (opcional até ser preciso) escolha um perfil CMYK .icc;
// 2. escolha um PDF ou imagem.
//
// A análise roda num Web Worker, então a tela não trava e dá para cancelar.
// PDF sem CMYK: lido em sRGB pelo pdf.js. PDF com CMYK: lido em CMYK pelo MuPDF
// e levado a Lab pelo perfil. Nada é enviado a servidor.

import { useEffect, useRef, useState } from 'react';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { AnalysisCancelledError, type AnalysisClient, type AnalysisOutcome } from '../lib/analysis/analysisClient';
import { createBrowserAnalysisClient } from '../lib/analysis/browserAnalysis';
import { CmykProfileRequiredError, type AnalysisStage, type PdfAnalysis } from '../lib/pdf/analyzePdf';
import type { ColorExtraction } from '../lib/sampling/dominantColors';
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
  caminho: string;
  analysis: PdfAnalysis;
  report: AnalysisOutcome['report'];
  linhas: Row[];
  totalPixels: number;
  paperPixels: number;
  distinctColors: number;
}

const STAGE_LABEL: Record<AnalysisStage, string> = {
  inspecting: 'Inspecionando espaços de cor…',
  rendering: 'Lendo as páginas…',
  clustering: 'Agrupando as cores…',
};

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

const VERDICT_LABEL = { aprovado: 'Aprovado', atencao: 'Atenção', reprovado: 'Reprovado' } as const;
const VERDICT_COLOR = { aprovado: '#1b7f3b', atencao: '#a66a00', reprovado: '#b3261e' } as const;

function Laudo({ report }: { report: NonNullable<AnalysisOutcome['report']> }) {
  const th = report.thresholds;
  return (
    <div>
      <h3>Simulação de conformidade (Fluxo A)</h3>
      <p>
        Perfil <strong>{report.profileDescription}</strong> · intent {report.intent} · resultado geral:{' '}
        <strong style={{ color: VERDICT_COLOR[report.verdict] }}>{VERDICT_LABEL[report.verdict]}</strong> (aprovado até ΔE00{' '}
        {th.approvedMax.toFixed(1)}, atenção até {th.attentionMax.toFixed(1)}, reprovado acima)
      </p>
      {report.warnings.map((w, i) => (
        <p key={i} role="status">
          Aviso: {w}
        </p>
      ))}
      <table>
        <thead>
          <tr>
            <th>Cor de origem</th>
            <th>CMYK reproduzido (%)</th>
            <th>ΔE00 do round-trip</th>
            <th>Veredito</th>
            {report.path === 'cmyk' && <th>ΔE00 na tela (informativo)</th>}
          </tr>
        </thead>
        <tbody>
          {report.findings.map((f, i) => (
            <tr key={i}>
              <td>{f.source.kind === 'rgb' ? `sRGB ${f.source.rgb.r}, ${f.source.rgb.g}, ${f.source.rgb.b}` : `CMYK ${fmtCmyk(f.source.cmyk)}`}</td>
              <td>{fmtCmyk(f.cmykReproduced)}</td>
              <td>{f.deltaE.toFixed(2)}</td>
              <td style={{ color: VERDICT_COLOR[f.verdict] }}>{VERDICT_LABEL[f.verdict]}</td>
              {report.path === 'cmyk' && <td>{f.screenDeltaE?.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {report.path === 'cmyk' && (
        <p>
          O CMYK reproduzido vem da tabela B2A do perfil e pode diferir da separação original (por exemplo, K 100%
          vira um preto composto): o que se compara é a cor (Lab), não os percentuais de tinta.
        </p>
      )}
      <p>
        Isto é uma simulação numérica pelo perfil ICC, não um laudo de conformidade ISO 12647: a norma avalia material
        impresso medido com espectrofotômetro. Os limites de ΔE00 são decisão de projeto.
      </p>
    </div>
  );
}

export default function PdfColorTest() {
  const client = useRef<AnalysisClient | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<AnalysisStage | null>(null);
  const [busy, setBusy] = useState(false);
  // PDF que parou por falta de perfil: é reanalisado quando o perfil for escolhido.
  const waitingForProfile = useRef<File | null>(null);
  // Último arquivo analisado: trocar o perfil reanalisa, para comparar condições de impressão.
  const lastFile = useRef<File | null>(null);

  const getClient = () => (client.current ??= createBrowserAnalysisClient());
  useEffect(() => () => client.current?.dispose(), []);

  async function onProfile(file: File | undefined) {
    setError(null);
    if (!file) return;
    try {
      setProfileName(await getClient().setProfile(await file.arrayBuffer()));
      const pending = waitingForProfile.current ?? lastFile.current;
      waitingForProfile.current = null;
      if (pending) await onFile(pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    waitingForProfile.current = null;
    if (!file) return;
    lastFile.current = file;
    setBusy(true);
    setStage(null);
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const data = await file.arrayBuffer();
      const options = { k: 8, onProgress: setStage };
      const analysis = isPdf
        ? await getClient().analyzePdf(data, options)
        : await getClient().analyzeImage(data, file.type || 'image/png', options);

      const detalhe = !isPdf
        ? 'imagem'
        : analysis.analyzedPages < analysis.numPages
          ? `${analysis.analyzedPages} de ${analysis.numPages} páginas`
          : `${analysis.numPages} página(s)`;
      if (analysis.path === 'cmyk' && analysis.cmyk) {
        setResult({
          arquivo: file.name,
          detalhe,
          caminho: `CMYK lido do arquivo (MuPDF), Lab pelo perfil ${getClient().profile ?? ''}`,
          analysis,
          report: analysis.report,
          linhas: analysis.cmyk.colors.map((c) => ({
            rgb: labD50ToRgbClipped(c.lab),
            nome: `CMYK ${fmtCmyk(c.cmyk)}`,
            pixelShare: c.pixelShare,
            lab: c.lab,
            spread: c.spread,
          })),
          totalPixels: analysis.cmyk.totalPixels,
          paperPixels: analysis.cmyk.paperPixels,
          distinctColors: analysis.cmyk.distinctColors,
        });
      } else {
        setResult({
          arquivo: file.name,
          detalhe,
          caminho: isPdf ? 'sRGB (pdf.js)' : 'sRGB (navegador)',
          analysis,
          report: analysis.report,
          ...fromRgb(analysis.rgb!),
        });
      }
    } catch (e) {
      if (e instanceof AnalysisCancelledError) {
        setError('Análise cancelada.');
      } else {
        if (e instanceof CmykProfileRequiredError) waitingForProfile.current = file;
        setError(
          e instanceof CmykProfileRequiredError
            ? `${e.message} Escolha o perfil no primeiro campo e o PDF será analisado.`
            : e instanceof Error
              ? e.message
              : String(e),
        );
      }
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  const t = result?.analysis.timings;
  return (
    <section>
      <h2>Teste da extração de cores (provisório)</h2>
      <p>
        Tudo roda no seu navegador, num Web Worker (a tela não trava); nada é enviado a servidor. O papel
        branco é descartado. PDFs com CMYK precisam de um perfil de saída (primeiro campo); os demais não.
      </p>
      <p>
        <label>
          Perfil CMYK (.icc):{' '}
          <input
            type="file"
            accept=".icc,.icm"
            onChange={(e) => {
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
      {busy && (
        <p role="status">
          {stage ? STAGE_LABEL[stage] : 'Enviando ao Worker…'}{' '}
          <button type="button" onClick={() => client.current?.cancel()}>
            Cancelar
          </button>
        </p>
      )}
      {error && <p role="alert">Erro: {error}</p>}
      {result && t && (
        <div>
          <p>
            <strong>{result.arquivo}</strong> · {result.detalhe} · {result.totalPixels.toLocaleString('pt-BR')} px,{' '}
            {pct(result.paperPixels / result.totalPixels)} de papel ·{' '}
            {result.distinctColors.toLocaleString('pt-BR')} cores distintas
          </p>
          <p>
            Leitura: {result.caminho} · tempo total {t.totalMs.toFixed(0)} ms (inspeção {t.inspectMs.toFixed(0)},
            leitura das páginas {t.renderMs.toFixed(0)}, agrupamento {t.clusterMs.toFixed(0)})
          </p>
          {result.analysis.warnings.map((w, i) => (
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
          {result.report ? <Laudo report={result.report} /> : <p role="status">Escolha um perfil CMYK para ver o laudo da simulação.</p>}
        </div>
      )}
    </section>
  );
}
