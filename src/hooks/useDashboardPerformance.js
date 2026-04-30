import { useEffect, useRef, useState } from 'react';

/**
 * Custom hook for monitoring dashboard performance metrics
 */
export const useDashboardPerformance = (componentName = 'Dashboard') => {
  const [metrics, setMetrics] = useState({
    loadTime: null,
    cacheHitRate: 0,
    queryCount: 0,
    errorRate: 0,
    lastLoadTime: null
  });

  const startTimeRef = useRef(null);
  const loadCountRef = useRef(0);
  const cacheHitsRef = useRef(0);
  const errorsRef = useRef(0);

  // Start timing a load operation
  const startLoad = () => {
    startTimeRef.current = performance.now();
    loadCountRef.current += 1;
  };

  // End timing and record metrics
  const endLoad = (fromCache = false, hasError = false) => {
    if (startTimeRef.current) {
      const loadTime = performance.now() - startTimeRef.current;
      
      if (fromCache) {
        cacheHitsRef.current += 1;
      }
      
      if (hasError) {
        errorsRef.current += 1;
      }

      const newMetrics = {
        loadTime: Math.round(loadTime),
        lastLoadTime: new Date().toISOString(),
        cacheHitRate: loadCountRef.current > 0 ? 
          Math.round((cacheHitsRef.current / loadCountRef.current) * 100) : 0,
        queryCount: loadCountRef.current,
        errorRate: loadCountRef.current > 0 ? 
          Math.round((errorsRef.current / loadCountRef.current) * 100) : 0
      };

      setMetrics(newMetrics);

      // Log performance metrics
      console.log(`${componentName} Performance:`, {
        loadTime: `${loadTime.toFixed(2)}ms`,
        fromCache,
        hasError,
        ...newMetrics
      });

      // Log slow loads
      if (loadTime > 2000) {
        console.warn(`${componentName} slow load detected:`, {
          loadTime: `${loadTime.toFixed(2)}ms`,
          fromCache,
          hasError
        });
      }

      startTimeRef.current = null;
    }
  };

  // Reset metrics
  const resetMetrics = () => {
    loadCountRef.current = 0;
    cacheHitsRef.current = 0;
    errorsRef.current = 0;
    setMetrics({
      loadTime: null,
      cacheHitRate: 0,
      queryCount: 0,
      errorRate: 0,
      lastLoadTime: null
    });
  };

  // Get performance summary
  const getPerformanceSummary = () => {
    const avgLoadTime = metrics.loadTime;
    let status = 'good';
    
    if (avgLoadTime > 3000) {
      status = 'poor';
    } else if (avgLoadTime > 1500) {
      status = 'fair';
    }

    return {
      status,
      metrics,
      recommendations: getRecommendations(metrics)
    };
  };

  // Get performance recommendations
  const getRecommendations = (currentMetrics) => {
    const recommendations = [];

    if (currentMetrics.cacheHitRate < 50) {
      recommendations.push('Consider increasing cache TTL or improving cache strategy');
    }

    if (currentMetrics.errorRate > 10) {
      recommendations.push('High error rate detected - check network connectivity and error handling');
    }

    if (currentMetrics.loadTime > 2000) {
      recommendations.push('Load time is slow - consider optimizing queries or implementing progressive loading');
    }

    return recommendations;
  };

  return {
    metrics,
    startLoad,
    endLoad,
    resetMetrics,
    getPerformanceSummary
  };
};

export default useDashboardPerformance;