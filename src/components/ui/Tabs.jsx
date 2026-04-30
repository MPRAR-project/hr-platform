import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

const Tabs = ({ tabs = [], onTabChange, activeTab: externalActiveTab }) => {
  const [activeTab, setActiveTab] = useState(externalActiveTab || (tabs.length > 0 ? tabs[0].label : ''));
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const buttonRef = useRef(null);

  // Sync with external state
  useEffect(() => {
    if (externalActiveTab && externalActiveTab !== activeTab) {
      setActiveTab(externalActiveTab);
    }
  }, [externalActiveTab]);

  const handleTabClick = (label) => {
    setActiveTab(label);
    setIsOpen(false);
    if (onTabChange) {
      onTabChange(label);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div className="relative">
      {/* Desktop/Tablet View - Horizontal Tabs */}
      <div className="hidden md:flex overflow-x-auto scrollbar-custom w-fit max-w-full bg-gray-100 rounded-full p-1 relative">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.label;
          return (
            <button
              key={tab.label}
              onClick={() => handleTabClick(tab.label)}
              aria-label={`Select ${tab.label} tab`}
              className={`flex-shrink-0 rounded-full font-bold text-sm lg:text-lg transition-all duration-300 whitespace-nowrap
                ${isActive
                  ? 'bg-white shadow-md py-lg px-xl lg:px-3xl text-text-accent-purple'
                  : 'py-base px-lg lg:px-3xl text-text-secondary hover:text-text-primary'
                }`
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Mobile View - Custom Dropdown */}
      <div className="md:hidden relative">
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`Change current tab: ${activeTab}`}
          className="w-full bg-white border-2 border-border-accent-purple rounded-full px-4 py-3 text-md font-bold text-text-accent-purple focus:outline-none focus:ring-2 focus:ring-border-accent-purple flex items-center justify-between"
        >
          <span>{activeTab}</span>
          <ChevronDown className={`h-5 w-5 text-text-accent-purple transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Custom Dropdown Menu */}
        {isOpen && (
          <div
            ref={dropdownRef}
            className="absolute top-full left-0 right-0 mt-2 bg-white border-2 border-border-accent-purple rounded-xl shadow-lg max-h-80 overflow-y-auto scrollbar-custom z-50"
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.label;
              return (
                <button
                  key={tab.label}
                  onClick={() => handleTabClick(tab.label)}
                  aria-label={`Switch to ${tab.label}`}
                  className={`w-full px-4 py-3 text-left text-sm font-medium transition-colors flex items-center justify-between
                    ${isActive
                      ? 'bg-bg-accent-purple-light text-text-accent-purple font-bold'
                      : 'text-text-primary hover:bg-bg-accent-purple-light hover:text-text-accent-purple'
                    }`
                  }
                >
                  <span>{tab.label}</span>
                  {isActive && <Check className="h-4 w-4 text-text-accent-purple" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Tabs;