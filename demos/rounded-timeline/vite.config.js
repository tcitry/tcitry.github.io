import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

const defaultOutDir = resolve("dist");

export default {
  plugins: [tailwindcss()],
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: process.env.DEMO_OUT_DIR
      ? resolve(process.env.DEMO_OUT_DIR)
      : defaultOutDir
  }
};
