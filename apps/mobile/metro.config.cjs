const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const config = getDefaultConfig(__dirname);
// Reuse the existing pure tracking/prompt engines without moving the web app.
config.watchFolders = [path.resolve(__dirname, "../..")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
