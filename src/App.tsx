// Interface do ColorProof (Fase 8): perfil compartilhado e duas abas, uma por fluxo.
// Todo o cálculo roda num Web Worker, no navegador; nenhum arquivo sai do computador.

import { useCallback, useEffect, useRef, useState } from 'react';
import FlowAPanel from './components/FlowAPanel';
import FlowBPanel from './components/FlowBPanel';
import { FilePick, Status } from './components/common';
import type { AnalysisClient } from './lib/analysis/analysisClient';
import { createBrowserAnalysisClient } from './lib/analysis/browserAnalysis';

type Tab = 'a' | 'b';

function App() {
  const client = useRef<AnalysisClient | null>(null);
  const [tab, setTab] = useState<Tab>('a');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const rerunners = useRef(new Set<() => void>());
  const getClient = useCallback(() => (client.current ??= createBrowserAnalysisClient()), []);
  const registerRerun = useCallback((fn: () => void) => {
    rerunners.current.add(fn);
    return () => {
      rerunners.current.delete(fn);
    };
  }, []);
  useEffect(() => () => client.current?.dispose(), []);

  async function onProfile(file: File) {
    setProfileError(null);
    try {
      setProfileName(await getClient().setProfile(await file.arrayBuffer()));
      rerunners.current.forEach((fn) => fn()); // reanalisa o que estiver na tela com o perfil novo
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>ColorProof</h1>
        <p>Simulação de conformidade de cor, no navegador. Nada é enviado a servidor.</p>
      </header>

      <section className="card">
        <h2>Condição de impressão</h2>
        <p className="muted">
          Escolha o perfil ICC CMYK de saída (por exemplo, ISO Coated v2 ou PSO Coated v3, da ECI). Ele é lido só no seu
          computador. Trocar o perfil refaz a análise atual.
        </p>
        <FilePick label="Perfil CMYK (.icc)" buttonText="Escolher perfil" accept=".icc,.icm" fileName={profileName} onFile={(f) => void onProfile(f)} />
        {profileError && <Status kind="error">Erro: {profileError}</Status>}
      </section>

      <div className="tabs" role="tablist" aria-label="Fluxos">
        <button type="button" role="tab" id="tab-a" aria-selected={tab === 'a'} aria-controls="panel-a" onClick={() => setTab('a')}>
          Fluxo A: verificar um arquivo
        </button>
        <button type="button" role="tab" id="tab-b" aria-selected={tab === 'b'} aria-controls="panel-b" onClick={() => setTab('b')}>
          Fluxo B: comparar duas versões
        </button>
      </div>
      <div role="tabpanel" id="panel-a" aria-labelledby="tab-a" hidden={tab !== 'a'}>
        <FlowAPanel getClient={getClient} registerRerun={registerRerun} hasProfile={profileName !== null} />
      </div>
      <div role="tabpanel" id="panel-b" aria-labelledby="tab-b" hidden={tab !== 'b'}>
        <FlowBPanel getClient={getClient} registerRerun={registerRerun} profileName={profileName} />
      </div>
    </div>
  );
}

export default App;
