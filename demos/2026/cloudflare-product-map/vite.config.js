import { resolve } from "node:path";
import react from "@vitejs/plugin-react";

const defaultOutDir = resolve("dist");

export default {
  plugins: [react()],
  base: "./",
  build: {
    emptyOutDir: true,
    outDir: process.env.DEMO_OUT_DIR
      ? resolve(process.env.DEMO_OUT_DIR)
      : defaultOutDir
  }
};
