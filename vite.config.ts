import { defineConfig } from "vite";

// Relative asset paths, so the built site works from a sub-folder such as
// https://aascalon.github.io/ttc-quiz/ (GitHub Pages project sites).
export default defineConfig({
  base: "./",
  // MapLibre's tile worker is an ES module, so build it as one.
  worker: { format: "es" },
  build: {
    // MapLibre (the line quizzes' street map) is ~1 MB on its own; it loads only when needed.
    chunkSizeWarningLimit: 1100,
  },
});
