// "Sobre o método": o que o sistema mede, como ler o resultado e o que ele não faz.

import { DEFAULT_THRESHOLDS } from '../core/verdict';
import { Card } from './ui';

export default function AboutPanel() {
  const t = DEFAULT_THRESHOLDS;
  return (
    <div className="stack">
      <div className="grid g-1-1">
        <Card title="O que o sistema faz">
          <p>
            Compara as cores de um arquivo com o que uma condição de impressão consegue reproduzir. Tudo é calculado em CIE
            L*a*b* (D50), sem depender do seu monitor, e a diferença é medida em ΔE00 (CIEDE2000).
          </p>
          <p>
            <strong>Amostras.</strong> Cada cor dominante vai ao CMYK do perfil ICC e volta a Lab. Quanto maior o ΔE00 entre a
            cor original e a de volta, mais a cor sai do alcance (gamut) daquela impressão.
          </p>
          <p>
            <strong>Sugestão.</strong> Para uma amostra que não ficou conforme, o programa propõe uma cor próxima, de mesmo
            matiz, que a impressão reproduz. Ajustar as tintas não resolve uma cor fora do gamut; o que muda é a cor do projeto.
          </p>
          <p>
            <strong>Cores spot.</strong> Para uma cor Pantone, o programa procura o CMYK que mais se aproxima dela na condição
            de impressão. Ele não traz a biblioteca Pantone: o valor de referência vem do PDF, de quem digita ou de uma medição.
            Cores fora do alcance do CMYK ficam com a melhor aproximação e o ΔE00 mostra a perda.
          </p>
          <p>
            <strong>Simulação.</strong> O programa converte o arquivo pelo perfil (RGB para CMYK e de volta à tela), divide
            as duas imagens em regiões e compara a cor de cada região, original contra simulada.
          </p>
        </Card>
        <Card title="Como ler o veredito">
          <p>
            Aprovado até ΔE00 {t.approvedMax.toFixed(1)}. Atenção até {t.attentionMax.toFixed(1)}. Reprovado acima. Esses
            limites são uma decisão de projeto, apoiada no erro do próprio método (ida e volta pelo perfil), e não valores da
            norma ISO 12647.
          </p>
          <p>
            Na simulação, o resultado geral vem do percentil 95 das regiões. O pior caso aparece à parte, porque bordas entre
            cores pesam muito num deslocamento de poucos pixels.
          </p>
          <p>Intent: colorimétrico relativo, sem compensação de ponto preto. O preto impresso é mais claro que o da tela, e a compensação esconderia essa perda.</p>
        </Card>
      </div>
      <Card title="O que o sistema não faz">
        <ul className="plain">
          <li>
            <strong>Não é laudo ISO 12647.</strong> A norma avalia material impresso, medido com espectrofotômetro. Aqui a
            verificação é numérica, feita sobre o arquivo e o perfil.
          </li>
          <li>Elementos pequenos, texto fino, transparências e overprint podem não ser representados com fidelidade.</li>
          <li>A simulação mostra só a primeira página. Num PDF já em CMYK ela mostra como o perfil reproduz esses valores, sem comparação com RGB.</li>
          <li>Se o PDF mistura CMYK e RGB, os elementos em RGB são convertidos para CMYK sem perfil, e o sistema avisa.</li>
          <li>Os testes usaram arquivos sintéticos e dois perfis da ECI (ISO Coated v2 e PSO Coated v3). Arquivos reais de produção ainda precisam ser avaliados.</li>
        </ul>
      </Card>
      <Card title="Privacidade">
        <p>
          A análise roda no seu navegador, num Web Worker. O PDF, a imagem e o perfil ICC não são enviados a nenhum servidor.
          O perfil não fica guardado: ao reabrir a página, escolha-o de novo.
        </p>
      </Card>
    </div>
  );
}
