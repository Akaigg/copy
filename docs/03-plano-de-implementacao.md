# Plano de implementação

O desenvolvimento é dividido em fases. Cada fase entrega algo utilizável e valida a base da fase seguinte. A **primeira versão funcional (MVP)** corresponde às Fases 0, 1 e 2: monitorar carteiras reais e copiá-las em simulação com resultados mensuráveis.

```
Fase 0  Fundação
Fase 1  Observação em tempo real          ┐
Fase 2  Cópia simulada                    ┘ MVP
Fase 3  Estratégias e comparação
Fase 4  Descoberta e inteligência artificial
Fase 5  Operação real
Fase 6  Evolução contínua
```

## Situação

| Fase | Situação |
|---|---|
| 0 — Fundação | Concluída |
| 1 — Observação em tempo real | Concluída |
| 2 — Cópia simulada | Concluída |
| 3 — Estratégias e comparação | Concluída, exceto o replay histórico |
| 4 — Descoberta e IA | Próxima etapa |
| 5 — Operação real | Planejada |

---

## Fase 0 — Fundação

**Objetivo:** estrutura do projeto pronta para receber código com qualidade desde o início.

- Monorepo com pnpm, TypeScript estrito, Biome e Vitest.
- Pacotes `dominio`, `banco`, `solana`, `estrategias`, `compartilhado` e apps `motor` e `painel` criados vazios.
- Docker Compose com PostgreSQL.
- Carregamento e validação de configuração por variáveis de ambiente.
- Logs estruturados.
- Esquema inicial do banco e sistema de migrações.
- Integração contínua executando lint, tipos e testes a cada push.

**Concluída quando:** `pnpm install`, `pnpm verificar` e `pnpm testar` rodam sem erros, e o motor sobe conectado ao banco.

---

## Fase 1 — Observação em tempo real

**Objetivo:** ver, ao vivo e com histórico, tudo o que as carteiras escolhidas fazem.

**Motor**

- Cadastro manual de carteiras de origem (endereço e apelido).
- Monitor em tempo real via WebSocket do provedor, com reconexão e recuperação de lacunas.
- Decodificador por variação de saldos: compras, vendas e transferências.
- Livro de origem: posições, ciclos, preço médio, resultado por ciclo e fração de cada venda.
- Medição de latência de detecção.
- API REST e canal WebSocket para eventos ao vivo.

**Painel**

- Lista de carteiras com resultado, número de ciclos e taxa de acerto.
- Detalhe da carteira: posições abertas, ciclos encerrados, operações.
- Feed de operações em tempo real de todas as carteiras.

**Testes**

- Decodificador testado com transações reais gravadas como fixtures (Pump.fun, PumpSwap, Raydium, Jupiter, Meteora, transferências, transações com falha).

**Concluída quando:** ao monitorar algumas carteiras ativas por alguns dias, todas as operações aparecem corretamente, os ciclos fecham com resultado coerente com exploradores como Solscan, e a latência de detecção é exibida.

---

## Fase 2 — Cópia simulada (fecha o MVP)

**Objetivo:** o robô copia carteiras em simulação, com preços realistas, e mostra a diferença entre o trader e o robô.

**Domínio**

- Regras de fidelidade: entrada, compra adicional, venda parcial, venda total, vendas sem posição, posições separadas por carteira de origem.
- Modos de dimensionamento: proporcional ao patrimônio, multiplicador fixo e valor fixo.
- Guardas de segurança básicas e chave de idempotência.

**Motor**

- Sessões simuladas com capital inicial, carteiras selecionadas e fração de capital por carteira.
- Estratégia **Tradicional** (todas as carteiras selecionadas ativas).
- Executor simulado com cotação real da Jupiter, modelo de latência e taxas estimadas.
- Livro de cópia com resultados e métricas de fidelidade.
- Várias sessões simuladas rodando em paralelo.

**Painel**

- Criação e controle de sessões (iniciar, pausar, encerrar).
- Visão geral da sessão: patrimônio, resultado, posições abertas, histórico.
- Desempenho individual por carteira dentro da sessão.
- Comparação trader × robô por operação e por ciclo: preço, latência, desvio e resultado.
- Lista de ordens não copiadas com os motivos.

**Testes**

- Cobertura completa das regras de fidelidade e dimensionamento com cenários: entradas múltiplas, vendas parciais sucessivas, duas carteiras no mesmo token, capital insuficiente, evento duplicado, reinício no meio de um ciclo.

**Concluída quando:** uma sessão simulada roda por dias seguidos sem intervenção, nenhuma operação é duplicada ou perdida, e o painel permite entender, para cada carteira, quanto do resultado original o robô capturou e por quê.

---

## Fase 3 — Estratégias e comparação

**Objetivo:** arquitetura de estratégias plugáveis e comparação objetiva entre elas.

- Contrato `EstrategiaDeCopia` e registro de estratégias.
- Estratégia **Rotação por perdas consecutivas**.
- Estratégia **Rotação dinâmica por desempenho**.
- Registro de decisões das estratégias com motivo, visível na linha do tempo da sessão.
- Formulário de configuração gerado a partir do esquema de cada estratégia.
- Tela de comparação de sessões: curva de patrimônio, resultado, maior queda, taxa de acerto, fidelidade.
- Replay histórico: executar sessões sobre operações já registradas para comparar estratégias em períodos passados.

**Concluída quando:** é possível criar uma estratégia nova apenas adicionando um arquivo, e comparar três sessões com estratégias diferentes, ao vivo e em replay, na mesma tela.

---

## Fase 4 — Descoberta e inteligência artificial

**Objetivo:** encontrar e classificar boas carteiras de forma sistemática.

- Coleta de candidatas a partir de tokens valorizados e seus compradores iniciais lucrativos.
- Importação do histórico de operações das candidatas, reaproveitando o decodificador.
- Cálculo de métricas por carteira e pontuação composta configurável.
- Métrica de copiabilidade com reprocessamento do histórico sob atraso.
- Sinais de alerta: snipers de mesmo bloco, bundles, carteiras relacionadas.
- Relatórios gerados por IA para carteiras, comparação entre candidatas e análise de sessões e estratégias.
- Funil no painel: candidatas → monitoradas → copiadas, com promoção em um clique.

**Concluída quando:** o sistema sugere periodicamente um ranking de carteiras com justificativa, e carteiras promovidas a partir dele podem ser acompanhadas em simulação para validar a sugestão.

---

## Fase 5 — Operação real

**Objetivo:** executar com capital real, com proteções técnicas completas.

- Carteira operacional dedicada e gestão segura da chave.
- Executor real: cotação e transação Jupiter, simulação prévia, validação de programas permitidos, priority fee e acompanhamento de confirmação.
- Política de retentativa com prioridade para vendas.
- Limites por sessão, disjuntor e parada de emergência.
- Reconciliação periódica com saldos on-chain.
- Autenticação no painel e auditoria de ações.
- Alertas via Telegram.
- Calibração do executor simulado com as latências e desvios observados nas execuções reais.

**Implantação recomendada:** começar com capital mínimo, mantendo uma sessão simulada idêntica em paralelo. A diferença entre as duas mede a precisão da simulação.

**Concluída quando:** uma sessão real opera continuamente, as posições registradas batem com os saldos on-chain, e todas as proteções foram testadas de forma deliberada (falha de RPC, venda falha, limite atingido, parada de emergência).

---

## Fase 6 — Evolução contínua

Itens a priorizar conforme os resultados observados:

- Redução de latência: gRPC (LaserStream ou Yellowstone), RPC dedicado, servidor próximo ao provedor, envio via Jito, transações pré-montadas.
- Adaptadores de execução diretos para launchpads não cobertos pela Jupiter.
- Modelos de machine learning para pontuação de carteiras treinados com o histórico acumulado.
- Detecção automática de carteiras que passaram a se comportar diferente do histórico.
- Notificações e controle básico pelo Telegram.
- Suporte a outras redes (Base, BNB Chain) reaproveitando o domínio e trocando os adaptadores.

---

## Decisões a confirmar antes de iniciar

| Decisão | Recomendação |
|---|---|
| Linguagem | TypeScript em todo o projeto |
| Provedor de dados Solana | Helius (plano gratuito para as Fases 0–1, plano pago quando a latência passar a importar) |
| Moeda base de capital e resultados | SOL, com valores equivalentes em USD exibidos no painel |
| Hospedagem | Local nas Fases 0–4, servidor dedicado na Fase 5 |
| Usuários | Uso individual, sem multiusuário na primeira versão |
| Carteiras iniciais | Lista manual de 5 a 10 carteiras para validar as Fases 1 e 2 antes da descoberta automática |
