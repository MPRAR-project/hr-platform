import React, { useRef, Suspense, useEffect } from 'react';
import Sidebar from './Sidebar';
import { Outlet } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';
import { useAuth } from '../../hooks/useAuth';
import { useCache } from '../../contexts/CacheContext';
import { PageContentSkeleton } from '../../components/ui/LoadingSkeleton';
import { prefetchAll } from '../../services/dataPrefetch';

const MainLayout = () => {
  const { isLoading, user } = useAuth();
  const { setItem } = useCache();
  const mainRef = useRef(null);
  const prefetchedForRef = useRef(null);

  // Prefetch data for key pages so they load in <500ms when user navigates
  useEffect(() => {
    if (!user?.userId || !user?.companyId || !setItem) return;
    const key = `${user.userId}_${user.companyId}`;
    if (prefetchedForRef.current === key) return;
    prefetchedForRef.current = key;
    prefetchAll(user, setItem);
  }, [user?.userId, user?.companyId, user?.role, setItem]);

  // Show app shell (sidebar + main) immediately; skeleton in content area while auth loads (faster perceived load on Vercel)
  return (
    <div className="flex h-screen bg-bg-secondary overflow-hidden">
      <Sidebar />
      <main
        id="app-scroll"
        ref={mainRef}
        className="relative flex-1 min-h-0 overflow-y-auto"
      >
        {isLoading && !user ? (
          <div className="p-4 md:p-6 min-h-[320px]">
            <PageContentSkeleton />
          </div>
        ) : (
          <Suspense fallback={<PageContentSkeleton />}>
            <Outlet />
          </Suspense>
        )}
      </main>

      <ScrollToTop target="#app-scroll" />
    </div>
  );
};

export default MainLayout;
