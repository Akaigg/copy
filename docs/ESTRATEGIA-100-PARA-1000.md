# Estratégia "$100 → $1000"

Este documento explica **o que a pesquisa mostra** sobre memecoins na Solana, **por que** as estratégias do
robô foram desenhadas assim, e **um plano em fases** para tentar multiplicar uma banca de $100 por 10. A
regra é decidir com números, nunca com esperança.

> **Resumo honesto.** Multiplicar a banca por 10 em memecoins é possível, mas a grande maioria das pessoas
> não consegue: dados on-chain mostram que só ~6% dos traders de memecoin da Solana tiveram lucro em 90
> dias. Nenhuma estratégia "mais precisa" muda essa base. O que dá para fazer é (1) não ser o trader médio,
> que paga taxa demais, compra rug e segura perdedor, e (2) **medir** se você tem vantagem antes de arriscar.
> O robô faz as duas coisas. A simulação mostra que, **sem vantagem, a conta quebra em ~100% dos cenários**,
> qualquer que seja o tamanho da aposta.

---

## 1. O que os dados mostram

| Fato | Número | Implicação para o robô |
|---|---|---|
| Tokens do Pump.fun que graduam | ~0,2% a ~1,5%, conforme o estudo (0,89% em 2025) | Comprar "qualquer lançamento" é aposta perdida → filtros pesados |
| Tokens que só negociam no dia do lançamento | ~79% | Tempo é risco → saídas por tempo e por "posição parada" |
| Traders de memecoin na Solana com lucro em 90 dias | ~6,25% (perda média de $120) | O trader médio perde → copiar o comportamento médio é perder |
| Tokens com retorno > 100% que mostram crescimento **artificial** (wash trading, manipulação) | ~83% | "Subiu muito" não basta → filtro de wash trading, bundlers, carteiras novas e robôs |
| Transações de manipulação no Pump.fun | ~18%; o 1% maior de criadores lança ~58% das moedas | Devs "fábrica" são a regra → checagem do histórico do dev |
| Copy trade: preço pior para quem copia com ~5s de atraso (líder comprando 5 SOL na bonding curve) | +11% a +24% | Não perseguir o líder → limite de "quanto o preço já andou desde o 1º sinal" |
| Ter canal de Telegram e graduar | 1,49% vs 0,17% (efeito não se repetiu numa amostra nova) | Social é bônus de pontuação, não filtro |
| Bundles | o sinal forte não é o bundle em si, é **bundler vendendo** cedo | Sinal GMGN 10 (bundler vendendo) = rejeitar / sair |
| Rugs previsíveis nos primeiros 5 min (XGBoost, 6,4 mi de tokens) | AUC-PR ≈ 0,76–0,80 com preço, compras/vendas, compradores únicos e volatilidade | Os dados que o robô já usa têm poder preditivo, mas longe de 100% |

E dois resultados de estrutura:

- **Retornos seguem lei de potência.** Quase tudo perde, e raríssimos tokens fazem 10–100x. O resultado de
  uma carteira de trades é decidido pelos poucos outliers. A saída **precisa** deixar uma parte da posição
  correr.
- **Taxas fixas pesam muito numa banca pequena.** Com $100 e aposta de ~$8, priority fee + gorjeta Jito
  (ida e volta) + 1% da GMGN por lado podem custar 3–8% de **cada** trade. Uma vantagem de +5% por trade
  some só com taxa.

---

## 2. Princípios do preset

1. **Taxas mínimas.** Priority/tip de 0,0002–0,0003 SOL, e um filtro que **recusa** trades em que as taxas
   fixas passem de 4% do valor (`risk.maxFeePctOfTrade`).
2. **Não disputar os primeiros segundos.** O sniper de lançamento fica desligado. Os primeiros blocos são
   dominados por bots com mais velocidade e taxa maior, e é ali que uma conta de $100 mais perde.
3. **Não comprar na migração.** A maioria dos tokens despenca logo após graduar. A estratégia `survivor`
   espera 30 min e só entra em quem sobreviveu.
4. **Confluência, não um sinal isolado.** `smartSignal` exige **vários** disparos de smart money/KOL e
   recusa entrar se o market cap já subiu mais de 1,5x desde o primeiro sinal.
5. **Filtros anti-manipulação.** Carteiras novas ≤ 30%, robôs ≤ 60%, dev com ≤ 5% (limites de alerta da
   própria GMGN), bundlers vendendo, wash trading, dev fábrica e "faca caindo" (queda ≥ 10% em 5 min, regra
   de execução da GMGN).
6. **Saída assimétrica (moonbag).** Corta perdedor em -18 a -25%, vende 50% em 2x (o capital volta) e deixa
   o resto correr com um trailing que **alarga** conforme o lucro: 25% → 30% → 35% → 40%.
7. **Juros compostos com freio.** Cada aposta vale 8% do patrimônio atual. Se o patrimônio cai 25% do pico,
   a aposta cai pela metade. A meta de $1000 e o piso de $40 encerram as compras sozinhos.

---

## 3. As estratégias do preset

| Estratégia | Quando compra | Por quê |
|---|---|---|
| **`survivor`** (principal) | Token graduado há 30 min–6 h, que recuou 15–55% do topo, com 500+ holders, liquidez ≥ $30k, volume 1h ≥ $40k, mais compras que vendas, smart money ≥ 2, repique começando no 1m **e** gráfico de 1m aprovado | Pula a fase em que a maioria morre e pega a "segunda perna" de quem tem comunidade real |
| **`smartSignal`** | 3+ sinais de smart money/KOL (feed oficial da GMGN), o último com menos de 4 min, market cap no máximo 1,5x o do 1º sinal | Usa a informação das carteiras boas sem pagar a "penalidade de imitação" |
| **`graduation`** (tamanho 0,6x) | Bonding curve 88–98,5%, volume 1h ≥ $25k, compras/vendas ≥ 1,25, smart money ≥ 1 | Antecipa a migração; é mais arriscada, por isso tamanho e prazo menores |
| **`momentum`** (tamanho 0,7x) | Ranking hot de 1m: +4% a +30% no minuto, liquidez ≥ $25k, compras/vendas ≥ 1,4, **com confirmação do gráfico** | Pega aceleração sem comprar vela esticada |
| **`smartMoney`** (tamanho 0,7x) | Número de carteiras smart money **aumentou** em 2+ nos últimos 5 min | Complementa o smartSignal com outra fonte de dados |

Antes de **cada** compra, o robô ainda:

- busca o preço atual, se o do scanner tiver mais de 8s;
- reconsulta a segurança do token (`/token/security`);
- consulta o histórico do dev (`/user/created_tokens`): rejeita quem tem mais de 30 lançamentos que nunca
  graduaram ou gradua menos de 2%;
- lê o padrão do gráfico de 1m (método da GMGN): rejeita *breakdown*, *slow bleed* e *distribution*;
- calcula o slippage pela fórmula da GMGN em vez de usar um valor fixo: 2% + imposto + impacto×1,5 +
  |Δ5m|×0,5, mais 3% se o token tiver menos de 1h.

---

## 4. A matemática: Monte Carlo

`npm run dev -- simulate` sorteia milhares de sequências de trades e mede a chance de chegar a $1000 antes
de cair a $40, com taxa fixa de $0,30 por trade e até 600 trades. Os três cenários abaixo são
**hipotéticos** e servem só para mostrar a mecânica. O EV bruto vem antes das taxas.

**Sem vantagem (EV bruto ≈ -6%/trade), perfil do trader médio:**

| aposta | atinge $1000 | quebra |
|---|---|---|
| 4% | 0,0% | 100% |
| 8% | 0,0% | 100% |
| 20% | 0,4% | 99,6% |

**Vantagem pequena (EV bruto ≈ +5%/trade):**

| aposta | taxa $0,10 | taxa $0,30 | taxa $0,60 |
|---|---|---|---|
| 8% | 25% meta / 31% quebra | 14% / 65% | 5% / 90% |
| 12% | 35% / 45% | 23% / 66% | 11% / 86% |

**Vantagem clara (EV bruto ≈ +15%/trade):**

| aposta | atinge $1000 | quebra | trades até a meta (mediana) |
|---|---|---|---|
| 4% | 55% | 3% | 452 |
| 8% | 95% | 2% | 260 |
| 12% | 95% | 5% | 181 |
| 20% | 88% | 12% | 114 |
| 35% | 70% | 30% | 65 |

O que esses números ensinam:

1. **Sem vantagem, nenhum tamanho de aposta salva a conta.** Apostar mais só faz perder mais rápido.
2. **Numa banca pequena, as taxas decidem.** Com a mesma vantagem, reduzir a taxa de $0,60 para $0,10 leva a
   chance de quebra de ~90% para ~31%.
3. **O ponto ótimo de aposta fica em ~6–12% do patrimônio.** Acima de ~20%, a chance de quebrar sobe rápido
   (arrasto de volatilidade). O preset usa 8%.
4. **10x leva centenas de trades,** não alguns dias de sorte. Com 4–8 trades por dia, conte meses, não
   semanas.

---

## 5. Plano em fases

### Fase 0: validação em paper (obrigatória, 2–4 semanas)

```bash
npm run dev -- run --config config/preset-100-a-1000.yaml      # mode: paper
```

- Deixe rodando até ter **pelo menos 100 trades fechados**. Menos que isso é ruído.
- Acompanhe com `npm run status -- --config config/preset-100-a-1000.yaml` e pelo painel
  (http://127.0.0.1:8787). O status mostra o resultado por estratégia.
- Desligue as estratégias que estiverem negativas depois de 30+ trades cada.
- Use `npm run replay` sobre as gravações para testar ajustes sem esperar dias.

### Fase 1: decisão com números

```bash
npm run dev -- simulate --trades data/paper/trades.jsonl --start 100 --target 1000 --floor 40 --bet 8
```

Esse comando reamostra os **seus** trades reais. Só passe para o modo real se **todos** os critérios abaixo
forem verdadeiros:

| Critério | Mínimo |
|---|---|
| Trades fechados em paper | ≥ 100 |
| EV por trade (coluna "EV/trade", já com taxas) | > +5% |
| Chance de atingir $1000 no simulate | ≥ 50% |
| Chance de quebrar no simulate | ≤ 25% |
| Maior queda do patrimônio em paper | < 35% |

Se não passar, **não opere em real**. Ajuste os filtros, volte para a Fase 0 ou aceite que o mercado, no
momento, não está dando vantagem.

### Fase 2: real com $100

1. Assine o plano Plus/Pro da API da GMGN. O swap não cabe no plano free.
2. No preset, defina `mode: live`, `live.acknowledgeRisk: true` e `goal.targetUsd: 1000`.
3. Use uma carteira **dedicada**, só com os $100 e um pouco de SOL para taxas.
4. Rode e **não mexa nos parâmetros no meio de uma sequência de perdas**: a pausa automática existe para
   isso.
5. Ao atingir $1000, o robô para de comprar. Saque o capital inicial antes de pensar em continuar.

### Regras de ouro

- Nunca deposite mais para "recuperar". O piso de $40 existe para encerrar a tentativa.
- Nunca aumente `equityPct` acima de 12% para "acelerar".
- Nunca desligue os filtros de segurança porque "está perdendo oportunidades".
- O mercado muda: refaça o `simulate --trades` com os trades reais a cada 50 trades. Se o EV ficar
  negativo, pare.

---

## 6. Limitações (leia)

- Vários números da seção 1 vêm de estudos e painéis de terceiros, com metodologias diferentes entre si.
  Servem como ordem de grandeza.
- Os limites dos filtros (30% de carteiras novas, 60% de robôs, 5% de dev) vêm da documentação da GMGN e
  não foram otimizados por este robô. A validação em paper serve exatamente para isso.
- O paper trading simula impacto de preço, taxas e falhas, mas o real costuma ser **pior**: latência, MEV e
  ordens que falham na alta.
- O replay só conhece o preço de um token enquanto ele aparecia nos dados gravados.

---

## Fontes

- [Memecoin casino: $100 bet on Pump.fun has worse odds than roulette (Cointelegraph)](https://cointelegraph.com/news/memecoin-casino-bet-pump-odds)
- [Pump.fun memecoins are dying at record rates, less than 1% survive (Cointelegraph)](https://cointelegraph.com/news/pump-fun-memecoins-are-dying-at-record-rates-less-than-1-survive)
- [Pump.fun's 79% first-day dropout rate (crypto.news)](https://crypto.news/pump-fun-memecoin-trader-fatigue-token-survival/)
- [What Are the Odds: Only 6% of Solana Meme Traders Made a Profit Over 90 Days (HTX)](https://www.htx.com/news/what-are-the-odds-only-6-of-solana-meme-traders-made-a-profi-5gTkabXy/)
- [Pump.fun Data: Over 50% of Traders in Loss (CoinAlertNews)](https://coinalertnews.com/news/2026/03/25/pumpfun-traders-losses-profits-data)
- [Pump.fun Traders Are Making a Comeback (CoinGecko)](https://www.coingecko.com/research/publications/pump-fun-traders-are-making-a-comeback)
- [How many pump.fun tokens actually graduate? (Pegasus)](https://pegasus.botdoctor.dev/guides/pump-fun-graduation-rate)
- [Pump.fun Graduation Regime Windows: Survival Analysis of 832,941 Token Launches (arXiv 2607.02823)](https://arxiv.org/html/2607.02823v3)
- [Predicting the success of new crypto-tokens: the Pump.fun case (arXiv 2602.14860)](https://arxiv.org/abs/2602.14860)
- [Catching the Rug: Early Prediction of Fraudulent Memecoins on Solana via Machine Learning (arXiv 2608.20271)](https://arxiv.org/abs/2608.20271)
- [A Midsummer Meme's Dream: Investigating Market Manipulations in the Meme Coin Ecosystem (arXiv 2507.01963 / USENIX Security 2026)](https://arxiv.org/abs/2507.01963v2)
- [Meme Coin Factories: Large-Scale Manipulations on pump.fun (arXiv 2609.10246, resumo)](https://www.emergentmind.com/papers/2609.10246)
- [Resisting Manipulative Bots in Meme Coin Copy Trading (arXiv 2601.08641)](https://arxiv.org/html/2601.08641v2)
- [Trading Dynamics & Copy-Trading Feasibility on Pump.fun (Kurnovskii)](https://romankurnovskii.com/en/blog/pumpfun-copy-trading-feasibility/)
- [Coordinated Sniper Cohorts on Pump.fun (arXiv 2607.02795)](https://arxiv.org/abs/2607.02795)
- [Pump.fun bundle detection (Scorp Labs)](https://trader.scorplabs.online/blog/pump-fun-bundle-detection)
- [From $100 to $1M: The Mathematical Reality of Meme Coin "Moonshots" (Coinmonks)](https://medium.com/coinmonks/from-100-to-1m-the-mathematical-reality-of-meme-coin-moonshots-and-why-99-of-traders-lose-3a9167493082)
- [Venture Capital Portfolio Construction (lei de potência, arXiv 2303.11013)](https://arxiv.org/pdf/2303.11013)
- Documentação oficial da GMGN OpenAPI / gmgn-cli (skills `gmgn-token-buy`, `gmgn-dev-score`, `gmgn-kline-pattern`, `gmgn-market`)
