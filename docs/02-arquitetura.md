# Arquitetura

## Visão geral do fluxo

```
                    ┌──────────────────────────┐
                    │  Provedor Solana         │
                    │  (WebSocket / gRPC)      │
                    └────────────┬─────────────┘
                                 │ transações das carteiras monitoradas
                                 ▼
┌──────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ Monitor de       │──▶│ Decodificador de     │──▶│ Livro de origem      │
│ carteiras        │   │ operações            │   │ (posições e ciclos   │
└──────────────────┘   └──────────────────────┘   │  dos traders)        │
                                                  └──────────┬───────────┘
                                                             │ OperacaoDetectada
                                                             ▼
                          ┌──────────────────────────────────────────────┐
                          │ Motor de cópia (uma instância lógica por     │
                          │ sessão ativa)                                │
                          │  1. Estratégia: a carteira está ativa?       │
                          │  2. Dimensionamento: quanto comprar/vender?  │
                          │  3. Guardas de segurança: está autorizado?   │
                          └──────────────────────┬───────────────────────┘
                                                 │ OrdemDeCopia
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │ Executor                                     │
                          │  ├─ Simulado: cotação real + latência medida │
                          │  └─ Real: transação assinada e enviada       │
                          └──────────────────────┬───────────────────────┘
                                                 │ ExecucaoRealizada
                                                 ▼
                          ┌──────────────────────────────────────────────┐
                          │ Livro de cópia (posições, resultados,        │
                          │ métricas de fidelidade)                      │
                          └──────────────────────┬───────────────────────┘
                                                 │
                       ┌─────────────────────────┴───────────────┐
                       ▼                                         ▼
               ┌───────────────┐                        ┌────────────────┐
               │ API + eventos │◀──────────────────────▶│ Painel web     │
               │ em tempo real │                        │                │
               └───────────────┘                        └────────────────┘

  Em paralelo e fora do caminho crítico:
  Descoberta e análise (coleta histórica, métricas, pontuação, IA)
```

O caminho crítico (monitor → decodificador → motor → executor) é curto, sem dependência de IA ou de consultas pesadas, para minimizar latência.

## Stack recomendada

| Camada | Tecnologia | Motivo |
|---|---|---|
| Linguagem | TypeScript em todo o projeto | O ecossistema Solana mais maduro (SDKs, Jupiter, provedores RPC) é TypeScript. Uma linguagem só reduz custo de manutenção e permite compartilhar tipos entre motor, API e painel. |
| Runtime | Node.js LTS | Bom desempenho em I/O de rede, que é o gargalo do robô. |
| Monorepo | pnpm workspaces | Pacotes separados por responsabilidade, sem complexidade de ferramentas extras. |
| API | Fastify + WebSocket | Leve, rápido, com validação de esquemas. |
| Validação | Zod | Configurações de sessões e estratégias validadas em tempo de execução e tipadas. |
| Banco de dados | PostgreSQL | Confiável, transacional, ótimo para consultas analíticas. Extensão TimescaleDB pode ser adicionada depois para séries temporais. |
| Acesso a dados | Drizzle ORM | Esquema tipado em TypeScript e migrações versionadas. |
| Solana | `@solana/kit` | SDK oficial atual. |
| Dados em tempo real | Helius (WebSocket na fase inicial, gRPC/LaserStream quando a latência passar a ser o foco) | Assinatura por carteira, transações completas com saldos antes e depois. |
| Execução de swaps | Jupiter Swap API | Roteamento único para Raydium, Pump.fun, PumpSwap, Meteora, Orca e outros. Adaptadores diretos podem ser adicionados para plataformas não suportadas. |
| Envio de transações | Priority fees na fase inicial, Jito depois | Melhora a taxa e a velocidade de inclusão das transações. |
| IA | Claude API | Análise, relatórios e comparação a partir de dados estruturados pelo sistema. |
| Painel | React + Vite + Tailwind + shadcn/ui + TanStack Query | Interface moderna, componentes prontos e acessíveis, atualização em tempo real. |
| Gráficos | Lightweight Charts e Recharts | Gráficos de preço e de desempenho. |
| Testes | Vitest | Rápido e integrado ao TypeScript. |
| Logs | Pino | Logs estruturados, essenciais para auditar o robô. |
| Infraestrutura | Docker Compose | Ambiente local idêntico ao servidor. Na operação real, servidor próximo ao provedor RPC. |

Python pode ser introduzido mais tarde como serviço isolado se modelos de machine learning mais pesados forem necessários. Não é necessário para a primeira versão.

## Estrutura de pastas

```
hot-crypto-ai/
├── apps/
│   ├── motor/                  Processo principal: monitor, motor de cópia, executores, API
│   └── painel/                 Interface web
├── pacotes/
│   ├── dominio/                Entidades, regras de fidelidade, dimensionamento, cálculos de resultado
│   ├── estrategias/            Estratégias de cópia (uma por arquivo) e registro de estratégias
│   ├── solana/                 Monitor, decodificador de operações, cotação e envio de transações
│   ├── banco/                  Esquema, migrações e repositórios
│   ├── analise/                Descoberta de carteiras, métricas, pontuação e IA
│   └── compartilhado/          Tipos e contratos usados por motor e painel
├── docs/
├── docker-compose.yml
└── package.json
```

Regras de dependência:

- `dominio` não depende de nenhum outro pacote nem de bibliotecas de infraestrutura. Contém a lógica mais importante do sistema e é inteiramente testável sem rede ou banco.
- `estrategias` depende apenas de `dominio`.
- `solana`, `banco` e `analise` implementam contratos definidos em `dominio`.
- `apps/motor` conecta tudo. `apps/painel` conversa com o motor apenas via API e WebSocket.

## Módulos

### Monitor de carteiras

- Mantém assinaturas em tempo real para todas as carteiras de origem com status *monitorada* ou *copiada*.
- Reconecta automaticamente e, após qualquer queda, busca as transações perdidas pelo histórico para não deixar lacunas.
- Registra para cada transação o slot, o horário do bloco e o horário de detecção, base da medição de latência.

### Decodificador de operações

Abordagem principal: **variação de saldos**. Toda transação Solana traz os saldos de tokens e de SOL antes e depois. Uma operação é identificada quando o saldo de um token da carteira muda em sentido oposto ao saldo de SOL, WSOL ou USDC.

Vantagens:

- Funciona para qualquer DEX, agregador ou launchpad, inclusive os que ainda não existem.
- Calcula diretamente o valor pago ou recebido, sem depender do formato interno de cada programa.

Casos tratados:

- Variação de token sem contrapartida: transferência de entrada ou de saída.
- Vários tokens na mesma transação: uma operação por token.
- Transações com falha: descartadas.
- Tokens Token-2022 com taxa de transferência: valor efetivo calculado pelo saldo final.

A identificação da plataforma usada (Pump.fun, Raydium e outras) é obtida pelos programas presentes na transação e serve apenas para informação e estatística.

### Livro de origem

Mantém o estado de cada carteira de origem: posições por token, ciclos abertos e fechados, preço médio e resultado de cada ciclo. É dele que vem o percentual de cada venda (`quantidade vendida ÷ saldo antes da venda`), usado para espelhar vendas parciais.

### Motor de cópia

Para cada `OperacaoDetectada` e para cada sessão ativa:

1. Consulta a decisão atual da estratégia da sessão (carteiras ativas e frações de capital).
2. Aplica as regras de fidelidade (entrada, compra adicional, venda parcial, venda total).
3. Calcula o tamanho da ordem conforme o modo de dimensionamento.
4. Passa a ordem pelas guardas de segurança.
5. Gera a `OrdemDeCopia` com chave de idempotência e envia ao executor da sessão.

Sessões são independentes: uma operação de origem pode gerar ordens em várias sessões simuladas e em uma sessão real ao mesmo tempo. Isso permite comparar estratégias ao vivo, sobre exatamente os mesmos eventos, sem custo.

### Executores

Contrato único para os dois modos:

```ts
export interface Executor {
  readonly modo: 'simulado' | 'real'
  executar(ordem: OrdemDeCopia): Promise<ResultadoDaExecucao>
}
```

**Executor simulado**

- Obtém uma cotação real na Jupiter para o valor da ordem no momento em que a ordem seria enviada.
- Aplica um modelo de latência configurável, calibrado a partir das latências medidas pelo monitor e, depois, pelas execuções reais.
- Desconta taxas estimadas da rede, priority fee e gorjetas.
- Resultado: o preço que o robô teria obtido, não o preço do trader.

**Executor real**

- Obtém cotação e transação da Jupiter com slippage máximo configurado por sessão.
- Simula a transação antes de assinar e valida que apenas programas permitidos são chamados e que apenas a carteira operacional é debitada.
- Assina com a carteira operacional, envia com priority fee e acompanha a confirmação.
- Em falha de venda, aplica a política de retentativa.

### Livro de cópia

Registra posições de cópia por sessão, carteira de origem, token e ciclo. Calcula resultado realizado e não realizado, e as métricas de fidelidade:

| Métrica | Definição |
|---|---|
| Latência de detecção | Horário de detecção − horário do bloco do trader |
| Latência de execução | Horário de confirmação do robô − horário do bloco do trader |
| Desvio de preço | Diferença percentual entre o preço do robô e o preço do trader em cada operação |
| Taxa de cópia | Operações copiadas ÷ operações elegíveis, com motivos das não copiadas |
| Fidelidade de resultado | Resultado percentual do ciclo do robô comparado com o do trader |

### Estratégias de cópia

Estratégias são módulos registrados no sistema. Cada sessão escolhe uma estratégia e fornece sua configuração. A estratégia nunca recebe nem emite ordens de compra e venda: ela recebe o histórico e devolve quais carteiras estão ativas e com que fração do capital.

```ts
export interface EstrategiaDeCopia<Configuracao, Estado = undefined> {
  readonly identificador: string
  readonly nome: string
  readonly descricao: string
  readonly esquemaDeConfiguracao: ZodType<Configuracao>
  estadoInicial(configuracao: Configuracao): Estado
  decidir(contexto: ContextoDaEstrategia<Configuracao, Estado>): DecisaoDaEstrategia<Estado>
}

export interface ContextoDaEstrategia<Configuracao, Estado> {
  configuracao: Configuracao
  estado: Estado
  carteirasDaSessao: CarteiraDaSessao[]
  ciclosEncerrados: CicloEncerrado[]
  momento: Date
}

export interface DecisaoDaEstrategia<Estado> {
  carteirasAtivas: CarteiraAtiva[]
  estado: Estado
  motivo: string
}

export interface CarteiraAtiva {
  endereco: string
  fracaoDoCapital: number
}
```

O motor chama `decidir` quando um ciclo é encerrado, quando a configuração da sessão muda e em intervalos periódicos. Cada decisão é gravada com o motivo, o que permite ver no painel por que uma carteira foi ativada ou pausada.

Estratégias previstas:

| Estratégia | Comportamento |
|---|---|
| Tradicional | Todas as carteiras selecionadas ficam ativas com as frações definidas pelo usuário. |
| Rotação por perdas consecutivas | Fila ordenada de carteiras. A primeira carteira ativa é copiada até atingir N ciclos perdedores seguidos. Então é pausada e a próxima da fila assume. Configurável: N, base de cálculo (resultado do trader ou do robô) e regra de reativação. |
| Rotação dinâmica por desempenho | Periodicamente ordena as carteiras por um critério configurável (resultado em janela móvel, taxa de acerto, fator de lucro) e ativa as K melhores, com distribuição igual ou proporcional ao desempenho. |

Para adicionar uma estratégia nova basta criar um arquivo em `pacotes/estrategias`, implementar o contrato e registrá-la. O painel gera o formulário de configuração a partir do esquema Zod da estratégia.

### Descoberta e análise

Fora do caminho crítico. Responsável por:

- **Coleta**: tokens que se valorizaram em um período, seus compradores iniciais e o histórico de operações dessas carteiras.
- **Métricas por carteira**: resultado realizado, taxa de acerto, fator de lucro, número de ciclos, tempo médio de holding, tamanho médio de entrada, pior sequência de perdas, concentração do lucro em poucos ciclos, atividade recente.
- **Copiabilidade**: reprocessa o histórico da carteira supondo entradas e saídas com atraso de alguns segundos, usando dados de preço do período, e mede quanto do resultado se mantém.
- **Sinais de alerta**: compras no mesmo bloco da criação do token, padrões de bundle, carteiras financiadas pela mesma origem, operações circulares.
- **IA**: o modelo de linguagem recebe as métricas calculadas e produz o relatório da carteira, a comparação entre candidatas e a análise de desempenho de sessões e estratégias.

### Replay histórico

Componente que alimenta o motor de cópia com operações de origem já registradas, em ordem cronológica, usando o executor simulado com preços históricos. Permite comparar estratégias sobre semanas de dados em minutos. Como o motor é o mesmo, o resultado do replay é coerente com a simulação ao vivo.

## Modelo de dados

Tabelas principais (nomes finais definidos na implementação):

| Tabela | Conteúdo |
|---|---|
| `tokens` | Endereço, símbolo, decimais, programa de token, plataforma de lançamento |
| `carteiras` | Endereço, apelido, status (`candidata`, `monitorada`, `copiada`, `descartada`), origem da descoberta, etiquetas |
| `operacoes_origem` | Carteira, token, tipo (`compra`, `venda`, `transferencia_entrada`, `transferencia_saida`), quantidade, valor em SOL, preço, fração da posição, assinatura, slot, horário do bloco, horário de detecção |
| `ciclos_origem` | Carteira, token, abertura, fechamento, investido, retornado, resultado absoluto e percentual |
| `sessoes` | Nome, modo (`simulado`, `real`), capital inicial, estratégia, configuração da estratégia, dimensionamento, limites, status |
| `carteiras_da_sessao` | Carteiras selecionadas para a sessão, ordem na fila e fração de capital configurada |
| `decisoes_estrategia` | Sessão, horário, carteiras ativas, estado da estratégia, motivo |
| `ordens_copia` | Sessão, operação de origem, tipo, valor alvo, status (`pendente`, `executada`, `falhou`, `nao_copiada`, `bloqueada`), motivo, chave de idempotência única |
| `execucoes` | Ordem, assinatura, preço, quantidade, taxas, latências, desvio de preço |
| `posicoes_copia` | Sessão, carteira de origem, token, ciclo de origem, quantidade, custo, resultado realizado |
| `metricas_carteira` | Carteira, data de cálculo, métricas, pontuação, copiabilidade |
| `relatorios_ia` | Assunto (carteira, sessão, comparação), conteúdo, dados de entrada utilizados |
| `eventos_auditoria` | Ações do usuário e eventos críticos do sistema |

## Segurança operacional

Proteções contra falhas técnicas e operações não autorizadas, sem interferir na estratégia dos traders:

**Chaves**

- Carteira operacional dedicada, contendo apenas o capital experimental. Nunca a carteira pessoal principal.
- Chave privada fornecida por variável de ambiente ou arquivo criptografado. Nunca gravada no banco, nunca enviada ao painel, nunca escrita em logs.
- Somente o executor real tem acesso à chave.

**Autorização de transações**

- Toda transação é simulada antes da assinatura.
- Lista de programas permitidos. Transações que chamam programas fora da lista são bloqueadas.
- Verificação de que a transação só movimenta fundos da carteira operacional e só realiza swaps.

**Limites configuráveis por sessão**

- Capital máximo da sessão.
- Valor máximo por ordem.
- Exposição máxima total e por token.
- Número máximo de posições abertas.
- Volume máximo de compras por dia.
- Slippage máximo de execução.

Os limites são técnicos: quando uma compra é bloqueada por limite, isso é registrado como não copiada com o motivo. Vendas nunca são bloqueadas por limites de exposição.

**Integridade**

- Chave de idempotência por `sessão + assinatura da operação de origem + token`: uma mesma operação jamais é copiada duas vezes, mesmo após reinícios ou eventos duplicados.
- Reconciliação periódica entre as posições registradas e os saldos on-chain da carteira operacional, com alerta em caso de divergência.
- Disjuntor: após N falhas técnicas seguidas ou divergência de reconciliação, a sessão real suspende novas compras e alerta o usuário. Vendas continuam.
- Botão de parada de emergência no painel: suspende todas as compras imediatamente e, opcionalmente, liquida todas as posições.

**Acesso**

- Painel e API acessíveis apenas com autenticação, vinculados a `localhost` ou a uma VPN.
- Ativação do modo real exige confirmação explícita e fica registrada em auditoria.

## Observabilidade

- Logs estruturados com identificador de correlação da operação de origem até a execução.
- Painel de saúde: conexão com o provedor, atraso do monitor, fila de ordens, saldo da carteira operacional, falhas recentes.
- Alertas via Telegram para eventos críticos (falha de venda, disjuntor acionado, divergência de reconciliação, queda de conexão).

## Convenções de código

- Identificadores em português brasileiro: variáveis, funções, classes, tipos, tabelas, colunas, rotas da API e textos da interface.
- Exceções inevitáveis: nomes impostos por bibliotecas e frameworks (`useState`, `onClick`, `async`), arquivos de configuração padrão (`package.json`, `tsconfig.json`), palavras-chave da linguagem e termos técnicos sem tradução consagrada (`slot`, `mint`, `swap`).
- Sem comentários no código. Clareza obtida por nomes descritivos, funções pequenas e tipos expressivos.
- Formatação e lint automáticos (Biome) e verificação de tipos estrita.
- Testes automatizados obrigatórios para `dominio` e `estrategias`, que concentram as regras de fidelidade e de capital.
