import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export function seal(
  value: unknown,
  key: Uint8Array,
  nonce: Uint8Array,
  context: string,
) {
  return JSON.stringify({
    v: 1,
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(
      xchacha20poly1305(key, nonce, encoder.encode(context)).encrypt(
        encoder.encode(JSON.stringify(value)),
      ),
    ),
  });
}
export function unseal<T>(value: string, key: Uint8Array, context: string): T {
  const packet = JSON.parse(value);
  if (packet.v !== 1) throw new Error("Unknown private cache version");
  return JSON.parse(
    decoder.decode(
      xchacha20poly1305(
        key,
        hexToBytes(packet.nonce),
        encoder.encode(context),
      ).decrypt(hexToBytes(packet.ciphertext)),
    ),
  ) as T;
}
