const config = {
  app: {
    name: "Container Cove",
    identifier: "com.stevenazevedodesign.containercove",
    version: "1.2.0",
    icon: "./App_Icon.png",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  build: {
    mac: {
      icons: "./assets/icons/App_Icon.iconset",
    },
    bun: {
      entrypoint: "./src/main/index.ts",
    },
    views: {
      launcher: {
        entrypoint: "./src/renderer/launcher/index.html",
      },
      "app-window": {
        entrypoint: "./src/renderer/app-window/index.html",
      },
      "setup-wizard": {
        entrypoint: "./src/renderer/setup-wizard/index.html",
      },
    },
  },
} as const;

export default config;
