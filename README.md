# GMGN Hot Bot 🤖

Robô de compra e venda automatizada para **memecoins recém-lançadas ("hot") na Solana**, usando a
**OpenAPI oficial da GMGN** (`openapi.gmgn.ai`). Ele tem 8 estratégias, filtros anti-rug, gestão de risco,
modo **paper trading** (simulação com preços reais), painel web, alertas no Telegram e replay (backtest)
sobre dados gravados.

> ⚠️ **Aviso de risco.** Memecoins recém-lançadas são o mercado mais arriscado que existe: a maioria vai a
> zero, rug pulls acontecem em segundos e o slippage é brutal. Este software **não garante lucro**. Ele não
> substitui o seu julgamento e pode perder todo o capital que você colocar nele. Comece **sempre** no modo
> `paper`. No `live`, use uma carteira dedicada com pouco dinheiro, um valor que você aceite perder.

---

## Como funciona

```
 ┌──────────── a cada 4s ────────────┐      ┌────────── a cada 2,5s ──────────┐
 │ Scanner GMGN                      │      │ Monitor de posições              │
 │  • Trenches: novos / quase        │      │  • preço atual (GMGN)            │
 │    graduando / recém-graduados    │      │  • stop loss / break-even        │
 │  • Ranking hot 1m / 5m / 1h       │      │  • take profit em escada         │
 └──────────────┬────────────────────┘      │  • trailing stop                 │
                ▼                           │  • tempo máximo / posição parada │
   Filtros de segurança (anti-rug)          └───────────────┬──────────────────┘
                ▼                                           ▼
   6 estratégias → pontuação 0–100                   Execução (venda)
                ▼                              escalonamento de slippage
   Gestão de risco (tamanho, limites)
                ▼
   Rechecagem /token/security → Execução (compra)
```

Há ainda um ciclo de manutenção que, no modo live, confere o saldo real da carteira (detecta vendas feitas
fora do robô e recupera compras com status incerto). Ele também revalida a segurança das posições abertas
e vende se o token piorar, por exemplo quando o `rug_ratio` dispara.

### Estratégias

| ID | Nome | Ideia | Fonte |
|---|---|---|---|
| `sniper` | Sniper de lançamento | Token com 20s–5min de vida na bonding curve que já tem tração: muitos swaps, mais compras que vendas, holders crescendo e market cap baixo | Trenches `new_creation` |
| `graduation` | Pré-graduação | Bonding curve com 85%+ e volume forte. Entra antes da migração para a DEX | Trenches `near_completion` |
| `migration` | Recém-graduado | Migrou há menos de 15 min, com liquidez, holders e volume saudáveis | Trenches `completed` |
| `momentum` | Momentum hot | No ranking 1m com alta forte e pressão compradora, sem entrar em vela já esticada | Ranking `1m`/`5m` |
| `smartMoney` | Seguir smart money | O número de carteiras smart degen/KOL **aumentou** na janela | Qualquer |
| `dipBuy` | Compra no recuo | Subiu forte em 1h, corrigiu em 5m e repica em 1m. *Desligada por padrão* | Ranking `1h` |
| `smartSignal` | Confluência smart money/KOL | Vários sinais de smart money e KOL, sem perseguir o preço (recusa se o market cap já andou mais de 1,5x desde o 1º sinal) | Feed de sinais da GMGN |
| `survivor` | Sobrevivente pós-migração | Graduou há 30 min–6 h, recuou do topo, holders e liquidez reais, repique começando ("2ª perna") | Ranking `1h` + trenches |

Cada estratégia tem **tamanho de compra, slippage, taxas, pontuação mínima, filtros e regras de saída
próprios**. Quando duas estratégias apontam o mesmo token, vale a de maior pontuação.

### Filtros de segurança (antes de qualquer compra)

mint/freeze authority renunciadas · honeypot · wash trading · `rug_ratio` · concentração top 10 · bundlers ·
insiders · % do dev · snipers · impostos de compra/venda · liquidez e holders mínimos · carteiras novas ·
robôs · **faca caindo** (queda ≥ 10% em 5 min) · **bundlers vendendo** · **dev fábrica** (muitos lançamentos
sem graduar) · blacklist de tokens e de devs.

Logo antes de cada compra, o robô ainda busca o preço atual, reconsulta a segurança (`/v1/token/security`)
e, quando configurado, o histórico do dev (`/v1/user/created_tokens`) e o padrão do gráfico de 1m. O
slippage é calculado pela fórmula da GMGN, não fixo.

### Gestão de risco

- tamanho **fixo** ou **% do patrimônio** (juros compostos), com freio automático em drawdown
- **meta** e **piso** de patrimônio em USD (para sozinho ao atingir)
- filtro de **taxas**: recusa trades em que priority + tip passariam de X% do valor
- máximo de posições (global e por estratégia) e exposição total (em SOL ou % do patrimônio)
- tamanho limitado a % do saldo, com reserva de SOL para taxas
- **limite de perda diária**, com meta de lucro diária opcional
- pausa automática após N perdas seguidas
- cooldown por token (sem recompra em sequência) e máximo de compras por hora
- **blacklist automática do dev** quando um token dele dá perda grande
- **kill switch**: crie um arquivo chamado `STOP` na pasta do robô para bloquear novas compras na hora
- trava (`bot.lock`) que impede duas instâncias de operarem o mesmo estado

## 🎯 Plano "$100 → $1000"

Para quem quer crescer uma banca pequena, há um preset feito a partir de pesquisa sobre o mercado de
memecoins: [`config/preset-100-a-1000.yaml`](config/preset-100-a-1000.yaml). Ele traz juros compostos
(8% do patrimônio por trade), saídas *moonbag*, taxas mínimas, meta de $1000 e piso de $40. A explicação
completa, com os dados, a matemática (Monte Carlo) e o **plano em fases**, está em
**[docs/ESTRATEGIA-100-PARA-1000.md](docs/ESTRATEGIA-100-PARA-1000.md)**.

```bash
npm run dev -- run --config config/preset-100-a-1000.yaml          # 1. valida em paper (100+ trades)
npm run dev -- simulate --trades data/paper/trades.jsonl --bet 8   # 2. mede a chance real de 10x
```

---

## Instalação

Requisitos: **Node.js 20.6+**.

```bash
npm install
npm run dev -- init          # cria config/config.yaml e .env
```

### 1. Credenciais da GMGN

1. Gere o par de chaves de assinatura da API (Ed25519):
   ```bash
   npm run dev -- keygen
   ```
   A chave **privada** fica em `keys/gmgn-signing.pem` e a **pública** aparece na tela.
2. Acesse **https://gmgn.ai/ai/generateapi**, cole a chave pública e crie a API key. A key fica vinculada à
   carteira da sua conta GMGN, e é por essa carteira que o robô opera no modo live.
3. Preencha o `.env`:
   ```env
   GMGN_API_KEY=sua_api_key
   GMGN_PRIVATE_KEY_FILE=keys/gmgn-signing.pem
   GMGN_WALLET_ADDRESS=endereco_da_carteira_solana_vinculada
   ```

> A chave de assinatura **não é** a chave privada da sua carteira. O robô nunca vê nem guarda a seed ou a
> chave da carteira: os swaps são feitos pela GMGN, na carteira vinculada à API key.

> **Plano da API:** no plano free (5 req/s, capacidade 5) a rota de swap (peso 10) não cabe no balde. Para
> **paper**, o free basta. Para **live**, você provavelmente vai precisar do plano Plus ou Pro. Ajuste
> `gmgn.plan` no config.

### 2. Verifique

```bash
npm run dev -- check
```

Esse comando testa as credenciais, o preço do SOL, o ranking, o trenches e, se configurado, a rota assinada
de saldo.

---

## Uso

```bash
npm run scan                    # uma varredura: mostra o que cada estratégia compraria (não opera)
npm run scan -- --verbose       # inclui os motivos de reprovação
npm run paper                   # roda em simulação (preços reais, dinheiro fictício)
npm run status                  # posições abertas, PnL do dia/total e por estratégia
npm run replay                  # backtest sobre data/recordings
npm run dev -- simulate --trades data/paper/trades.jsonl   # Monte Carlo com seus trades
npm run dev -- simulate --scenario equilibrado              # cenários hipotéticos
npm run dev -- sell-all         # vende tudo (com o robô parado)
```

Para operar com dinheiro real:

1. no `config/config.yaml`, defina `live.acknowledgeRisk: true`;
2. rode `npm run live` (equivale a `run --mode live`).

Em produção, compile e rode com um gerenciador de processos:

```bash
npm run build
node dist/index.js run --mode paper          # ou: pm2 start dist/index.js -- run
```

`Ctrl+C` desliga com segurança: o robô espera as ordens em andamento terminarem e salva o estado. As
posições abertas continuam sendo gerenciadas quando ele volta. Para vender tudo ao desligar, use
`sellAllOnShutdown: true`.

### Painel web

Com o robô rodando, abra **http://127.0.0.1:8787**. O painel mostra saldo, PnL, posições e os últimos
trades, e se atualiza sozinho. Os botões **Pausar / Retomar / Vender tudo** exigem `dashboard.authToken` no
config. O painel escuta só em `127.0.0.1` por padrão; não exponha na internet.

API: `GET /api/status` · `POST /api/pause` · `POST /api/resume` · `POST /api/sell-all` (header
`X-Auth-Token`).

### Telegram

Crie um bot com o @BotFather, pegue o seu chat id e preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` no
`.env`. Depois ative `notifications.telegram.enabled: true`. Você recebe compras, vendas, erros, alertas de
risco e o resumo diário.

### Replay / backtest

Com `recorder.enabled: true` (padrão), tudo o que o robô vê é gravado em `data/recordings/AAAA-MM-DD.jsonl`.
Deixe o robô rodar em paper por um ou dois dias, ajuste os parâmetros e reavalie:

```bash
npm run replay                                  # todos os arquivos
npm run replay -- data/recordings/2026-10-25.jsonl
```

O resultado sai por estratégia (trades, acerto, PnL). Limitação: o replay só conhece o preço de um token
enquanto ele aparecia no scanner ou era posição durante a gravação. Trate o resultado como uma estimativa.

---

## Configuração

Tudo fica em `config/config.yaml`, e o exemplo comentado está em
[`config/config.example.yaml`](config/config.example.yaml). Campos omitidos usam os padrões de
[`src/config/schema.ts`](src/config/schema.ts), que também valida tudo na inicialização e aponta exatamente
o campo errado.

Convenção de unidades: `*Pct` = porcentagem (25 = 25%), `*Rate`/`*Ratio` = fração 0–1 (como a GMGN
devolve), `*Sol`, `*Usd`, `*Ms`, `*Min`.

Regras de saída por estratégia (`strategies.<id>.exit`):

| Campo | O que faz |
|---|---|
| `stopLossPct` | vende tudo se cair X% abaixo da entrada |
| `takeProfits` | escada de vendas parciais: `atPct` = ganho, `sellPct` = % da posição **original** |
| `trailing` | depois de `activateAtPct` de lucro, vende tudo se recuar `drawdownPct` da máxima; `tiers` alarga a folga conforme o lucro (moonbag) |
| `breakEvenAtPct` | depois de X% de lucro, o stop sobe para a entrada + `breakEvenBufferPct` |
| `maxHoldMin` / `maxHoldAfterTpMin` | tempo máximo na posição, antes e depois do 1º take profit |
| `staleAfterMin` / `staleMinGainPct` | sai se, após X min, o pico não passou de Y% |
| `exitOnSafetyFail` | vende se a segurança do token piorar durante a posição |

### Dicas de ajuste

- Comece com `log.level: debug` e `npm run scan -- --verbose` para entender por que os tokens passam ou não.
- Se o robô compra pouco, afrouxe **um** parâmetro por vez e valide com `replay`.
- Mantenha `buySol` pequeno: em tokens com liquidez de $10k, uma compra de 1 SOL já move o preço vários %.
- Taxas (`priorityFeeSol` + `tipFeeSol`, ida e volta) comem resultado em compras pequenas. Considere o custo
  total por trade.

---

## Estrutura

```
src/
  index.ts              CLI (init, keygen, check, scan, run, status, sell-all, replay, simulate)
  simulate.ts           Monte Carlo de banca
  runtime.ts            monta as dependências (cliente, executor, notificador...)
  engine.ts             motor: ciclos de scan, posições e manutenção
  replay.ts             backtest sobre gravações
  config/               schema (zod) + carregamento do YAML/.env
  gmgn/                 cliente OpenAPI GMGN (assinatura Ed25519/RSA, retries, rate-limit)
  scanner/              scanner, normalização dos dados, memória de tokens
  filters/safety.ts     filtros anti-rug
  filters/kline.ts      leitura de padrão gráfico (método da GMGN)
  strategies/           as 8 estratégias
  risk/riskManager.ts   gestão de risco
  positions/exitRules.ts regras de saída (funções puras)
  execution/            executor paper, executor live, dados de mercado
  notify/               Telegram
  dashboard/            painel web
  core/                 logger, rate limiter, persistência, gravador, tipos
test/                   testes unitários + e2e contra uma GMGN simulada
data/                   (gerado) estado, trades.jsonl, logs, gravações — separado por modo
```

## Desenvolvimento

```bash
npm test          # testes unitários e de ponta a ponta (servidor GMGN falso)
npm run typecheck
npm run build
```

## Robustez

- **Rate limit:** balde com prioridades (vendas > compras > monitoramento > scanner) igual ao da GMGN. Ao
  receber 429, o robô congela todas as chamadas até o reset informado, porque continuar chamando estende o
  ban.
- **Swaps nunca são repetidos às cegas:** quando o resultado de uma compra é incerto (timeout ou erro de
  rede), ela fica pendente e é resolvida pelo saldo real da carteira.
- **Vendas com escalonamento de slippage** (25% → 40% → 60%) e nova tentativa automática.
- **Estado em disco com escrita atômica** e backup (`state.json` + `.bak`), mais um diário append-only
  (`trades.jsonl`). Depois de uma queda, o robô volta gerenciando as posições abertas.
- **Fontes independentes:** se uma rota da GMGN cair, as outras continuam funcionando.
- Paper e live usam diretórios separados (`data/paper`, `data/live`).

## Licença

MIT. Use por sua conta e risco.
