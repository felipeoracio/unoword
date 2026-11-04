import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "UnoWord",
  slug: "unoword",
  version: "0.1.0",
  scheme: "unoword",
  orientation: "default",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.felipeoracio.unoword",
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-notifications",
    [
      "expo-splash-screen",
      {
        image: "./assets/icon.png",
        imageWidth: 110,
        backgroundColor: "#EFF6FF",
      },
    ],
  ],
  experiments: { typedRoutes: true },
};
export default config;
