import { useEffect, useRef } from 'react';

// Performance monitoring hook
export const usePerformanceMonitor = (componentName) => {
  const startTime = useRef(Date.now());
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      const mountTime = Date.now() - startTime.current;
      console.log(`🚀 ${componentName} mounted in ${mountTime}ms`);
      
      // Track performance metrics
      if (window.performance && window.performance.mark) {
        window.performance.mark(`${componentName}-mount-end`);
      }
    }

    return () => {
      if (window.performance && window.performance.mark) {
        window.performance.mark(`${componentName}-unmount`);
      }
    };
  }, [componentName]);

  const trackOperation = (operationName, startTime) => {
    const duration = Date.now() - startTime;
    console.log(`⏱️ ${componentName} - ${operationName}: ${duration}ms`);
    
    if (window.performance && window.performance.mark) {
      window.performance.mark(`${componentName}-${operationName}-end`);
    }
    
    return duration;
  };

  return { trackOperation };
};

// Utility function to measure async operations
export const measureAsync = async (operationName, asyncFn) => {
  const startTime = Date.now();
  try {
    const result = await asyncFn();
    const duration = Date.now() - startTime;
    console.log(`⚡ ${operationName} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ ${operationName} failed after ${duration}ms:`, error);
    throw error;
  }
};