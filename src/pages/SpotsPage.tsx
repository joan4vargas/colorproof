// Cores spot (Pantone): digitar ou ler do PDF o valor de referência de cada cor
// e receber o CMYK que mais se aproxima dela na condição de impressão.

import { fmtLab, num2 } from '../components/format';
import { rgbCss } from '../components/samples';
import { Card, DeltaBar, Help, Icon, Inks, Pill } from '../components/ui';
import { labD50ToRgbClipped } from '../core/colorimetry';
import { DEFAULT_THRESHOLDS } from '../core/verdict';
import { downloadText, printHtml, reportFileName } from '../lib/browser/download';
import { spotToCsv, spotToHtml, type SpotExport } from '../lib/report/export';
import { isPdf } from '../components/format';
import { Status } from '../components/common';
import type { SpotMode, SpotRow, useSpots } from '../state/useSpots';
import type { Workspace } from '../state/useWorkspace';

type Spots = ReturnType<typeof useSpots>;

const MODES: Array<{ id: SpotMode; label: string }> = [
  { id: 'lab', label: 'Lab' },
  { id: 'hex', label: 'Hexadecimal' },
  { id: 'cmyk', label: 'CMYK' },
];

function Field(props: { label: string; value: string; onChange: (v: string) => void; width?: string; placeholder?: string }) {
  return (
    <label className="field" style={{ width: props.width }}>
      <span className="muted small">{props.label}</span>
      <input type="text" inputMode="decimal" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function RowEditor({ row, update, remove }: { row: SpotRow; update: Spots['update']; remove: (id: number) => void }) {
  // editar o valor à mão desfaz a origem "do PDF": o laudo passa a dizer "digitado"
  const edit = (patch: Partial<SpotRow>) => update(row.id, { ...patch, origin: 'digitado' });
  return (
    <div className="spot-row">
      <label className="field grow">
        <span className="muted small">Nome da cor</span>
        <input type="text" value={row.name} placeholder="Ex.: PANTONE 186 C" onChange={(e) => update(row.id, { name: e.target.value })} />
      </label>
      <div className="seg" role="group" aria-label={`Tipo de valor de ${row.name || 'cor'}`}>
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={row.mode === m.id} onClick={() => edit({ mode: m.id })}>
            {m.label}
          </button>
        ))}
      </div>
      {row.mode === 'lab' && (
        <div className="fields">
          <Field label="L*" value={row.l} width="5.5rem" onChange={(v) => edit({ l: v })} />
          <Field label="a*" value={row.a} width="5.5rem" onChange={(v) => edit({ a: v })} />
          <Field label="b*" value={row.b} width="5.5rem" onChange={(v) => edit({ b: v })} />
        </div>
      )}
      {row.mode === 'hex' && (
        <div className="fields">
          <Field label="Hexadecimal (sRGB)" value={row.hex} width="10rem" placeholder="#E4002B" onChange={(v) => edit({ hex: v })} />
        </div>
      )}
      {row.mode === 'cmyk' && (
        <div className="fields">
          <Field label="C" value={row.c} width="4.5rem" onChange={(v) => edit({ c: v })} />
          <Field label="M" value={row.m} width="4.5rem" onChange={(v) => edit({ m: v })} />
          <Field label="Y" value={row.y} width="4.5rem" onChange={(v) => edit({ y: v })} />
          <Field label="K" value={row.k} width="4.5rem" onChange={(v) => edit({ k: v })} />
        </div>
      )}
      <button type="button" className="btn" onClick={() => remove(row.id)} aria-label={`Remover ${row.name || 'cor'}`}>
        Remover
      </button>
      {row.warning && <p className="status warn spot-warn">{row.warning}</p>}
    </div>
  );
}

export default function SpotsPage({ ws, spots }: { ws: Workspace; spots: Spots }) {
  const { rows, intent, setIntent, result, busy, error, info, update, add, remove, readFromPdf, calculate } = spots;
  const canRead = ws.file !== null && isPdf(ws.file);

  const exportData: SpotExport | null = result
    ? {
        profileDescription: result.profileDescription,
        intent: result.intent,
        thresholds: DEFAULT_THRESHOLDS,
        rows: result.matches.map((match, i) => ({ match, origin: result.rows[i]?.origin ?? 'digitado' })),
      }
    : null;
  const meta = () => ({ generatedAt: new Date(), appName: 'ColorProof' });

  return (
    <div className="stack">
      {!ws.profileName && <Status kind="info">Escolha o perfil de impressão no alto da página.</Status>}

      <Card title="Suas cores">
        <Help title="De onde vem o valor da cor?">
          <p className="small">
            O app não traz a biblioteca Pantone. Use o Lab do PDF (botão “Ler do PDF”), do Pantone Connect ou de uma medição com espectrofotômetro. O hexadecimal é só aproximado.
          </p>
        </Help>
        <div className="spot-list">
          {rows.map((row) => (
            <RowEditor key={row.id} row={row} update={update} remove={remove} />
          ))}
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={add}>
            + Cor
          </button>
          <button type="button" className="btn" onClick={() => void readFromPdf()} disabled={!canRead || busy} title={canRead ? undefined : 'Escolha um PDF no alto da página'}>
            <Icon name="upload" size={18} /> Ler do PDF
          </button>
          <button type="button" className="btn primary" onClick={() => void calculate()} disabled={busy || !ws.profileName}>
            Calcular
          </button>
        </div>
        <Help title="Opções">
          <div className="seg" role="group" aria-label="Referência do valor">
            <button type="button" aria-pressed={intent === 'relative'} onClick={() => setIntent('relative')} title="O branco do papel vira o branco da referência. Padrão.">
              Relativo ao papel
            </button>
            <button type="button" aria-pressed={intent === 'absolute'} onClick={() => setIntent('absolute')} title="Use se o Lab de referência foi medido com o papel incluído.">
              Absoluto
            </button>
          </div>
        </Help>
        {info && <p className="muted small">{info}</p>}
        {error && <Status kind="error">Erro: {error}</Status>}
      </Card>

      {result && exportData && (
        <>
          <Card title="CMYK para imprimir">
            <div className="swatches">
              {result.matches.map((m, i) => (
                <article key={i} className="swatch-card">
                  <div className="swatch-big" role="img" aria-label={`${m.name}: referência e como imprime`}>
                    <span style={{ background: rgbCss(labD50ToRgbClipped(m.labTarget)) }}>
                      <small>Referência</small>
                    </span>
                    <span style={{ background: rgbCss(labD50ToRgbClipped(m.labPrinted)) }}>
                      <small>Impresso</small>
                    </span>
                  </div>
                  <div className="swatch-head">
                    <strong>{m.name}</strong>
                    <Pill verdict={m.verdict} />
                  </div>
                  <p className="cmyk-big">
                    C {m.cmyk.c} · M {m.cmyk.m} · Y {m.cmyk.y} · K {m.cmyk.k}
                  </p>
                  <Inks cmyk={m.cmyk} />
                  {!m.reproducible && <p className="muted small">Fora do alcance do CMYK: é a melhor aproximação.</p>}
                  <div className="spot-alt">
                    <div className="spot-alt-head">
                      <span className="swatch-mini" style={{ background: rgbCss(labD50ToRgbClipped(m.alternative.labPrinted)) }} aria-hidden="true" />
                      <p className="small label-line">Outra opção para testar</p>
                    </div>
                    <p className="cmyk-big alt">
                      C {m.alternative.cmyk.c} · M {m.alternative.cmyk.m} · Y {m.alternative.cmyk.y} · K {m.alternative.cmyk.k}
                    </p>
                  </div>
                  <Help title="Detalhes">
                    <p className="small">Lab de referência {fmtLab(m.labTarget)} · {result.rows[i]?.origin}</p>
                    <p className="small">Diferença (ΔE00): {num2(m.deltaE)} na primeira opção, {num2(m.alternative.deltaE)} na outra. Quanto menor, mais parecido. Tinta total: {m.totalInk}%.</p>
                    <DeltaBar value={m.deltaE} verdict={m.verdict} thresholds={DEFAULT_THRESHOLDS} />
                    <p className="muted small">Imprima as duas opções ao lado do Pantone e escolha a olho; pelo cálculo, a primeira é a melhor. Perfil {result.profileDescription}.</p>
                  </Help>
                </article>
              ))}
            </div>
          </Card>
          <Card title="Salvar">
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => printHtml(spotToHtml(exportData, meta()))}>
                <Icon name="print" size={18} /> Imprimir / PDF
              </button>
              <button type="button" className="btn" onClick={() => downloadText(reportFileName('cores-spot', 'html'), spotToHtml(exportData, meta()), 'text/html')}>
                <Icon name="download" size={18} /> HTML
              </button>
              <button type="button" className="btn" onClick={() => downloadText(reportFileName('cores-spot', 'csv'), spotToCsv(exportData), 'text/csv')}>
                <Icon name="table" size={18} /> Excel (CSV)
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
