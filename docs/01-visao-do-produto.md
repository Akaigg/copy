# Visão do produto

## Proposta

O HOT CRYPTO AI é uma plataforma pessoal de Copy Trading para Solana que:

1. **Descobre** carteiras com histórico consistente de bons resultados em memecoins e tokens voláteis.
2. **Avalia** essas carteiras com métricas objetivas e com apoio de inteligência artificial, incluindo o quanto cada uma é de fato *copiável*.
3. **Acompanha** em tempo real as operações das carteiras selecionadas.
4. **Copia** fielmente essas operações, de forma proporcional ao capital alocado.
5. **Mede** a diferença entre o resultado do trader original e o resultado do robô.
6. **Compara** diferentes estratégias de seleção, alocação e rotação de carteiras, em simulação e com capital real.

## Princípios

| Princípio | Significado prático |
|---|---|
| Fidelidade acima de tudo | O robô não opina sobre o trade. Não existem stops, take profits, indicadores ou filtros de entrada adicionados pelo sistema. |
| Estratégia decide *de quem* e *quanto*, nunca *o quê* | Estratégias escolhem quais carteiras estão ativas e como o capital é distribuído. As decisões de compra e venda pertencem sempre ao trader copiado. |
| Mesmo fluxo para simulado e real | A única diferença entre simulação e operação real é o executor final. Tudo o que foi validado em simulação vale para o modo real. |
| Tudo é medido | Cada operação copiada, ignorada ou falha é registrada com o motivo. Toda divergência entre trader e robô é explicável. |
| Segurança técnica, não financeira | O sistema protege contra falhas, duplicidades e operações não autorizadas. Ele não tenta proteger contra o risco de mercado assumido pelo trader. |
| Evolução incremental | Cada fase entrega algo utilizável. Complexidade só entra quando a fase anterior está validada. |

## Glossário do domínio

Estes termos são usados na interface, na documentação e nos nomes do código.

| Termo | Definição |
|---|---|
| **Carteira de origem** | Carteira de um trader que está sendo monitorada ou copiada. |
| **Operação de origem** | Compra, venda ou transferência de token detectada em uma carteira de origem. |
| **Ciclo** | Período entre a primeira compra de um token por uma carteira e o momento em que ela zera a posição. É a unidade de "trade" usada para calcular acertos, perdas e sequências de perdas. |
| **Sessão** | Contexto de execução do robô com capital, estratégia, carteiras e limites próprios. Pode ser *simulada* ou *real*. Várias sessões simuladas podem rodar em paralelo sobre os mesmos eventos. |
| **Estratégia de cópia** | Regra que define quais carteiras estão ativas para novas entradas e como o capital da sessão é distribuído entre elas. |
| **Ordem de cópia** | Intenção do robô de reproduzir uma operação de origem dentro de uma sessão. |
| **Execução** | Resultado de uma ordem: preço obtido, quantidade, taxas e latência. |
| **Posição de cópia** | Quantidade de um token mantida pelo robô em uma sessão, vinculada a uma carteira de origem e a um ciclo dela. |
| **Copiabilidade** | Medida de quanto do resultado de uma carteira sobrevive quando copiada com atraso realista. |

## Regras de fidelidade

Estas regras definem o comportamento central do robô e não dependem da estratégia escolhida.

| Evento na carteira de origem | Ação do robô |
|---|---|
| Primeira compra de um token (abre ciclo) | Compra proporcional, se a carteira estiver ativa para novas entradas na sessão. |
| Compra adicional no mesmo ciclo | Compra proporcional, desde que o robô tenha copiado a entrada desse ciclo. |
| Venda parcial de X% da posição | Venda de X% da posição de cópia correspondente. |
| Venda total | Venda de 100% da posição de cópia correspondente. |
| Venda de token que o robô não possui | Ignorada e registrada. |
| Transferência de tokens para outra carteira | Não gera venda. Registrada como alerta. O tratamento é configurável (ignorar ou espelhar como redução de posição). |
| Duas carteiras compram o mesmo token | Posições de cópia separadas por carteira de origem. Cada parte segue somente sua origem, mesmo que no saldo on-chain o token seja um só. |
| Estratégia desativa uma carteira | Novas entradas dessa carteira deixam de ser copiadas. Ciclos já abertos continuam espelhando compras adicionais e vendas até o fechamento. Nenhuma posição fica órfã. |

### Prioridade das vendas

Vendas têm prioridade absoluta sobre compras. Uma venda que falha é retentada conforme política configurável e nunca é abandonada silenciosamente, porque uma venda perdida deixa o robô exposto a um risco que o trader original já não tem.

### Dimensionamento das compras

O dimensionamento traduz o tamanho da operação do trader para o capital do robô. Ele não altera a decisão, apenas a escala.

| Modo | Cálculo | Quando usar |
|---|---|---|
| Proporcional ao patrimônio (padrão) | `valor da compra do trader × (capital alocado à carteira ÷ patrimônio estimado do trader)` | Maior fidelidade: preserva o peso relativo de cada entrada. |
| Multiplicador fixo | `valor da compra do trader × multiplicador` | Carteiras cujo patrimônio é difícil de estimar. |
| Valor fixo por entrada | valor constante por primeira compra, compras adicionais proporcionais à entrada | Testes iniciais e capital muito pequeno. |

Vendas são sempre percentuais, independentemente do modo de compra.

Quando o capital disponível não é suficiente, ou quando o valor calculado fica abaixo do mínimo técnico configurado (ordens tão pequenas que as taxas da rede dominam o resultado), a ordem não é executada e fica registrada como *não copiada* com o motivo. O sistema não "ajusta" a operação por conta própria.

## Inteligência artificial

A IA atua em três frentes, sem interferir nas decisões de compra e venda:

1. **Descoberta**: encontrar carteiras candidatas a partir de tokens que se valorizaram, compradores iniciais lucrativos e padrões de comportamento recorrentes.
2. **Avaliação**: calcular métricas, identificar padrões (perfil de holding, consistência, dependência de poucos acertos grandes), detectar perfis problemáticos (snipers de mesmo bloco, bots de bundle, carteiras de insiders, wash trading) e estimar a copiabilidade.
3. **Análise e comparação**: gerar relatórios explicativos sobre carteiras, sessões e estratégias, e sugerir quais carteiras acompanhar.

A pontuação central é estatística e reproduzível. Modelos de linguagem complementam com interpretação, resumo e comparação, sempre com base nos dados calculados pelo sistema.

## Limitações conhecidas

Estas limitações são inerentes ao Copy Trading em memecoins e devem orientar a escolha de carteiras e a leitura dos resultados.

- **Latência**: o robô sempre opera depois do trader. Em tokens que se movem dezenas de por cento em segundos, isso muda o preço de entrada e de saída. O objetivo é minimizar e medir essa diferença, não eliminá-la.
- **Snipers não são copiáveis**: carteiras cujo lucro vem de comprar no mesmo bloco do lançamento perdem a vantagem quando copiadas. A métrica de copiabilidade existe para identificá-las.
- **Liquidez**: em tokens com pouca liquidez, a compra do próprio trader move o preço e a do robô move de novo.
- **Carteiras que exploram copiadores**: traders conhecidos podem vender contra quem os copia. A diversificação entre carteiras e o acompanhamento da fidelidade ajudam a detectar esse comportamento.
- **Taxas**: priority fees e gorjetas de execução têm peso relevante em ordens pequenas.
- **Carteiras múltiplas do mesmo trader**: um trader pode comprar em uma carteira e vender em outra. O sistema registra transferências para tornar esse comportamento visível.
