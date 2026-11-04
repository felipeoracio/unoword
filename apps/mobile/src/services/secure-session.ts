import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { secureStorage } from "../core/secure-session";
export const secureSessionStorage = secureStorage(
  {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    remove: (key) => SecureStore.deleteItemAsync(key),
  },
  Crypto.randomUUID,
);
