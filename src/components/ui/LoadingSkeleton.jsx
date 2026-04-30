import React from 'react';

// Skeleton loading component for better perceived performance
const LoadingSkeleton = ({ 
  className = '', 
  height = 'h-4', 
  width = 'w-full', 
  rounded = 'rounded',
  animate = true 
}) => {
  return (
    <div 
      className={`bg-gray-200 ${height} ${width} ${rounded} ${animate ? 'animate-pulse' : ''} ${className}`}
    />
  );
};

export { LoadingSkeleton };

// Dashboard skeleton
export const DashboardSkeleton = () => {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="h-[80px] bg-white border-b border-gray-200 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <LoadingSkeleton height="h-6" width="w-48" />
          <LoadingSkeleton height="h-4" width="w-64" />
        </div>
        <LoadingSkeleton height="h-10" width="w-32" rounded="rounded-full" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats cards skeleton */}
        <div className="flex flex-wrap gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white p-6 rounded-lg border border-gray-200 min-w-[250px] flex-1">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <LoadingSkeleton height="h-4" width="w-20" />
                  <LoadingSkeleton height="h-8" width="w-16" />
                  <LoadingSkeleton height="h-3" width="w-24" />
                </div>
                <LoadingSkeleton height="h-12" width="w-12" rounded="rounded-full" />
              </div>
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex justify-between items-center">
              <div>
                <LoadingSkeleton height="h-6" width="w-48" />
                <LoadingSkeleton height="h-4" width="w-64" className="mt-2" />
              </div>
              <LoadingSkeleton height="h-10" width="w-32" rounded="rounded-lg" />
            </div>
          </div>
          
          <div className="p-6">
            {/* Table header */}
            <div className="grid grid-cols-4 gap-4 pb-4 border-b border-gray-200">
              {[1, 2, 3, 4].map((i) => (
                <LoadingSkeleton key={i} height="h-4" width="w-20" />
              ))}
            </div>
            
            {/* Table rows */}
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-4 gap-4 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <LoadingSkeleton height="h-8" width="w-8" rounded="rounded-full" />
                  <div className="space-y-1">
                    <LoadingSkeleton height="h-4" width="w-32" />
                    <LoadingSkeleton height="h-3" width="w-40" />
                  </div>
                </div>
                <LoadingSkeleton height="h-6" width="w-20" rounded="rounded-full" />
                <LoadingSkeleton height="h-6" width="w-16" rounded="rounded-full" />
                <div className="flex gap-2">
                  <LoadingSkeleton height="h-8" width="w-16" rounded="rounded-lg" />
                  <LoadingSkeleton height="h-8" width="w-20" rounded="rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// User list skeleton
export const UserListSkeleton = () => {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header skeleton */}
      <div className="h-[80px] bg-white border-b border-gray-200 flex items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <LoadingSkeleton height="h-6" width="w-48" />
          <LoadingSkeleton height="h-4" width="w-64" />
        </div>
        <LoadingSkeleton height="h-10" width="w-32" rounded="rounded-full" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page header */}
        <div className="flex justify-between items-center">
          <LoadingSkeleton height="h-8" width="w-32" />
          <LoadingSkeleton height="h-10" width="w-32" rounded="rounded-lg" />
        </div>

        {/* User groups */}
        {[1, 2, 3].map((groupIndex) => (
          <div key={groupIndex} className="bg-white rounded-lg border border-gray-200">
            {/* Group header */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <LoadingSkeleton height="h-10" width="w-10" rounded="rounded-full" />
                  <div className="space-y-1">
                    <LoadingSkeleton height="h-5" width="w-40" />
                    <LoadingSkeleton height="h-4" width="w-32" />
                  </div>
                </div>
                <LoadingSkeleton height="h-6" width="w-20" rounded="rounded-full" />
              </div>
            </div>
            
            {/* Group members */}
            <div className="p-4 space-y-3">
              {[1, 2, 3, 4].map((memberIndex) => (
                <div key={memberIndex} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <LoadingSkeleton height="h-8" width="w-8" rounded="rounded-full" />
                    <div className="space-y-1">
                      <LoadingSkeleton height="h-4" width="w-32" />
                      <LoadingSkeleton height="h-3" width="w-40" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <LoadingSkeleton height="h-6" width="w-20" rounded="rounded-full" />
                    <LoadingSkeleton height="h-6" width="w-16" rounded="rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Lightweight skeleton for route transition — keeps page load under 2s perceived */
export const PageContentSkeleton = () => (
  <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-pulse">
    <div className="flex justify-between items-center">
      <div className="h-8 bg-gray-200 rounded w-64" />
      <div className="h-10 bg-gray-200 rounded-lg w-28" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="h-4 bg-gray-200 rounded w-20 mb-2" />
          <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-32" />
        </div>
      ))}
    </div>
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="h-5 bg-gray-200 rounded w-48 mb-4" />
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="w-10 h-10 bg-gray-200 rounded-full" />
            <div className="flex-1">
              <div className="h-4 bg-gray-200 rounded w-40 mb-1" />
              <div className="h-3 bg-gray-200 rounded w-56" />
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default LoadingSkeleton;