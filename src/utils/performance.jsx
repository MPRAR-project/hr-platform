// Performance utilities for React optimization
import React from 'react';

// Debounce function for search inputs and frequent operations
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

// Throttle function for scroll events and frequent updates
export const throttle = (func, limit) => {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// Lazy loading utility for components
export const createLazyComponent = (importFunc, fallback = null) => {
  const LazyComponent = React.lazy(importFunc);
  
  return (props) => (
    <React.Suspense fallback={fallback}>
      <LazyComponent {...props} />
    </React.Suspense>
  );
};

// Performance measurement utility
export const measurePerformance = (name, fn) => {
  return async (...args) => {
    const start = performance.now();
    try {
      const result = await fn(...args);
      const end = performance.now();
      console.log(`⚡ ${name}: ${(end - start).toFixed(2)}ms`);
      return result;
    } catch (error) {
      const end = performance.now();
      console.error(`❌ ${name} failed after ${(end - start).toFixed(2)}ms:`, error);
      throw error;
    }
  };
};

// Memory usage tracker
export const trackMemoryUsage = (componentName) => {
  if (performance.memory) {
    const { usedJSHeapSize, totalJSHeapSize } = performance.memory;
    console.log(`🧠 ${componentName} Memory Usage:`, {
      used: `${(usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      total: `${(totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`,
      percentage: `${((usedJSHeapSize / totalJSHeapSize) * 100).toFixed(1)}%`
    });
  }
};

// Bundle size analyzer (development only)
export const analyzeBundleSize = () => {
  if (process.env.NODE_ENV === 'development') {
    const scripts = document.querySelectorAll('script[src]');
    let totalSize = 0;
    
    scripts.forEach(script => {
      fetch(script.src, { method: 'HEAD' })
        .then(response => {
          const size = response.headers.get('content-length');
          if (size) {
            totalSize += parseInt(size);
            console.log(`📦 Script: ${script.src.split('/').pop()} - ${(size / 1024).toFixed(2)} KB`);
          }
        })
        .catch(() => {}); // Ignore CORS errors
    });
    
    setTimeout(() => {
      console.log(`📦 Total estimated bundle size: ${(totalSize / 1024).toFixed(2)} KB`);
    }, 1000);
  }
};

// React component performance profiler
export const withPerformanceProfiler = (WrappedComponent, componentName) => {
  return React.memo((props) => {
    const renderStart = performance.now();
    
    React.useEffect(() => {
      const renderEnd = performance.now();
      console.log(`🎨 ${componentName} render time: ${(renderEnd - renderStart).toFixed(2)}ms`);
    });
    
    return <WrappedComponent {...props} />;
  });
};