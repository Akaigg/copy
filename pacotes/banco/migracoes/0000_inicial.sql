CREATE TABLE "carteiras" (
	"endereco" text PRIMARY KEY NOT NULL,
	"apelido" text,
	"status" text DEFAULT 'monitorada' NOT NULL,
	"origem" text DEFAULT 'manual' NOT NULL,
	"etiquetas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observacoes" text,
	"ultima_assinatura" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carteiras_da_sessao" (
	"sessao_id" text NOT NULL,
	"endereco" text NOT NULL,
	"fracao_do_capital" double precision NOT NULL,
	"ordem" integer NOT NULL,
	CONSTRAINT "carteiras_da_sessao_sessao_id_endereco_pk" PRIMARY KEY("sessao_id","endereco")
);
--> statement-breakpoint
CREATE TABLE "ciclos_origem" (
	"id" text PRIMARY KEY NOT NULL,
	"carteira" text NOT NULL,
	"token" text NOT NULL,
	"status" text NOT NULL,
	"aberto_em" timestamp with time zone NOT NULL,
	"encerrado_em" timestamp with time zone,
	"quantidade" double precision NOT NULL,
	"custo_base_sol" double precision NOT NULL,
	"investido_sol" double precision NOT NULL,
	"retornado_sol" double precision NOT NULL,
	"resultado_realizado_sol" double precision NOT NULL,
	"quantidade_de_compras" integer NOT NULL,
	"quantidade_de_vendas" integer NOT NULL,
	"teve_transferencias" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisoes_estrategia" (
	"id" serial PRIMARY KEY NOT NULL,
	"sessao_id" text NOT NULL,
	"momento" timestamp with time zone NOT NULL,
	"carteiras_ativas" jsonb NOT NULL,
	"motivo" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos_auditoria" (
	"id" serial PRIMARY KEY NOT NULL,
	"momento" timestamp with time zone DEFAULT now() NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"dados" jsonb
);
--> statement-breakpoint
CREATE TABLE "operacoes_origem" (
	"id" text PRIMARY KEY NOT NULL,
	"assinatura" text NOT NULL,
	"carteira" text NOT NULL,
	"token" text NOT NULL,
	"tipo" text NOT NULL,
	"quantidade_token" double precision NOT NULL,
	"decimais" integer NOT NULL,
	"valor_sol" double precision NOT NULL,
	"preco_sol" double precision,
	"saldo_token_antes" double precision NOT NULL,
	"saldo_token_depois" double precision NOT NULL,
	"saldo_sol_antes" double precision NOT NULL,
	"plataforma" text,
	"slot" bigint NOT NULL,
	"horario_do_bloco" timestamp with time zone NOT NULL,
	"horario_de_deteccao" timestamp with time zone NOT NULL,
	"ciclo_id" text,
	"efeito_no_ciclo" text NOT NULL,
	"historica" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ordens_copia" (
	"id" text PRIMARY KEY NOT NULL,
	"sessao_id" text NOT NULL,
	"operacao_de_origem_id" text NOT NULL,
	"carteira" text NOT NULL,
	"token" text NOT NULL,
	"lado" text NOT NULL,
	"tipo" text NOT NULL,
	"status" text NOT NULL,
	"motivo" text,
	"posicao_id" text,
	"valor_alvo_sol" double precision,
	"fracao_alvo" double precision,
	"preco_do_trader_sol" double precision,
	"horario_do_bloco_de_origem" timestamp with time zone NOT NULL,
	"criada_em" timestamp with time zone NOT NULL,
	"tentativas" integer NOT NULL,
	"quantidade_executada" double precision,
	"valor_executado_sol" double precision,
	"preco_executado_sol" double precision,
	"taxas_sol" double precision,
	"assinatura" text,
	"fonte_do_preco" text,
	"executada_em" timestamp with time zone,
	"latencia_ms" double precision,
	"desvio_de_preco" double precision
);
--> statement-breakpoint
CREATE TABLE "posicoes_copia" (
	"id" text PRIMARY KEY NOT NULL,
	"sessao_id" text NOT NULL,
	"carteira" text NOT NULL,
	"token" text NOT NULL,
	"decimais" integer NOT NULL,
	"ciclo_de_origem_id" text NOT NULL,
	"status" text NOT NULL,
	"quantidade" double precision NOT NULL,
	"custo_base_sol" double precision NOT NULL,
	"investido_sol" double precision NOT NULL,
	"retornado_sol" double precision NOT NULL,
	"resultado_realizado_sol" double precision NOT NULL,
	"taxas_sol" double precision NOT NULL,
	"valor_entrada_trader_sol" double precision NOT NULL,
	"valor_entrada_robo_sol" double precision NOT NULL,
	"aberta_em" timestamp with time zone NOT NULL,
	"encerrada_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessoes" (
	"id" text PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"modo" text NOT NULL,
	"status" text NOT NULL,
	"capital_inicial_sol" double precision NOT NULL,
	"caixa_sol" double precision NOT NULL,
	"estrategia_identificador" text NOT NULL,
	"estrategia_configuracao" jsonb NOT NULL,
	"estrategia_estado" jsonb,
	"carteiras_ativas" jsonb NOT NULL,
	"dimensionamento" jsonb NOT NULL,
	"limites" jsonb NOT NULL,
	"regras" jsonb NOT NULL,
	"criada_em" timestamp with time zone NOT NULL,
	"iniciada_em" timestamp with time zone,
	"encerrada_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"mint" text PRIMARY KEY NOT NULL,
	"simbolo" text,
	"nome" text,
	"icone" text,
	"decimais" integer NOT NULL,
	"primeira_vez_visto_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ciclos_origem_carteira" ON "ciclos_origem" USING btree ("carteira","encerrado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "ciclos_origem_aberto_unico" ON "ciclos_origem" USING btree ("carteira","token") WHERE status = 'aberto';--> statement-breakpoint
CREATE INDEX "decisoes_estrategia_sessao" ON "decisoes_estrategia" USING btree ("sessao_id","momento");--> statement-breakpoint
CREATE INDEX "operacoes_origem_carteira_horario" ON "operacoes_origem" USING btree ("carteira","horario_do_bloco");--> statement-breakpoint
CREATE INDEX "operacoes_origem_horario" ON "operacoes_origem" USING btree ("horario_do_bloco");--> statement-breakpoint
CREATE INDEX "operacoes_origem_ciclo" ON "operacoes_origem" USING btree ("ciclo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ordens_copia_idempotencia" ON "ordens_copia" USING btree ("sessao_id","operacao_de_origem_id");--> statement-breakpoint
CREATE INDEX "ordens_copia_sessao" ON "ordens_copia" USING btree ("sessao_id","criada_em");--> statement-breakpoint
CREATE INDEX "posicoes_copia_sessao" ON "posicoes_copia" USING btree ("sessao_id","status");