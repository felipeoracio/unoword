import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
import { seal, unseal } from "../core/encryption";
import type { Store } from "../core/types";
export async function accountStore(owner: string): Promise<Store> {
  const name = "uno.mobile.key." + owner;
  let encoded = await SecureStore.getItemAsync(name);
  if (!encoded) {
    encoded = bytesToHex(Crypto.getRandomBytes(32));
    await SecureStore.setItemAsync(name, encoded, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  const key = hexToBytes(encoded),
    prefix = "uno.mobile.v1:" + owner + ":";
  return {
    async get<T>(id: string) {
      const raw = await AsyncStorage.getItem(prefix + id);
      return raw ? unseal<T>(raw, key, prefix + id) : null;
    },
    async set(id: string, value: unknown) {
      await AsyncStorage.setItem(
        prefix + id,
        seal(value, key, Crypto.getRandomBytes(24), prefix + id),
      );
    },
    async remove(id: string) {
      await AsyncStorage.removeItem(prefix + id);
    },
  };
}
