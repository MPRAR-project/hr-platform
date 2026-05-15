/**
 * Performance Monitoring System
 * Tracks Web Vitals, REST API operations, and application performance metrics
 * Designed for 1M+ user scalability
 */

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            pageLoad: null,
            apiReads: 0,
            apiWrites: 0,
            queryLatency: [],
            cacheHits: 0,
            cacheMisses: 0,
            wsSubscriptions: 0,
            memoryUsage: null,
            errors: []
        };
        this.startTime = performance.now();
        this.observers = [];
        // Only log when explicitly enabled (e.g. localStorage 'perf-monitoring' = 'true')
        this.isEnabled = typeof localStorage !== 'undefined' && localStorage.getItem('perf-monitoring') === 'true';
    }

    /**
     * Initialize performance monitoring
     */
    init() {
        this.trackPageLoad();
        this.trackWebVitals();
        this.trackMemoryUsage();
        this.trackErrors();
    }

    /**
     * Track page load performance
     */
    trackPageLoad() {
        if (typeof window === 'undefined') return;

        window.addEventListener('load', () => {
            const loadTime = performance.now() - this.startTime;
            this.metrics.pageLoad = loadTime;
            this.logMetric('pageLoad', loadTime);
        });
    }

    /**
     * Track Web Vitals (LCP, FID, CLS, FCP, TTFB)
     */
    trackWebVitals() {
        if (typeof window === 'undefined' || !window.PerformanceObserver) return;

        try {
            // Largest Contentful Paint (LCP)
            const lcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                const lastEntry = entries[entries.length - 1];
                this.logMetric('LCP', lastEntry.renderTime || lastEntry.loadTime);
            });
            lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
            this.observers.push(lcpObserver);

            // First Input Delay (FID)
            const fidObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    this.logMetric('FID', entry.processingStart - entry.startTime);
                }
            });
            fidObserver.observe({ entryTypes: ['first-input'] });
            this.observers.push(fidObserver);

            // Cumulative Layout Shift (CLS)
            let clsValue = 0;
            const clsObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) {
                        clsValue += entry.value;
                        this.logMetric('CLS', clsValue);
                    }
                }
            });
            clsObserver.observe({ entryTypes: ['layout-shift'] });
            this.observers.push(clsObserver);

            // First Contentful Paint (FCP)
            const fcpObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry.name === 'first-contentful-paint') {
                        this.logMetric('FCP', entry.startTime);
                    }
                }
            });
            fcpObserver.observe({ entryTypes: ['paint'] });
            this.observers.push(fcpObserver);

        } catch (error) {
            // Web Vitals tracking failed
        }
    }

    /**
     * Track memory usage
     */
    trackMemoryUsage() {
        if (typeof performance === 'undefined' || !performance.memory) return;

        const trackMemory = () => {
            this.metrics.memoryUsage = {
                used: performance.memory.usedJSHeapSize,
                total: performance.memory.totalJSHeapSize,
                limit: performance.memory.jsHeapSizeLimit
            };
        };

        // Track memory every 30 seconds
        setInterval(trackMemory, 30000);
        trackMemory();
    }

    /**
     * Track errors
     */
    trackError(error, context = {}) {
        const errorData = {
            message: error.message || String(error),
            stack: error.stack,
            timestamp: Date.now(),
            context
        };

        this.metrics.errors.push(errorData);
        
        // Keep only last 50 errors
        if (this.metrics.errors.length > 50) {
            this.metrics.errors.shift();
        }

        this.logMetric('error', errorData);
    }

    /**
     * Track errors globally
     */
    trackErrors() {
        if (typeof window === 'undefined') return;

        window.addEventListener('error', (event) => {
            this.trackError(event.error || event.message, {
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            this.trackError(event.reason, {
                type: 'unhandledRejection'
            });
        });
    }

    trackApiRead(count = 1) {
        this.metrics.apiReads += count;
        this.logMetric('apiRead', count);
    }

    trackApiWrite(count = 1) {
        this.metrics.apiWrites += count;
        this.logMetric('apiWrite', count);
    }

    /**
     * Track query latency
     */
    trackQueryLatency(latency) {
        this.metrics.queryLatency.push(latency);
        
        // Keep only last 100 measurements
        if (this.metrics.queryLatency.length > 100) {
            this.metrics.queryLatency.shift();
        }

        this.logMetric('queryLatency', latency);
    }

    /**
     * Track cache hit
     */
    trackCacheHit() {
        this.metrics.cacheHits++;
        this.logMetric('cacheHit', 1);
    }

    /**
     * Track cache miss
     */
    trackCacheMiss() {
        this.metrics.cacheMisses++;
        this.logMetric('cacheMiss', 1);
    }

    trackWsSubscriptionCount(count) {
        this.metrics.wsSubscriptions = count;
        this.logMetric('wsSubscriptions', count);
    }

    /**
     * Get cache hit rate
     */
    getCacheHitRate() {
        const total = this.metrics.cacheHits + this.metrics.cacheMisses;
        if (total === 0) return 0;
        return (this.metrics.cacheHits / total) * 100;
    }

    /**
     * Get average query latency
     */
    getAverageQueryLatency() {
        if (this.metrics.queryLatency.length === 0) return 0;
        const sum = this.metrics.queryLatency.reduce((a, b) => a + b, 0);
        return sum / this.metrics.queryLatency.length;
    }

    /**
     * Get performance summary
     */
    getSummary() {
        return {
            pageLoad: this.metrics.pageLoad,
            apiReads: this.metrics.apiReads,
            apiWrites: this.metrics.apiWrites,
            averageQueryLatency: this.getAverageQueryLatency(),
            cacheHitRate: this.getCacheHitRate(),
            wsSubscriptions: this.metrics.wsSubscriptions,
            memoryUsage: this.metrics.memoryUsage,
            errorCount: this.metrics.errors.length
        };
    }

    /**
     * Log metric (can be extended to send to analytics service)
     */
    logMetric(name, value) {
        if (!this.isEnabled) return;

        // In production, you can send to analytics service
        // Example: sendToAnalytics(name, value);
        
        if (process.env.NODE_ENV === 'development') {
            console.log(`[PerformanceMonitor] ${name}:`, value);
        }
    }

    /**
     * Cleanup observers
     */
    cleanup() {
        this.observers.forEach(observer => {
            try {
                observer.disconnect();
            } catch (e) {
                // Ignore
            }
        });
        this.observers = [];
    }
}

// Export singleton instance
const performanceMonitor = new PerformanceMonitor();

// Auto-initialize in browser
if (typeof window !== 'undefined') {
    performanceMonitor.init();
}

export default performanceMonitor;
