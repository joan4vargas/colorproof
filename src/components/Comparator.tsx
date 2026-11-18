// Comparador da simulação: divisor arrastável, lado a lado ou mapa de ΔE00.

import { useEffect, useRef, useState } from 'react';
import type { VerdictThresholds } from '../core/verdict';
import type { PrintSimulation } from '../lib/simulate/simulatePrint';
import { Heatmap } from './ui';

type Mode = 'divisor' | 'lado' | 'mapa';

function Pic({ data, width, height, className, style, label }: { data: Uint8ClampedArray; width: number; height: number; className?: string; style?: React.CSSProperties; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(data) as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  }, [data, width, height]);
  return <canvas ref={ref} width={width} height={height} className={className} style={style} role="img" aria-label={label} />;
}

export default function Comparator({ sim, thresholds }: { sim: PrintSimulation; thresholds: VerdictThresholds }) {
  const [mode, setMode] = useState<Mode>('divisor');
  const [pos, setPos] = useState(50);
  const { width, height, original, simulated, report } = sim;
  const page = report?.pages[0] ?? null;
  const ratio = width / height;
  // largura limitada pela altura máxima (70% da tela): o quadro mantém a proporção da imagem, sem esticar
  const cmpStyle = { aspectRatio: String(ratio), width: `min(100%, ${(ratio * 70).toFixed(2)}svh)` };
  const modes: Array<{ id: Mode; label: string }> = [
    { id: 'divisor', label: 'Divisor' },
    { id: 'lado', label: 'Lado a lado' },
    ...(page ? [{ id: 'mapa' as const, label: 'Mapa de ΔE00' }] : []),
  ];
  const active: Mode = original ? mode : 'divisor';

  return (
    <div className="cmp-wrap">
      {original && (
        <div className="seg" role="group" aria-label="Modo de visualização">
          {modes.map((m) => (
            <button key={m.id} type="button" aria-pressed={active === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}

      {!original && (
        <div className="cmp" style={cmpStyle}>
          <Pic data={simulated} width={width} height={height} className="cmp-layer" label="Simulação de impressão (CMYK)" />
          <span className="cmp-tag right">Simulação (CMYK)</span>
        </div>
      )}

      {original && active === 'divisor' && (
        <div className="cmp" style={cmpStyle}>
          <Pic data={original} width={width} height={height} className="cmp-layer" label="Referência em RGB" />
          <Pic data={simulated} width={width} height={height} className="cmp-layer" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} label="Simulação de impressão (CMYK)" />
          <span className="cmp-tag left">Referência (RGB)</span>
          <span className="cmp-tag right">Simulação (CMYK)</span>
          <i className="cmp-line" style={{ left: `${pos}%` }} aria-hidden="true">
            <b />
          </i>
          <input className="cmp-range" type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Posição do divisor entre a referência e a simulação" />
        </div>
      )}

      {original && active === 'lado' && (
        <div className="cmp-pair">
          <figure>
            <Pic data={original} width={width} height={height} label="Referência em RGB" />
            <figcaption>Referência (RGB)</figcaption>
          </figure>
          <figure>
            <Pic data={simulated} width={width} height={height} label="Simulação de impressão (CMYK)" />
            <figcaption>Simulação (CMYK)</figcaption>
          </figure>
        </div>
      )}

      {original && active === 'mapa' && page && (
        <div>
          <Heatmap grid={page.deltaEGrid} size={report!.grid} aspect={page.aspect} thresholds={thresholds} />
          <p className="muted small center">Cada quadrado é uma região da página. Mint: dentro do limite de aprovação; âmbar: atenção; coral: acima do limite. Transparente: papel nas duas versões.</p>
        </div>
      )}
    </div>
  );
}
