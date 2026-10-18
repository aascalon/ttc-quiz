import { defineConfig } from "vite";

// Relative asset paths, so the built site works from a sub-folder such as
// https://aascalon.github.io/ttc-quiz/ (GitHub Pages project sites).
export default defineConfig({
  base: "./",
});
