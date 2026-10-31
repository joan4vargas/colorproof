// Placeholder da UI (Fase 8 do roteiro).
//
// Este componente existe só para provar que o scaffold sobe de ponta a
// ponta (Vite + React + TS) e para deixar visível, desde já, o estado
// de cada fase do projeto. A UI real (upload de PDF, seleção de perfil,
// visualização lado a lado, tabela de amostras e laudo) é construída na
// última fase do roteiro, depois que o núcleo matemático e o motor de
// cor já estiverem validados.

import './App.css';
import PdfColorTest from './components/PdfColorTest';
import ProfileSmokeTest from './components/ProfileSmokeTest';

interface PhaseStatus {
  name: string;
  done: boolean;
}

const PHASES: PhaseStatus[] = [
  { name: 'Núcleo matemático colorimétrico (RGB→XYZ→Lab, Bradford, CIEDE2000)', done: true },
  { name: 'Motor de cor via lcms2-wasm', done: true },
  { name: 'Extração de cor do PDF (pdf.js + clusterização)', done: true },
  { name: 'Web Workers e performance', done: false },
  { name: 'Fluxo A: round-trip (foco principal)', done: false },
  { name: 'Fluxo B: referência vs. simulação (complementar)', done: false },
  { name: 'Interface e validação final', done: false },
];

function App() {
  return (
    <main className="scaffold-status">
      <h1>ColorProof — scaffold</h1>
      <p>
        Sistema web de simulação cromática e análise de conformidade de cor.
        Este placeholder será substituído pela interface real na última fase
        do roteiro.
      </p>
      <ul>
        {PHASES.map((phase) => (
          <li key={phase.name} className={phase.done ? 'done' : 'pending'}>
            <span aria-hidden="true">{phase.done ? '✓' : '○'}</span> {phase.name}
          </li>
        ))}
      </ul>
      <ProfileSmokeTest />
      <PdfColorTest />
    </main>
  );
}

export default App;
