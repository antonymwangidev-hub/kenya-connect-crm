/**
 * Application-level encryption for provider credentials stored in the database.
 *
 * Values are stored as `enc:v1:<base64(iv|ciphertext)>` using AES-256-GCM with a
 * key derived (SHA-256) from the TOKEN_ENCRYPTION_KEY secret. Reads decrypt
 * transparently and legacy plaintext values pass through unchanged, so existing
 * rows keep working until they are next written.
 */

const PREFIX = "enc:v1:";

let keyPromise: Promise<CryptoKey> | null = null;

function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    const secret = process.env["TOKEN_ENCRYPTION_KEY"];
    if (!secret) {
      keyPromise = Promise.reject(new Error("TOKEN_ENCRYPTION_KEY is not configured"));
    } else {
      keyPromise = (async () => {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
        return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
      })();
    }
  }
  return keyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** Encrypt a secret for storage. Already-encrypted or empty values pass through. */
export async function encryptSecret(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (isEncrypted(value)) return value;
  try {
    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value)),
    );
    const packed = new Uint8Array(iv.length + ct.length);
    packed.set(iv, 0);
    packed.set(ct, iv.length);
    return PREFIX + toBase64(packed);
  } catch (e) {
    console.error("encryptSecret failed", e instanceof Error ? e.message : e);
    // Never silently drop a credential the user just saved.
    throw new Error("Unable to securely store credential");
  }
}

/** Decrypt a stored secret. Legacy plaintext values are returned unchanged. */
export async function decryptSecret(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (!isEncrypted(value)) return value;
  try {
    const key = await getKey();
    const packed = fromBase64(value.slice(PREFIX.length));
    const iv = packed.slice(0, 12);
    const ct = packed.slice(12);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch (e) {
    console.error("decryptSecret failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Encrypt selected keys of a credentials object. */
export async function encryptFields(
  obj: Record<string, string>,
  fields: string[],
): Promise<Record<string, string>> {
  const out = { ...obj };
  for (const f of fields) {
    const v = out[f];
    if (typeof v === "string" && v.length > 0 && !isEncrypted(v)) {
      const enc = await encryptSecret(v);
      if (enc) out[f] = enc;
    }
  }
  return out;
}
