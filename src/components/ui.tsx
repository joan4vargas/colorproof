// Peças visuais do painel: ícones, cartões, indicadores, gráficos em SVG e a
// área de soltar arquivos. Sem bibliotecas: tudo em SVG e CSS.

import { useRef, useState, type ReactNode } from 'react';
import type { Verdict, VerdictThresholds } from '../core/verdict';

// --- Ícones (traço de 1,75 px, herdam a cor do texto) ----------------------

const PATHS: Record<string, ReactNode> = {
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 13l2 2 4-4" />
    </>
  ),
  compare: (
    <>
      <rect x="3" y="4" width="8" height="16" rx="1.5" />
      <rect x="13" y="4" width="8" height="16" rx="1.5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1.2-1-1.5-1-2.7 0-1 .8-1.5 1.8-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z" />
      <path d="M7.5 11v.01M10 7.5v.01M14.5 7.5v.01" />
    </>
  ),
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  upload: <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v4h16v-4" />,
  print: (
    <>
      <path d="M7 9V3h10v6M7 17H4v-7h16v7h-3" />
      <rect x="7" y="14" width="10" height="7" />
    </>
  ),
  download: <path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 20h16" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 10h18M9 4v16" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  shield: <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z" />,
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

// --- Cartões e indicadores ---------------------------------------------------

export function Card(props: { title?: string; subtitle?: string; children: ReactNode; className?: string; aside?: ReactNode }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {(props.title || props.aside) && (
        <header className="card-head">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.subtitle && <p className="muted">{props.subtitle}</p>}
          </div>
          {props.aside}
        </header>
      )}
      {props.children}
    </section>
  );
}

export type Tone = 'mint' | 'amber' | 'coral' | 'blue' | 'pink';

export function Kpi(props: { icon: keyof typeof PATHS; tone: Tone; value: ReactNode; label: string; note?: string }) {
  return (
    <div className="kpi">
      <span className={`kpi-icon tone-${props.tone}`}>
        <Icon name={props.icon} size={22} />
      </span>
      <strong className="kpi-value">{props.value}</strong>
      <span className="kpi-label">{props.label}</span>
      {props.note && <span className={`kpi-note tone-${props.tone}`}>{props.note}</span>}
    </div>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = { aprovado: 'Aprovado', atencao: 'Atenção', reprovado: 'Reprovado' };

export function Pill({ verdict, big }: { verdict: Verdict; big?: boolean }) {
  return <span className={`pill ${verdict}${big ? ' big' : ''}`}>{VERDICT_LABEL[verdict]}</span>;
}

/** Barra horizontal do ΔE00 com marcas nos limites (como a barra de popularidade de um ranking). */
export function DeltaBar({ value, verdict, thresholds, scale = 6 }: { value: number; verdict: Verdict; thresholds: VerdictThresholds; scale?: number }) {
  const at = (v: number) => `${Math.min(100, (v / scale) * 100)}%`;
  return (
    <div className="deltabar" title={`ΔE00 ${value.toFixed(2)}`}>
      <div className="track">
        <div className={`fill ${verdict}`} style={{ width: at(value) }} />
        <i className="tick" style={{ left: at(thresholds.approvedMax) }} />
        <i className="tick" style={{ left: at(thresholds.attentionMax) }} />
      </div>
      <span className="num">{value.toFixed(2).replace('.', ',')}</span>
    </div>
  );
}

export function ShareBar({ value }: { value: number }) {
  return (
    <div className="deltabar">
      <div className="track">
        <div className="fill share" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
      <span className="num">{(value * 100).toFixed(1)}%</span>
    </div>
  );
}

// --- Gráficos ------------------------------------------------------------------

export interface BarDatum {
  label: string;
  value: number;
  verdict: Verdict;
  swatch?: string;
}

/** Barras verticais do ΔE00 por cor, com as linhas dos limites. */
export function BarChart({ data, thresholds }: { data: BarDatum[]; thresholds: VerdictThresholds }) {
  const W = 360;
  const H = 190;
  const pad = { l: 30, r: 8, t: 12, b: 34 };
  const max = Math.max(thresholds.attentionMax * 1.4, ...data.map((d) => d.value)) * 1.08;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const slot = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.min(34, slot * 0.6);
  const ticks = [0, thresholds.approvedMax, thresholds.attentionMax];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="ΔE00 de cada cor, com os limites de aprovação e atenção">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'limit'} />
          <text x={pad.l - 6} y={y(t) + 4} className="axis-text" textAnchor="end">
            {t % 1 === 0 ? t : t.toFixed(1)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const x = pad.l + slot * i + (slot - bw) / 2;
        return (
          <g key={i}>
            <rect x={x} y={y(d.value)} width={bw} height={Math.max(2, y(0) - y(d.value))} rx="4" className={`bar ${d.verdict}`}>
              <title>{`${d.label}: ΔE00 ${d.value.toFixed(2)}`}</title>
            </rect>
            {d.swatch && <rect x={x + bw / 2 - 9} y={H - pad.b + 8} width="18" height="10" rx="2" fill={d.swatch} stroke="#8b92a3" strokeWidth="0.6" />}
          </g>
        );
      })}
    </svg>
  );
}

export interface DonutSlice {
  label: string;
  value: number;
  verdict: Verdict;
}

/** Rosca com a participação de cada veredito; o centro mostra a fatia aprovada. */
export function Donut({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel: string }) {
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;
  const R = 52;
  const C = 2 * Math.PI * R;
  const approved = (slices.find((s) => s.verdict === 'aprovado')?.value ?? 0) / total;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label={`${(approved * 100).toFixed(0)}% ${centerLabel}`}>
        <circle cx="70" cy="70" r={R} className="donut-track" />
        {slices.map((s, i) => {
          const len = (s.value / total) * C;
          const offset = slices.slice(0, i).reduce((sum, d) => sum + (d.value / total) * C, 0);
          return (
            <circle
              key={s.verdict}
              cx="70"
              cy="70"
              r={R}
              className={`donut-arc ${s.verdict}`}
              strokeDasharray={`${Math.max(0, len - (len > 2 ? 2 : 0))} ${C}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
            />
          );
        })}
        <text x="70" y="68" textAnchor="middle" className="donut-num">
          {(approved * 100).toFixed(0)}%
        </text>
        <text x="70" y="86" textAnchor="middle" className="donut-cap">
          {centerLabel}
        </text>
      </svg>
      <ul className="legend">
        {slices.map((s) => (
          <li key={s.verdict}>
            <i className={`dot ${s.verdict}`} />
            {s.label} <strong>{((s.value / total) * 100).toFixed(1)}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mapa de calor do ΔE00 por região da página. */
export function Heatmap({ grid, size, aspect, thresholds }: { grid: Array<number | null>; size: number; aspect: number; thresholds: VerdictThresholds }) {
  const color = (d: number | null): string => {
    if (d === null) return 'transparent';
    if (d <= thresholds.approvedMax) return `rgba(168, 230, 217, ${0.25 + 0.75 * (d / thresholds.approvedMax)})`;
    if (d <= thresholds.attentionMax) return 'rgb(241, 178, 74)';
    return 'rgb(255, 138, 128)';
  };
  return (
    <div className="heatmap" style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, aspectRatio: String(aspect) }} role="img" aria-label="Mapa de calor do ΔE00 por região da página">
      {grid.map((d, i) => (
        <i key={i} style={{ background: color(d) }} title={d === null ? 'papel nas duas versões' : `linha ${Math.floor(i / size) + 1}, coluna ${(i % size) + 1}: ΔE00 ${d.toFixed(2)}`} />
      ))}
    </div>
  );
}

// --- Entrada de arquivo ---------------------------------------------------------

export function Dropzone(props: { title: string; hint: string; accept: string; fileName?: string | null; onFile: (f: File) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`drop${over ? ' over' : ''}${props.compact ? ' compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) props.onFile(f);
      }}
    >
      <span className="drop-icon">
        <Icon name="upload" size={26} />
      </span>
      <strong>{props.fileName ?? props.title}</strong>
      <span className="muted">{props.fileName ? 'Clique para trocar o arquivo' : props.hint}</span>
      <button type="button" className="btn primary" onClick={() => input.current?.click()}>
        {props.fileName ? 'Trocar arquivo' : 'Escolher arquivo'}
      </button>
      <input
        ref={input}
        type="file"
        accept={props.accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={props.title}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) props.onFile(f);
        }}
      />
    </div>
  );
}

// --- Medidor semicircular do ΔE00 (laudo da simulação) ---------------------------

export function Gauge({ value, verdict, max = 6 }: { value: number; verdict: Verdict; max?: number }) {
  const frac = Math.max(0, Math.min(1, value / max));
  return (
    <div className="gauge" role="img" aria-label={`ΔE00 ${value.toFixed(2)}: ${VERDICT_LABEL[verdict]}`}>
      <svg viewBox="0 0 160 96">
        <path className="gauge-track" d="M14 84 A66 66 0 0 1 146 84" pathLength={100} />
        <path className={`gauge-fill ${verdict}`} d="M14 84 A66 66 0 0 1 146 84" pathLength={100} strokeDasharray={`${frac * 100} 100`} />
        <text className="gauge-num" x="80" y="72" textAnchor="middle">
          {value.toFixed(2).replace('.', ',')}
        </text>
      </svg>
      <Pill verdict={verdict} big />
    </div>
  );
}

// --- Tintas CMYK de uma amostra ----------------------------------------------------

const INKS: Array<{ key: 'c' | 'm' | 'y' | 'k'; label: string }> = [
  { key: 'c', label: 'C' },
  { key: 'm', label: 'M' },
  { key: 'y', label: 'Y' },
  { key: 'k', label: 'K' },
];

export function Inks({ cmyk }: { cmyk: { c: number; m: number; y: number; k: number } }) {
  return (
    <div className="inks" aria-label={`CMYK ${cmyk.c.toFixed(0)}, ${cmyk.m.toFixed(0)}, ${cmyk.y.toFixed(0)}, ${cmyk.k.toFixed(0)} por cento`}>
      {INKS.map(({ key, label }) => (
        <div key={key} className="ink">
          <span className="ink-label">{label}</span>
          <span className="ink-track">
            <i className={`ink-fill ink-${key}`} style={{ width: `${Math.max(0, Math.min(100, cmyk[key]))}%` }} />
          </span>
          <span className="ink-val">{cmyk[key].toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}
