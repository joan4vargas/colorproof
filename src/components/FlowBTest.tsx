// Tela provisória do Fluxo B (Fase 7): referência contra simulação do mesmo
// layout. A interface final fica para a Fase 8. Esta tela tem o próprio Worker
// e o próprio campo de perfil.

import { useEffect, useRef, useState } from 'react';
import { AnalysisCancelledError, type AnalysisClient } from '../lib/analysis/analysisClient';
import { createBrowserAnalysisClient } from '../lib/analysis/browserAnalysis';
import type { CompareOutcome, CompareStage } from '../lib/compare/compareFiles';
import { CmykProfileRequiredError } from '../lib/pdf/analyzePdf';

const STAGE_LABEL: Record<CompareStage, string> = {
  reference: 'Lendo a referência…',
  simulation: 'Lendo a simulação…',
  comparing: 'Comparando as regiões…',
};
const VERDICT_LABEL = { aprovado: 'Aprovado', atencao: 'Atenção', reprovado: 'Reprovado' } as const;
const VERDICT_COLOR = { aprovado: '#1b7f3b', atencao: '#a66a00', reprovado: '#b3261e' } as const;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const mimeOf = (f: File) => (f.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : f.type || 'image/png');
const fmtLab = (l: { l: number; a: number; b: number }) => `${l.l.toFixed(1)} / ${l.a.toFixed(1)} / ${l.b.toFixed(1)}`;

export default function FlowBTest() {
  const client = useRef<AnalysisClient | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [reference, setReference] = useState<File | null>(null);
  const [simulation, setSimulation] = useState<File | null>(null);
  const [outcome, setOutcome] = useState<CompareOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<CompareStage | null>(null);
  const [busy, setBusy] = useState(false);

  const getClient = () => (client.current ??= createBrowserAnalysisClient());
  useEffect(() => () => client.current?.dispose(), []);

  async function run(ref: File | null, sim: File | null) {
    setOutcome(null);
    setError(null);
    if (!ref || !sim) return;
    setBusy(true);
    setStage(null);
    try {
      const [a, b] = await Promise.all([ref.arrayBuffer(), sim.arrayBuffer()]);
      setOutcome(
        await getClient().compare(
          { file: a, mime: mimeOf(ref) },
          { file: b, mime: mimeOf(sim) },
          { onProgress: setStage },
        ),
      );
    } catch (e) {
      if (e instanceof AnalysisCancelledError) setError('Comparação cancelada.');
      else if (e instanceof CmykProfileRequiredError) {
        setError(`${e.message} Escolha o perfil no primeiro campo e a comparação será refeita.`);
      } else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  }

  async function onProfile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setProfileName(await getClient().setProfile(await file.arrayBuffer()));
      await run(reference, simulation);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pick = (set: (f: File | null) => void, other: File | null, isRef: boolean) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    set(f);
    void (isRef ? run(f, other) : run(other, f));
  };

  return (
    <section>
      <h2>Fluxo B: referência contra simulação (provisório)</h2>
      <p>
        Escolha duas versões do <strong>mesmo layout</strong> (PDF ou imagem): a referência (por exemplo, a arte aprovada
        em RGB) e a simulação (por exemplo, a versão em CMYK). As duas são divididas em regiões, e a cor mais frequente
        de cada região é comparada em ΔE00. Tudo roda no seu navegador.
      </p>
      <p>
        <label>
          Perfil CMYK (.icc):{' '}
          <input
            type="file"
            accept=".icc,.icm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void onProfile(f);
            }}
          />
        </label>
        {profileName && <strong> {profileName}</strong>}
      </p>
      <p>
        <label>
          Referência:{' '}
          <input type="file" accept=".pdf,application/pdf,image/*" onChange={pick(setReference, simulation, true)} />
        </label>
        {reference && <strong> {reference.name}</strong>}
      </p>
      <p>
        <label>
          Simulação:{' '}
          <input type="file" accept=".pdf,application/pdf,image/*" onChange={pick(setSimulation, reference, false)} />
        </label>
        {simulation && <strong> {simulation.name}</strong>}
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
      {outcome && (
        <div>
          <p>
            Referência: {outcome.reference.path === 'cmyk' ? 'CMYK (MuPDF + perfil)' : 'sRGB'} · simulação:{' '}
            {outcome.simulation.path === 'cmyk' ? 'CMYK (MuPDF + perfil)' : 'sRGB'} · intent {outcome.intent} · grade{' '}
            {outcome.report.grid} × {outcome.report.grid} · {outcome.totalMs.toFixed(0)} ms
          </p>
          <p>
            Resultado geral:{' '}
            <strong style={{ color: VERDICT_COLOR[outcome.report.verdict] }}>{VERDICT_LABEL[outcome.report.verdict]}</strong>{' '}
            (pelo percentil 95 do ΔE00 das regiões; aprovado até {outcome.report.thresholds.approvedMax.toFixed(1)}, atenção
            até {outcome.report.thresholds.attentionMax.toFixed(1)}, reprovado acima)
          </p>
          {outcome.report.warnings.map((w, i) => (
            <p key={i} role="status">
              Aviso: {w}
            </p>
          ))}
          {outcome.report.pages.map((p) => (
            <div key={p.pageNumber}>
              <h3>Página {p.pageNumber}</h3>
              <p>
                {p.compared} regiões comparadas · ΔE00 médio {p.meanDeltaE.toFixed(2)} · p95 {p.p95DeltaE.toFixed(2)} ·
                máximo {p.maxDeltaE.toFixed(2)} (pior caso:{' '}
                <span style={{ color: VERDICT_COLOR[p.worstCaseVerdict] }}>{VERDICT_LABEL[p.worstCaseVerdict]}</span>)
              </p>
              <p>
                Regiões aprovadas {pct(p.shares.aprovado)} · atenção {pct(p.shares.atencao)} · reprovadas{' '}
                {pct(p.shares.reprovado)} ·{' '}
                <strong style={{ color: VERDICT_COLOR[p.verdict] }}>{VERDICT_LABEL[p.verdict]}</strong>
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Região (linha, coluna)</th>
                    <th>ΔE00</th>
                    <th>Lab referência</th>
                    <th>Lab simulação</th>
                    <th>Região uniforme</th>
                  </tr>
                </thead>
                <tbody>
                  {p.worst.map((w, i) => (
                    <tr key={i}>
                      <td>
                        {w.row + 1}, {w.col + 1}
                      </td>
                      <td>{w.deltaE.toFixed(2)}</td>
                      <td>{fmtLab(w.reference)}</td>
                      <td>{fmtLab(w.simulation)}</td>
                      <td>{pct(w.minShare)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <p>
            Simulação numérica por região, não laudo ISO 12647. Elementos menores que uma região podem não aparecer, e
            bordas entre cores geram regiões mistas.
          </p>
        </div>
      )}
    </section>
  );
}
