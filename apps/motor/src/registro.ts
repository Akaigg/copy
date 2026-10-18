import pino from 'pino'

export type Registro = pino.Logger

export function criarRegistro(nivel: string, legivel = process.stdout.isTTY): Registro {
  return pino({
    level: nivel,
    ...(legivel
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  })
}
