const CHAVE_DO_TOKEN = 'hot-crypto-token'
export const EVENTO_NAO_AUTORIZADO = 'hot:nao-autorizado'

export function obterToken() {
  try {
    return localStorage.getItem(CHAVE_DO_TOKEN)
  } catch {
    return null
  }
}

export function definirToken(token: string) {
  try {
    localStorage.setItem(CHAVE_DO_TOKEN, token)
  } catch {
    return
  }
}

export class ErroDaApi extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem)
  }
}

export async function requisitar<T>(
  caminho: string,
  opcoes: { metodo?: string; corpo?: unknown } = {},
): Promise<T> {
  const token = obterToken()
  const resposta = await fetch(caminho, {
    method: opcoes.metodo ?? 'GET',
    headers: {
      ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
  })
  if (resposta.status === 401) {
    window.dispatchEvent(new Event(EVENTO_NAO_AUTORIZADO))
    throw new ErroDaApi('Não autorizado. Informe o token de acesso do painel.', 401)
  }
  const dados = (await resposta.json().catch(() => null)) as { erro?: string } | null
  if (!resposta.ok) throw new ErroDaApi(dados?.erro ?? `Erro ${resposta.status}`, resposta.status)
  return dados as T
}
