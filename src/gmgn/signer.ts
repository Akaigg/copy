import * as crypto from "node:crypto";

/**
 * Assinatura das rotas "críticas" (swap, ordens, saldo) da OpenAPI da GMGN.
 * Formato da mensagem: {sub_path}:{query_ordenada}:{body}:{timestamp}
 * Ed25519 assina os bytes crus; RSA usa PSS + SHA256 com salt de 32 bytes.
 */
export type SignAlgorithm = "Ed25519" | "RSA-SHA256";

export function detectAlgorithm(pem: string): SignAlgorithm {
  const key = crypto.createPrivateKey(pem);
  switch (key.asymmetricKeyType) {
    case "ed25519":
      return "Ed25519";
    case "rsa":
      return "RSA-SHA256";
    default:
      throw new Error(`Tipo de chave não suportado: ${key.asymmetricKeyType} (use Ed25519 ou RSA)`);
  }
}

export type QueryValue = string | number | boolean | Array<string | number>;

export function buildAuthQuery() {
  return { timestamp: Math.floor(Date.now() / 1000), client_id: crypto.randomUUID() };
}

export function buildMessage(subPath: string, query: Record<string, QueryValue>, body: string, timestamp: number): string {
  const sorted = Object.keys(query)
    .sort()
    .flatMap((k) => {
      const ek = encodeURIComponent(k);
      const v = query[k]!;
      if (Array.isArray(v)) return [...v].map(String).sort().map((item) => `${ek}=${encodeURIComponent(item)}`);
      return [`${ek}=${encodeURIComponent(String(v))}`];
    })
    .join("&");
  return `${subPath}:${sorted}:${body}:${timestamp}`;
}

export function sign(message: string, pem: string, algorithm: SignAlgorithm): string {
  const buf = Buffer.from(message, "utf8");
  if (algorithm === "Ed25519") return crypto.sign(null, buf, pem).toString("base64");
  return crypto
    .sign("sha256", buf, { key: pem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 })
    .toString("base64");
}

export function buildUrl(base: string, query: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const item of v) params.append(k, String(item));
    else params.set(k, String(v));
  }
  return `${base}?${params.toString()}`;
}
