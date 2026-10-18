# HOT CRYPTO AI

Robô de Copy Trading fiel para criptomoedas de alta volatilidade no ecossistema Solana, com foco em memecoins e tokens recém-lançados.

O sistema acompanha carteiras de traders em tempo real e reproduz fielmente entradas, compras adicionais, vendas parciais e saídas, de forma proporcional ao capital de cada sessão, medindo a diferença entre o resultado do trader e o resultado do robô.

## O que já funciona

| Área | Situação |
|---|---|
| Monitoramento em tempo real de carteiras (WebSocket padrão da Solana ou Helius) com reconexão e recuperação de lacunas | Pronto |
| Decodificação de compras, vendas e transferências por variação de saldos (Pump.fun, PumpSwap, Raydium, Meteora, Jupiter e outros) | Pronto |
| Livro de origem: ciclos, preço médio e resultado de cada trader | Pronto |
| Sessões simuladas com cotação real da Jupiter, latência e taxas | Pronto |
| Regras de fidelidade, três modos de dimensionamento e limites de segurança | Pronto |
| Estratégias plugáveis: tradicional, rotação por perdas consecutivas e rotação dinâmica por desempenho | Pronto |
| Painel web em tempo real: carteiras, operações, sessões, comparação trader × robô e comparação entre sessões | Pronto |
| Importação de histórico de carteiras | Pronto |
| Descoberta de carteiras e análise com IA (Fase 4) | Próxima etapa |
| Operação com capital real (Fase 5) | Planejada; o sistema hoje recusa sessões reais |

## Requisitos

- Node.js 22 ou superior
- pnpm 10 (`corepack enable`)
- Um endpoint RPC da Solana com WebSocket. O público funciona para testes; para uso contínuo recomenda-se Helius ou outro provedor dedicado.

O banco de dados padrão é o PGlite (PostgreSQL embutido, salvo em `apps/motor/dados`). Para usar um PostgreSQL externo, suba o `docker-compose.yml` e defina `BANCO_URL=postgres://hot:hot@127.0.0.1:5432/hot_crypto_ai`.

## Como executar

```bash
pnpm install
cp .env.exemplo .env
pnpm construir
pnpm motor
```

Acesse `http://127.0.0.1:3001`. O motor serve a API, os eventos em tempo real e o painel.

Para desenvolvimento com recarga automática do painel:

```bash
pnpm dev
```

O painel fica em `http://127.0.0.1:5173` e encaminha as chamadas para o motor.

### Primeiros passos

1. Em **Carteiras**, adicione os endereços dos traders que deseja acompanhar. Opcionalmente importe as últimas transações para já ver o histórico de ciclos.
2. Em **Sessões**, crie uma sessão simulada: escolha capital, carteiras, estratégia, dimensionamento e limites.
3. Acompanhe ordens, posições, a comparação **Trader × robô** e as **Decisões da estratégia** em tempo real.
4. Crie sessões com configurações diferentes e compare-as em **Comparar**: todas recebem exatamente os mesmos eventos.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `BANCO_URL` | `pglite://./dados/banco` | `pglite://caminho`, `pglite://memoria` ou URL `postgres://` |
| `HOST` / `PORTA` | `127.0.0.1` / `3001` | Endereço do motor. Mantenha em `127.0.0.1` ou atrás de uma VPN |
| `PAINEL_TOKEN` | vazio | Quando definido, a API e o painel exigem este token |
| `SOLANA_RPC_URL` | RPC público | Endpoint HTTP da Solana |
| `SOLANA_WS_URL` | derivado do RPC | Endpoint WebSocket |
| `FONTE_DE_TRANSACOES` | `logs` | `logs` (qualquer RPC), `helius` (WebSocket avançado da Helius, transações completas sem consulta extra) ou `desativada` |
| `JUPITER_API_URL` / `JUPITER_API_CHAVE` | `https://lite-api.jup.ag` | Cotações, preços e metadados de tokens |
| `EXECUTOR_SIMULADO` | `jupiter` | `jupiter` usa cotação real; `referencia` usa o preço do trader com penalidade |
| `LATENCIA_SIMULADA_MS` | `400` | Atraso adicional antes da cotação simulada |
| `TAXA_ESTIMADA_POR_OPERACAO_SOL` | `0.0001` | Taxa de rede e priority fee estimadas por operação |
| `PENALIDADE_SEM_COTACAO_BPS` | `300` | Penalidade aplicada ao preço do trader quando a Jupiter não cota o token |
| `TENTATIVAS_DE_VENDA` | `5` | Tentativas com espera crescente antes de registrar uma venda como falha |
| `INTERVALO_DE_REAVALIACAO_SEGUNDOS` | `60` | Frequência da reavaliação periódica das estratégias |

## Estrutura

```
apps/
  motor/          Processo principal: monitor, processador, motor de cópia, API e WebSocket
  painel/         Interface web (React, Vite, Tailwind, TanStack Query)
pacotes/
  dominio/        Regras de fidelidade, dimensionamento, limites, posições e métricas (sem dependências de infraestrutura)
  estrategias/    Estratégias de cópia e registro
  solana/         Normalização e decodificação de transações, monitor, Jupiter e executor simulado
  banco/          Esquema Drizzle, migrações e repositórios
  compartilhado/  Esquemas de entrada da API e tipos de resposta usados pelo motor e pelo painel
docs/             Visão do produto, arquitetura e plano de implementação
```

### Como adicionar uma estratégia

1. Crie um arquivo em `pacotes/estrategias/src` que implemente `EstrategiaDeCopia` (esquema Zod de configuração, estado inicial e função `decidir`).
2. Registre-a em `pacotes/estrategias/src/registro.ts`.

O painel gera o formulário de configuração automaticamente a partir do esquema.

## Comandos

| Comando | Descrição |
|---|---|
| `pnpm verificar` | Lint, formatação e verificação de tipos de todos os pacotes |
| `pnpm testar` | Testes de domínio, estratégias, decodificador, banco e ponta a ponta |
| `pnpm formatar` | Corrige formatação e organiza importações |
| `pnpm banco:gerar` | Gera uma nova migração a partir do esquema |
| `pnpm construir` | Gera o build de produção do painel |

## Documentação

1. [Visão do produto](docs/01-visao-do-produto.md)
2. [Arquitetura](docs/02-arquitetura.md)
3. [Plano de implementação](docs/03-plano-de-implementacao.md)

## Aviso

Software experimental. Operar memecoins envolve risco elevado de perda total do capital. A simulação usa cotações no momento da detecção e não garante o mesmo resultado em execução real.
