// @refresh reset
import React, { createContext, useState } from 'react';

export const UIContext = createContext(null);

export const UIProvider = ({ children }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(prev => !prev);
  const openSidebar = () => setSidebarOpen(true);
  const closeSidebar = () => setSidebarOpen(false);

  const value = React.useMemo(() => ({
    isSidebarOpen,
    toggleSidebar,
    openSidebar,
    closeSidebar
  }), [isSidebarOpen]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
};