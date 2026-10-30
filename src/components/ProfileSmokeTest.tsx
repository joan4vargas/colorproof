// Teste provisório da Fase 3 no navegador (será substituído pela UI da Fase 8).
//
// Serve para confirmar, no ambiente real (Vite + navegador), que o WASM do
// lcms2 carrega e converte cores usando um perfil .icc escolhido pelo usuário.
// O arquivo é lido localmente (File API) e não sai do computador.

import { useState } from 'react';
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url';
import { createColorEngine } from '../lib/icc/colorEngine';
import type { Lab } from '../types/color';

interface Row {
  nome: string;
  lab: Lab;
}

interface Result {
  descricao: string;
  linhas: Row[];
}

const fmt = (lab: Lab) => `L* ${lab.l.toFixed(2)}  a* ${lab.a.toFixed(2)}  b* ${lab.b.toFixed(2)}`;

export default function ProfileSmokeTest() {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    if (!file) return;
    try {
      const engine = await createColorEngine({ wasmUrl });
      const profile = await engine.loadProfile(new Uint8Array(await file.arrayBuffer()));
      const solidos = [
        { nome: 'Papel (0/0/0/0)', cmyk: { c: 0, m: 0, y: 0, k: 0 } },
        { nome: 'Ciano 100%', cmyk: { c: 100, m: 0, y: 0, k: 0 } },
        { nome: 'Magenta 100%', cmyk: { c: 0, m: 100, y: 0, k: 0 } },
        { nome: 'Amarelo 100%', cmyk: { c: 0, m: 0, y: 100, k: 0 } },
        { nome: 'Preto 100%', cmyk: { c: 0, m: 0, y: 0, k: 100 } },
      ];
      setResult({
        descricao: profile.description,
        linhas: solidos.map((s) => ({ nome: s.nome, lab: profile.cmykToLab(s.cmyk, 'absolute') })),
      });
      profile.libera();
      engine.dispose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Teste do motor de cor (provisório)</h2>
      <p>
        Escolha um perfil CMYK (.icc). O arquivo é lido no seu navegador e não é enviado a nenhum
        servidor. Valores em Lab D50, intent colorimétrico absoluto.
      </p>
      <input type="file" accept=".icc,.icm" onChange={(e) => void onFile(e.target.files?.[0])} />
      {error && <p role="alert">Erro: {error}</p>}
      {result && (
        <>
          <p>
            Perfil: <strong>{result.descricao}</strong>
          </p>
          <pre>{result.linhas.map((r) => `${r.nome.padEnd(18)} ${fmt(r.lab)}`).join('\n')}</pre>
        </>
      )}
    </section>
  );
}
