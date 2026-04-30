// vite.config.ts
import { defineConfig } from "file:///E:/Study/Projects/MPRAR/node_modules/vite/dist/node/index.js";
import react from "file:///E:/Study/Projects/MPRAR/node_modules/@vitejs/plugin-react/dist/index.mjs";
import tagger from "file:///E:/Study/Projects/MPRAR/node_modules/@dhiwise/component-tagger/dist/index.mjs";
var vite_config_default = defineConfig(({ mode }) => ({
  // Strip console.log/info/debug in production (all chunks); keep console.warn/error
  esbuild: mode === "production" ? { pure: ["console.log", "console.info", "console.debug"] } : void 0,
  build: {
    outDir: "build",
    // Optimize chunk size limits
    chunkSizeWarningLimit: 1e3,
    // Warn if chunk exceeds 1MB
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom") || id.includes("react-router")) {
              return "vendor-react";
            }
            if (id.includes("firebase")) {
              return "vendor-firebase";
            }
            if (id.includes("lucide-react") || id.includes("class-variance-authority") || id.includes("tailwind-merge")) {
              return "vendor-ui";
            }
            if (id.includes("recharts")) {
              return "vendor-charts";
            }
            if (id.includes("leaflet")) {
              return "vendor-maps";
            }
            if (id.includes("jspdf")) {
              return "vendor-pdf";
            }
            if (id.includes("framer-motion")) {
              return "vendor-animation";
            }
            if (id.includes("date-fns")) {
              return "vendor-date";
            }
            return "vendor-other";
          }
        },
        // Optimize chunk file names
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "js/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]"
      }
    },
    // Enable minification
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        // Remove console.log in production
        drop_debugger: true
      }
    },
    // Source maps for production debugging (optional)
    sourcemap: false
  },
  // Only enable component-tagger in production to avoid dev connection attempts that can cause ERR_CONNECTION_REFUSED in console
  plugins: [react(), ...process.env.NODE_ENV === "production" ? [tagger()] : []],
  optimizeDeps: {
    include: ["react-signature-canvas"]
  },
  resolve: {
    alias: {
      "@": "/src",
      "@components": "/src/components",
      "@pages": "/src/pages",
      "@assets": "/src/assets",
      "@constants": "/src/constants",
      "@styles": "/src/styles"
    }
  },
  server: {
    port: 4028,
    host: "0.0.0.0",
    strictPort: false,
    allowedHosts: [".amazonaws.com", ".builtwithrocket.new"]
  }
}));
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxTdHVkeVxcXFxQcm9qZWN0c1xcXFxNUFJBUlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcU3R1ZHlcXFxcUHJvamVjdHNcXFxcTVBSQVJcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L1N0dWR5L1Byb2plY3RzL01QUkFSL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XHJcbmltcG9ydCB0YWdnZXIgZnJvbSBcIkBkaGl3aXNlL2NvbXBvbmVudC10YWdnZXJcIjtcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZygoeyBtb2RlIH0pID0+ICh7XHJcbiAgICAvLyBTdHJpcCBjb25zb2xlLmxvZy9pbmZvL2RlYnVnIGluIHByb2R1Y3Rpb24gKGFsbCBjaHVua3MpOyBrZWVwIGNvbnNvbGUud2Fybi9lcnJvclxyXG4gICAgZXNidWlsZDogbW9kZSA9PT0gJ3Byb2R1Y3Rpb24nID8geyBwdXJlOiBbJ2NvbnNvbGUubG9nJywgJ2NvbnNvbGUuaW5mbycsICdjb25zb2xlLmRlYnVnJ10gfSA6IHVuZGVmaW5lZCxcclxuICAgIGJ1aWxkOiB7XHJcbiAgICAgICAgb3V0RGlyOiBcImJ1aWxkXCIsXHJcbiAgICAgICAgLy8gT3B0aW1pemUgY2h1bmsgc2l6ZSBsaW1pdHNcclxuICAgICAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsIC8vIFdhcm4gaWYgY2h1bmsgZXhjZWVkcyAxTUJcclxuICAgICAgICByb2xsdXBPcHRpb25zOiB7XHJcbiAgICAgICAgICAgIG91dHB1dDoge1xyXG4gICAgICAgICAgICAgICAgbWFudWFsQ2h1bmtzOiAoaWQpID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBWZW5kb3IgY2h1bmtzXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMnKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSZWFjdCBjb3JlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncmVhY3QnKSB8fCBpZC5pbmNsdWRlcygncmVhY3QtZG9tJykgfHwgaWQuaW5jbHVkZXMoJ3JlYWN0LXJvdXRlcicpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1yZWFjdCc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gRmlyZWJhc2VcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdmaXJlYmFzZScpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1maXJlYmFzZSc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVUkgbGlicmFyaWVzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbHVjaWRlLXJlYWN0JykgfHwgaWQuaW5jbHVkZXMoJ2NsYXNzLXZhcmlhbmNlLWF1dGhvcml0eScpIHx8IGlkLmluY2x1ZGVzKCd0YWlsd2luZC1tZXJnZScpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci11aSc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2hhcnRzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncmVjaGFydHMnKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItY2hhcnRzJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBNYXBzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbGVhZmxldCcpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1tYXBzJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBQREZcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdqc3BkZicpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1wZGYnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFuaW1hdGlvblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ2ZyYW1lci1tb3Rpb24nKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItYW5pbWF0aW9uJztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBEYXRlIHV0aWxpdGllc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ2RhdGUtZm5zJykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiAndmVuZG9yLWRhdGUnO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIE90aGVyIG5vZGVfbW9kdWxlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1vdGhlcic7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIC8vIE9wdGltaXplIGNodW5rIGZpbGUgbmFtZXNcclxuICAgICAgICAgICAgICAgIGNodW5rRmlsZU5hbWVzOiAnY2h1bmtzL1tuYW1lXS1baGFzaF0uanMnLFxyXG4gICAgICAgICAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdqcy9bbmFtZV0tW2hhc2hdLmpzJyxcclxuICAgICAgICAgICAgICAgIGFzc2V0RmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uW2V4dF0nXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9LFxyXG4gICAgICAgIC8vIEVuYWJsZSBtaW5pZmljYXRpb25cclxuICAgICAgICBtaW5pZnk6ICd0ZXJzZXInLFxyXG4gICAgICAgIHRlcnNlck9wdGlvbnM6IHtcclxuICAgICAgICAgICAgY29tcHJlc3M6IHtcclxuICAgICAgICAgICAgICAgIGRyb3BfY29uc29sZTogdHJ1ZSwgLy8gUmVtb3ZlIGNvbnNvbGUubG9nIGluIHByb2R1Y3Rpb25cclxuICAgICAgICAgICAgICAgIGRyb3BfZGVidWdnZXI6IHRydWVcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgLy8gU291cmNlIG1hcHMgZm9yIHByb2R1Y3Rpb24gZGVidWdnaW5nIChvcHRpb25hbClcclxuICAgICAgICBzb3VyY2VtYXA6IGZhbHNlXHJcbiAgICB9LFxyXG4gICAgLy8gT25seSBlbmFibGUgY29tcG9uZW50LXRhZ2dlciBpbiBwcm9kdWN0aW9uIHRvIGF2b2lkIGRldiBjb25uZWN0aW9uIGF0dGVtcHRzIHRoYXQgY2FuIGNhdXNlIEVSUl9DT05ORUNUSU9OX1JFRlVTRUQgaW4gY29uc29sZVxyXG4gICAgcGx1Z2luczogW3JlYWN0KCksIC4uLihwcm9jZXNzLmVudi5OT0RFX0VOViA9PT0gJ3Byb2R1Y3Rpb24nID8gW3RhZ2dlcigpXSA6IFtdKV0sXHJcbiAgICBvcHRpbWl6ZURlcHM6IHtcclxuICAgICAgICBpbmNsdWRlOiBbJ3JlYWN0LXNpZ25hdHVyZS1jYW52YXMnXSxcclxuICAgIH0sXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgYWxpYXM6IHtcclxuICAgICAgICAgICAgJ0AnOiAnL3NyYycsXHJcbiAgICAgICAgICAgICdAY29tcG9uZW50cyc6ICcvc3JjL2NvbXBvbmVudHMnLFxyXG4gICAgICAgICAgICAnQHBhZ2VzJzogJy9zcmMvcGFnZXMnLFxyXG4gICAgICAgICAgICAnQGFzc2V0cyc6ICcvc3JjL2Fzc2V0cycsXHJcbiAgICAgICAgICAgICdAY29uc3RhbnRzJzogJy9zcmMvY29uc3RhbnRzJyxcclxuICAgICAgICAgICAgJ0BzdHlsZXMnOiAnL3NyYy9zdHlsZXMnLFxyXG4gICAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgICAgcG9ydDogNDAyOCxcclxuICAgICAgICBob3N0OiBcIjAuMC4wLjBcIixcclxuICAgICAgICBzdHJpY3RQb3J0OiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSG9zdHM6IFsnLmFtYXpvbmF3cy5jb20nLCAnLmJ1aWx0d2l0aHJvY2tldC5uZXcnXVxyXG4gICAgfVxyXG59KSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUErUCxTQUFTLG9CQUFvQjtBQUM1UixPQUFPLFdBQVc7QUFDbEIsT0FBTyxZQUFZO0FBR25CLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxPQUFPO0FBQUE7QUFBQSxFQUV2QyxTQUFTLFNBQVMsZUFBZSxFQUFFLE1BQU0sQ0FBQyxlQUFlLGdCQUFnQixlQUFlLEVBQUUsSUFBSTtBQUFBLEVBQzlGLE9BQU87QUFBQSxJQUNILFFBQVE7QUFBQTtBQUFBLElBRVIsdUJBQXVCO0FBQUE7QUFBQSxJQUN2QixlQUFlO0FBQUEsTUFDWCxRQUFRO0FBQUEsUUFDSixjQUFjLENBQUMsT0FBTztBQUVsQixjQUFJLEdBQUcsU0FBUyxjQUFjLEdBQUc7QUFFN0IsZ0JBQUksR0FBRyxTQUFTLE9BQU8sS0FBSyxHQUFHLFNBQVMsV0FBVyxLQUFLLEdBQUcsU0FBUyxjQUFjLEdBQUc7QUFDakYscUJBQU87QUFBQSxZQUNYO0FBRUEsZ0JBQUksR0FBRyxTQUFTLFVBQVUsR0FBRztBQUN6QixxQkFBTztBQUFBLFlBQ1g7QUFFQSxnQkFBSSxHQUFHLFNBQVMsY0FBYyxLQUFLLEdBQUcsU0FBUywwQkFBMEIsS0FBSyxHQUFHLFNBQVMsZ0JBQWdCLEdBQUc7QUFDekcscUJBQU87QUFBQSxZQUNYO0FBRUEsZ0JBQUksR0FBRyxTQUFTLFVBQVUsR0FBRztBQUN6QixxQkFBTztBQUFBLFlBQ1g7QUFFQSxnQkFBSSxHQUFHLFNBQVMsU0FBUyxHQUFHO0FBQ3hCLHFCQUFPO0FBQUEsWUFDWDtBQUVBLGdCQUFJLEdBQUcsU0FBUyxPQUFPLEdBQUc7QUFDdEIscUJBQU87QUFBQSxZQUNYO0FBRUEsZ0JBQUksR0FBRyxTQUFTLGVBQWUsR0FBRztBQUM5QixxQkFBTztBQUFBLFlBQ1g7QUFFQSxnQkFBSSxHQUFHLFNBQVMsVUFBVSxHQUFHO0FBQ3pCLHFCQUFPO0FBQUEsWUFDWDtBQUVBLG1CQUFPO0FBQUEsVUFDWDtBQUFBLFFBQ0o7QUFBQTtBQUFBLFFBRUEsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsTUFDcEI7QUFBQSxJQUNKO0FBQUE7QUFBQSxJQUVBLFFBQVE7QUFBQSxJQUNSLGVBQWU7QUFBQSxNQUNYLFVBQVU7QUFBQSxRQUNOLGNBQWM7QUFBQTtBQUFBLFFBQ2QsZUFBZTtBQUFBLE1BQ25CO0FBQUEsSUFDSjtBQUFBO0FBQUEsSUFFQSxXQUFXO0FBQUEsRUFDZjtBQUFBO0FBQUEsRUFFQSxTQUFTLENBQUMsTUFBTSxHQUFHLEdBQUksUUFBUSxJQUFJLGFBQWEsZUFBZSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBRTtBQUFBLEVBQy9FLGNBQWM7QUFBQSxJQUNWLFNBQVMsQ0FBQyx3QkFBd0I7QUFBQSxFQUN0QztBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0gsS0FBSztBQUFBLE1BQ0wsZUFBZTtBQUFBLE1BQ2YsVUFBVTtBQUFBLE1BQ1YsV0FBVztBQUFBLE1BQ1gsY0FBYztBQUFBLE1BQ2QsV0FBVztBQUFBLElBQ2Y7QUFBQSxFQUNKO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDSixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixjQUFjLENBQUMsa0JBQWtCLHNCQUFzQjtBQUFBLEVBQzNEO0FBQ0osRUFBRTsiLAogICJuYW1lcyI6IFtdCn0K
