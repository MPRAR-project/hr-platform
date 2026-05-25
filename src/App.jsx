import React, { useEffect } from 'react';
import MainLayout from './components/layout/MainLayout';
import { AuthProvider } from './contexts/AuthContext';
import { BrowserRouter } from 'react-router-dom';
import { UIProvider } from './contexts/UIContext';
import { TimesheetProvider } from './contexts/TimesheetContext';
import { ClockSessionProvider } from './contexts/ClockSessionContext';
import { CacheProvider } from './contexts/CacheContext';
import AppRouter from './Router';
import ScrollToTop from './components/layout/ScrollToTop';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from './components/ui/ErrorBoundary';
import wsClient from './lib/wsClient';
// Performance monitoring
import performanceMonitor from './utils/performanceMonitor';

// ── Global WS notification handler ────────────────────────────────────────────
// Listens for backend-pushed 'notification' events (e.g. timesheet approved/rejected)
// and shows them as toasts platform-wide without requiring page-specific code.
function WsNotificationBridge() {
  useEffect(() => {
    const handleNotification = (data) => {
      if (!data) return;
      const { type, title, message } = data;

      const toastConfig = {
        position: 'top-right',
        autoClose: 6000,
        hideProgressBar: false,
        pauseOnHover: true,
        draggable: true,
      };

      const text = message || title || 'You have a new notification';

      if (type === 'timesheet_approved') {
        toast.success(text, toastConfig);
      } else if (type === 'timesheet_rejected') {
        toast.error(text, toastConfig);
      } else {
        toast.info(text, toastConfig);
      }
    };

    wsClient.on('notification', handleNotification);
    return () => wsClient.off('notification', handleNotification);
  }, []);

  return null;
}

const App = () => {
    useEffect(() => {
        performanceMonitor.init();
        // Defer migration check so it doesn't block first paint (helps Vercel/production load)
        import('./utils/runMigration').catch(() => { });
        return () => { };
    }, []);

    return (
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
                <CacheProvider>
                    <UIProvider>
                        <ClockSessionProvider>
                            <TimesheetProvider>
                                <ErrorBoundary>
                                  <AppRouter />
                                  <WsNotificationBridge />
                                </ErrorBoundary>
                                <ScrollToTop showAfter={500} position="right" />
                                <ToastContainer
                                    position="top-right"
                                    autoClose={4000}
                                    hideProgressBar={false}
                                    newestOnTop={true}
                                    closeOnClick
                                    rtl={false}
                                    pauseOnFocusLoss
                                    draggable
                                    pauseOnHover
                                    theme="colored"
                                    style={{ zIndex: 9999 }}
                                    limit={5}
                                />
                            </TimesheetProvider>
                        </ClockSessionProvider>
                    </UIProvider>
                </CacheProvider>
            </AuthProvider>
        </BrowserRouter>
    );
};

export default App;