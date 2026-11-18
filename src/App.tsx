// ColorProof: painel com menu lateral (Visão geral, Simulação, Amostras e
// Relatório) e, no alto, o arquivo e a condição de impressão (perfil ICC).
// Todo o cálculo roda num Web Worker, no navegador; nenhum arquivo sai do computador.

import { useRef, useState } from 'react';
import { Status } from './components/common';
import { Icon } from './components/ui';
import OverviewPage from './pages/OverviewPage';
import ReportPage from './pages/ReportPage';
import SamplesPage from './pages/SamplesPage';
import SimulationPage from './pages/SimulationPage';
import SpotsPage from './pages/SpotsPage';
import { useSpots } from './state/useSpots';
import { useWorkspace } from './state/useWorkspace';

type Tab = 'geral' | 'simulacao' | 'amostras' | 'spot' | 'relatorio';

const NAV: Array<{ id: Tab; label: string; icon: 'grid' | 'compare' | 'palette' | 'file' | 'layers'; title: string; subtitle: string }> = [
  { id: 'geral', label: 'Visão geral', icon: 'grid', title: 'Visão geral', subtitle: 'O arquivo, a simulação de impressão e o laudo numa tela só' },
  { id: 'simulacao', label: 'Simulação', icon: 'compare', title: 'Simulação de impressão', subtitle: 'Como o arquivo sairia impresso, gerado a partir de um único arquivo' },
  { id: 'amostras', label: 'Amostras', icon: 'palette', title: 'Amostras', subtitle: 'As cores dominantes, no arquivo e impressas, com a referência CMYK' },
  { id: 'spot', label: 'Cores spot', icon: 'layers', title: 'Cores spot (Pantone)', subtitle: 'O CMYK que mais se aproxima de uma cor Pantone, na condição de impressão escolhida' },
  { id: 'relatorio', label: 'Relatório', icon: 'file', title: 'Relatório', subtitle: 'Laudos para imprimir ou baixar e o que o método mede' },
];

function Picker(props: { label: string; value: string | null; empty: string; action: string; accept: string; aria: string; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="picker">
      <span className="muted small">{props.label}</span>
      <div className="picker-row">
        <span className={`chip${props.value ? ' on' : ''}`} title={props.value ?? undefined}>
          {props.value ?? props.empty}
        </span>
        <button type="button" className="btn primary" onClick={() => input.current?.click()}>
          {props.action}
        </button>
        <input
          ref={input}
          type="file"
          accept={props.accept}
          className="sr-only"
          tabIndex={-1}
          aria-label={props.aria}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) props.onFile(f);
          }}
        />
      </div>
    </div>
  );
}

function App() {
  const ws = useWorkspace();
  const spots = useSpots(ws);
  const [tab, setTab] = useState<Tab>('geral');
  const current = NAV.find((n) => n.id === tab)!;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="palette" size={22} />
          </span>
          <strong>ColorProof</strong>
        </div>
        <nav aria-label="Páginas">
          {NAV.map((n) => (
            <button key={n.id} type="button" className="nav-item" aria-current={tab === n.id ? 'page' : undefined} onClick={() => setTab(n.id)}>
              <Icon name={n.icon} size={20} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <p className="side-note">
          <Icon name="shield" size={16} /> Tudo roda no seu navegador. Nenhum arquivo é enviado.
        </p>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="titles">
            <h1>{current.title}</h1>
            <p className="muted">{current.subtitle}</p>
          </div>
          <div className="pickers">
            <Picker
              label="Arquivo de referência"
              value={ws.file?.name ?? null}
              empty="Nenhum arquivo"
              action={ws.file ? 'Trocar arquivo' : 'Escolher arquivo'}
              accept=".pdf,application/pdf,image/*"
              aria="Arquivo PDF ou imagem"
              onFile={ws.pickFile}
            />
            <Picker
              label="Condição de impressão"
              value={ws.profileName}
              empty="Nenhum perfil"
              action={ws.profileName ? 'Trocar perfil' : 'Escolher perfil ICC'}
              accept=".icc,.icm"
              aria="Perfil ICC CMYK"
              onFile={(f) => void ws.pickProfile(f)}
            />
          </div>
        </header>
        {ws.profileError && <Status kind="error">Erro: {ws.profileError}</Status>}

        {tab === 'geral' && <OverviewPage ws={ws} />}
        {tab === 'simulacao' && <SimulationPage ws={ws} />}
        {tab === 'amostras' && <SamplesPage ws={ws} />}
        {tab === 'spot' && <SpotsPage ws={ws} spots={spots} />}
        {tab === 'relatorio' && <ReportPage ws={ws} />}
      </main>
    </div>
  );
}

export default App;
