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
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
// Performance monitoring
import performanceMonitor from './utils/performanceMonitor';

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
                                <AppRouter />
                                <ScrollToTop showAfter={500} position="right" />
                                <ToastContainer
                                    position="top-right"
                                    autoClose={5000}
                                    hideProgressBar={false}
                                    newestOnTop={false}
                                    closeOnClick
                                    rtl={false}
                                    pauseOnFocusLoss
                                    draggable
                                    pauseOnHover
                                    theme="light"
                                    style={{ zIndex: 9999 }}
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