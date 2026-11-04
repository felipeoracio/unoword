import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
type Keychain = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};
/** Commit a chunk generation only after every bounded Keychain write succeeds. */
export function secureStorage(keychain: Keychain, uuid: () => string) {
  const CHUNK = 1500;
  return {
    async getItem(key: string) {
      const raw = await keychain.get(key);
      if (!raw) return null;
      const meta = JSON.parse(raw) as {
        generation: string;
        count: number;
        encoding?: string;
      };
      if (!Number.isInteger(meta.count) || meta.count < 1 || meta.count > 64)
        throw new Error("Invalid secure session");
      const parts = await Promise.all(
        Array.from({ length: meta.count }, (_, i) =>
          keychain.get(`${key}.${meta.generation}.${i}`),
        ),
      );
      if (parts.some((part) => part === null))
        throw new Error("Secure session is incomplete. Sign in again.");
      const joined = parts.join("");
      return meta.encoding === "hex-v1"
        ? new TextDecoder().decode(hexToBytes(joined))
        : joined;
    },
    async setItem(key: string, value: string) {
      // Hex keeps each item bounded in bytes, including Unicode user metadata.
      value = bytesToHex(new TextEncoder().encode(value));
      const old = await keychain.get(key),
        generation = uuid(),
        count = Math.ceil(value.length / CHUNK);
      if (count < 1 || count > 64) throw new Error("Secure session too large");
      for (let i = 0; i < count; i++)
        await keychain.set(
          `${key}.${generation}.${i}`,
          value.slice(i * CHUNK, (i + 1) * CHUNK),
        );
      await keychain.set(
        key,
        JSON.stringify({ generation, count, encoding: "hex-v1" }),
      );
      if (old) {
        const meta = JSON.parse(old);
        for (let i = 0; i < meta.count; i++)
          await keychain.remove(`${key}.${meta.generation}.${i}`);
      }
    },
    async removeItem(key: string) {
      const raw = await keychain.get(key);
      await keychain.remove(key);
      if (raw) {
        const meta = JSON.parse(raw);
        for (let i = 0; i < meta.count; i++)
          await keychain.remove(`${key}.${meta.generation}.${i}`);
      }
    },
  };
}
