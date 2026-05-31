const config = {
  app: {
    name: "The Loading Dock(r)",
    identifier: "com.stevenazevedodesign.loadingdock",
    version: "1.2.0",
    icon: "./App_Icon.png",
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
    },
  },
} as const;

export default config;
