import { defineConfig } from "vite";

export default defineConfig({
  ssr: {
    noExternal: [
      "clipper2-ts",
      "opentype.js",
      "polygon-clipping",
      "react",
      "robust-predicates",
      "splaytree",
      "three",
      "zustand",
    ],
  },
});
