function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g,"+").replace(/_/g,"/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4,"="));
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

async function importHmac(secret: string) {
  return crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{ name:"HMAC",hash:"SHA-256" },false,["sign","verify"]);
}

export async function signState(payload: Record<string,unknown>, secret: string): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC",await importHmac(secret),new TextEncoder().encode(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyState<T>(value: string, secret: string): Promise<T | null> {
  const [body,signature] = value.split(".");
  if (!body || !signature) return null;
  const valid = await crypto.subtle.verify("HMAC",await importHmac(secret),base64UrlToBytes(signature),new TextEncoder().encode(body));
  if (!valid) return null;
  try { return JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as T; } catch { return null; }
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const keyBytes = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw",keyBytes,{ name:"AES-GCM" },false,["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name:"AES-GCM",iv },key,new TextEncoder().encode(JSON.stringify(value)));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(encrypted))}`;
}
