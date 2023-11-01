import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: "isolation",
      configureServer(server) {
        // The multithreads version of @antv/layout-wasm needs to use SharedArrayBuffer, which should be used in a secure context.
        // @see https://gist.github.com/mizchi/afcc5cf233c9e6943720fde4b4579a2b
        server.middlewares.use((_req, res, next) => {
          res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
          next();
        });
      },
    },
  ],
});
