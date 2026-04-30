// vite.config.ts
import { defineConfig } from "file:///E:/Study/Projects/MPRAR/node_modules/vite/dist/node/index.js";
import react from "file:///E:/Study/Projects/MPRAR/node_modules/@vitejs/plugin-react/dist/index.mjs";
import tagger from "file:///E:/Study/Projects/MPRAR/node_modules/@dhiwise/component-tagger/dist/index.mjs";
var vite_config_default = defineConfig({
  build: {
    outDir: "build",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
          ui: ["lucide-react", "class-variance-authority", "tailwind-merge"],
          charts: ["recharts"],
          maps: ["leaflet", "react-leaflet"],
          pdf: ["jspdf", "jspdf-autotable"],
          animation: ["framer-motion"]
        }
      }
    }
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxTdHVkeVxcXFxQcm9qZWN0c1xcXFxNUFJBUlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcU3R1ZHlcXFxcUHJvamVjdHNcXFxcTVBSQVJcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L1N0dWR5L1Byb2plY3RzL01QUkFSL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XHJcbmltcG9ydCB0YWdnZXIgZnJvbSBcIkBkaGl3aXNlL2NvbXBvbmVudC10YWdnZXJcIjtcclxuXHJcbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgICBidWlsZDoge1xyXG4gICAgICAgIG91dERpcjogXCJidWlsZFwiLFxyXG4gICAgICAgIHJvbGx1cE9wdGlvbnM6IHtcclxuICAgICAgICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgICAgICAgICBtYW51YWxDaHVua3M6IHtcclxuICAgICAgICAgICAgICAgICAgICB2ZW5kb3I6IFsncmVhY3QnLCAncmVhY3QtZG9tJywgJ3JlYWN0LXJvdXRlci1kb20nXSxcclxuICAgICAgICAgICAgICAgICAgICBmaXJlYmFzZTogWydmaXJlYmFzZS9hcHAnLCAnZmlyZWJhc2UvYXV0aCcsICdmaXJlYmFzZS9maXJlc3RvcmUnXSxcclxuICAgICAgICAgICAgICAgICAgICB1aTogWydsdWNpZGUtcmVhY3QnLCAnY2xhc3MtdmFyaWFuY2UtYXV0aG9yaXR5JywgJ3RhaWx3aW5kLW1lcmdlJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgY2hhcnRzOiBbJ3JlY2hhcnRzJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgbWFwczogWydsZWFmbGV0JywgJ3JlYWN0LWxlYWZsZXQnXSxcclxuICAgICAgICAgICAgICAgICAgICBwZGY6IFsnanNwZGYnLCAnanNwZGYtYXV0b3RhYmxlJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgYW5pbWF0aW9uOiBbJ2ZyYW1lci1tb3Rpb24nXVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfSxcclxuICAgIHBsdWdpbnM6IFtyZWFjdCgpLCB0YWdnZXIoKV0sXHJcbiAgICByZXNvbHZlOiB7XHJcbiAgICAgICAgYWxpYXM6IHtcclxuICAgICAgICAgICAgJ0AnOiAnL3NyYycsXHJcbiAgICAgICAgICAgICdAY29tcG9uZW50cyc6ICcvc3JjL2NvbXBvbmVudHMnLFxyXG4gICAgICAgICAgICAnQHBhZ2VzJzogJy9zcmMvcGFnZXMnLFxyXG4gICAgICAgICAgICAnQGFzc2V0cyc6ICcvc3JjL2Fzc2V0cycsXHJcbiAgICAgICAgICAgICdAY29uc3RhbnRzJzogJy9zcmMvY29uc3RhbnRzJyxcclxuICAgICAgICAgICAgJ0BzdHlsZXMnOiAnL3NyYy9zdHlsZXMnLFxyXG4gICAgICAgIH0sXHJcbiAgICB9LFxyXG4gICAgc2VydmVyOiB7XHJcbiAgICAgICAgcG9ydDogNDAyOCxcclxuICAgICAgICBob3N0OiBcIjAuMC4wLjBcIixcclxuICAgICAgICBzdHJpY3RQb3J0OiBmYWxzZSxcclxuICAgICAgICBhbGxvd2VkSG9zdHM6IFsnLmFtYXpvbmF3cy5jb20nLCAnLmJ1aWx0d2l0aHJvY2tldC5uZXcnXVxyXG4gICAgfVxyXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQStQLFNBQVMsb0JBQW9CO0FBQzVSLE9BQU8sV0FBVztBQUNsQixPQUFPLFlBQVk7QUFHbkIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDeEIsT0FBTztBQUFBLElBQ0gsUUFBUTtBQUFBLElBQ1IsZUFBZTtBQUFBLE1BQ1gsUUFBUTtBQUFBLFFBQ0osY0FBYztBQUFBLFVBQ1YsUUFBUSxDQUFDLFNBQVMsYUFBYSxrQkFBa0I7QUFBQSxVQUNqRCxVQUFVLENBQUMsZ0JBQWdCLGlCQUFpQixvQkFBb0I7QUFBQSxVQUNoRSxJQUFJLENBQUMsZ0JBQWdCLDRCQUE0QixnQkFBZ0I7QUFBQSxVQUNqRSxRQUFRLENBQUMsVUFBVTtBQUFBLFVBQ25CLE1BQU0sQ0FBQyxXQUFXLGVBQWU7QUFBQSxVQUNqQyxLQUFLLENBQUMsU0FBUyxpQkFBaUI7QUFBQSxVQUNoQyxXQUFXLENBQUMsZUFBZTtBQUFBLFFBQy9CO0FBQUEsTUFDSjtBQUFBLElBQ0o7QUFBQSxFQUNKO0FBQUEsRUFDQSxTQUFTLENBQUMsTUFBTSxHQUFHLE9BQU8sQ0FBQztBQUFBLEVBQzNCLFNBQVM7QUFBQSxJQUNMLE9BQU87QUFBQSxNQUNILEtBQUs7QUFBQSxNQUNMLGVBQWU7QUFBQSxNQUNmLFVBQVU7QUFBQSxNQUNWLFdBQVc7QUFBQSxNQUNYLGNBQWM7QUFBQSxNQUNkLFdBQVc7QUFBQSxJQUNmO0FBQUEsRUFDSjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ0osTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBLElBQ1osY0FBYyxDQUFDLGtCQUFrQixzQkFBc0I7QUFBQSxFQUMzRDtBQUNKLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
