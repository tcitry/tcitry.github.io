import { resolve } from "node:path";

const defaultOutDir = resolve("dist");

export default {
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: process.env.DEMO_OUT_DIR
      ? resolve(process.env.DEMO_OUT_DIR)
      : defaultOutDir
  }
};
