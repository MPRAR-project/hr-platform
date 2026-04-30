// vite.config.ts
import { defineConfig } from "file:///F:/work/mprar/MPRAR/node_modules/vite/dist/node/index.js";
import react from "file:///F:/work/mprar/MPRAR/node_modules/@vitejs/plugin-react/dist/index.mjs";
import tagger from "file:///F:/work/mprar/MPRAR/node_modules/@dhiwise/component-tagger/dist/index.mjs";
var vite_config_default = defineConfig({
  build: {
    outDir: "build"
  },
  plugins: [react(), tagger()],
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
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJGOlxcXFx3b3JrXFxcXG1wcmFyXFxcXE1QUkFSXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJGOlxcXFx3b3JrXFxcXG1wcmFyXFxcXE1QUkFSXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9GOi93b3JrL21wcmFyL01QUkFSL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XHJcbmltcG9ydCB0YWdnZXIgZnJvbSBcIkBkaGl3aXNlL2NvbXBvbmVudC10YWdnZXJcIjtcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIG91dERpcjogXCJidWlsZFwiLFxyXG4gICAgfSxcclxuICAgIHBsdWdpbnM6IFtyZWFjdCgpLCB0YWdnZXIoKV0sXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgYWxpYXM6IHtcclxuICAgICAgICAgICAgJ0AnOiAnL3NyYycsXHJcbiAgICAgICAgICAgICdAY29tcG9uZW50cyc6ICcvc3JjL2NvbXBvbmVudHMnLFxyXG4gICAgICAgICAgICAnQHBhZ2VzJzogJy9zcmMvcGFnZXMnLFxyXG4gICAgICAgICAgICAnQGFzc2V0cyc6ICcvc3JjL2Fzc2V0cycsXHJcbiAgICAgICAgICAgICdAY29uc3RhbnRzJzogJy9zcmMvY29uc3RhbnRzJyxcclxuICAgICAgICAgICAgJ0BzdHlsZXMnOiAnL3NyYy9zdHlsZXMnLFxyXG4gICAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgICAgcG9ydDogNDAyOCxcclxuICAgICAgICBob3N0OiBcIjAuMC4wLjBcIixcclxuICAgICAgICBzdHJpY3RQb3J0OiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSG9zdHM6IFsnLmFtYXpvbmF3cy5jb20nLCAnLmJ1aWx0d2l0aHJvY2tldC5uZXcnXVxyXG4gICAgfVxyXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQW1QLFNBQVMsb0JBQW9CO0FBQ2hSLE9BQU8sV0FBVztBQUNsQixPQUFPLFlBQVk7QUFHbkIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsT0FBTztBQUFBLElBQ0gsUUFBUTtBQUFBLEVBQ1o7QUFBQSxFQUNBLFNBQVMsQ0FBQyxNQUFNLEdBQUcsT0FBTyxDQUFDO0FBQUEsRUFDM0IsU0FBUztBQUFBLElBQ0wsT0FBTztBQUFBLE1BQ0gsS0FBSztBQUFBLE1BQ0wsZUFBZTtBQUFBLE1BQ2YsVUFBVTtBQUFBLE1BQ1YsV0FBVztBQUFBLE1BQ1gsY0FBYztBQUFBLE1BQ2QsV0FBVztBQUFBLElBQ2Y7QUFBQSxFQUNKO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDSixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixjQUFjLENBQUMsa0JBQWtCLHNCQUFzQjtBQUFBLEVBQzNEO0FBQ0osQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
