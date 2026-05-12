import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tagger from "@dhiwise/component-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    // Strip console.log/info/debug in production (all chunks); keep console.warn/error
    esbuild: mode === 'production' ? { pure: ['console.log', 'console.info', 'console.debug'] } : undefined,
    build: {
        outDir: "build",
        // Optimize chunk size limits
        chunkSizeWarningLimit: 1000, // Warn if chunk exceeds 1MB
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    // Vendor chunks
                    if (id.includes('node_modules')) {
                        // React core
                        if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
                            return 'vendor-react';
                        }
                        // UI libraries
                        if (id.includes('lucide-react') || id.includes('class-variance-authority') || id.includes('tailwind-merge')) {
                            return 'vendor-ui';
                        }
                        // Charts
                        if (id.includes('recharts')) {
                            return 'vendor-charts';
                        }
                        // Maps
                        if (id.includes('leaflet')) {
                            return 'vendor-maps';
                        }
                        // PDF
                        if (id.includes('jspdf')) {
                            return 'vendor-pdf';
                        }
                        // Animation
                        if (id.includes('framer-motion')) {
                            return 'vendor-animation';
                        }
                        // Date utilities
                        if (id.includes('date-fns')) {
                            return 'vendor-date';
                        }
                        // Other node_modules
                        return 'vendor-other';
                    }
                },
                // Optimize chunk file names
                chunkFileNames: 'chunks/[name]-[hash].js',
                entryFileNames: 'js/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]'
            }
        },
        // Enable minification
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true, // Remove console.log in production
                drop_debugger: true
            }
        },
        // Source maps for production debugging (optional)
        sourcemap: false
    },
    // Only enable component-tagger in production to avoid dev connection attempts that can cause ERR_CONNECTION_REFUSED in console
    plugins: [react(), ...(process.env.NODE_ENV === 'production' ? [tagger()] : [])],
    optimizeDeps: {
        include: ['react-signature-canvas'],
    },
    resolve: {
        alias: {
            '@': '/src',
            '@components': '/src/components',
            '@pages': '/src/pages',
            '@assets': '/src/assets',
            '@constants': '/src/constants',
            '@styles': '/src/styles',
            'firebase/app': '/src/firebase/auth-shim.js',
            'firebase/firestore': '/src/firebase/firestore-shim.js',
            'firebase/auth': '/src/firebase/auth-shim.js',
            'firebase/functions': '/src/firebase/functions-shim.js',
            'firebase/storage': '/src/firebase/storage-shim.js',
        },
    },
    server: {
        port: 4028,
        host: "0.0.0.0",
        strictPort: false,
        allowedHosts: ['.amazonaws.com', '.builtwithrocket.new']
    }
}));