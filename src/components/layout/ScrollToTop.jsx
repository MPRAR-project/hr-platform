// ScrollToTop.jsx
import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

const ScrollToTop = ({
  showAfter = 100,
  position = 'right',
  className = '',
  behavior = 'smooth',
  containerRef, // pass ref of the element that actually scrolls
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef?.current || window;

    const getScrollTop = () =>
      el === window
        ? (window.pageYOffset ?? document.documentElement.scrollTop ?? 0)
        : el.scrollTop;

    const onScroll = () => setIsVisible(getScrollTop() > showAfter);

    onScroll(); // initialize based on current position
    el.addEventListener('scroll', onScroll, { passive: true });

    // If the element changes (ref swap), clean up correctly
    return () => el.removeEventListener('scroll', onScroll);
  }, [containerRef, showAfter]);

  const scrollToTop = () => {
    const el = containerRef?.current || window;
    if (el !== window && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: 0, left: 0, behavior });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  };

  const positionClasses = position === 'left' ? 'left-8' : 'right-8';

  return (
    <>
      {isVisible && (
        <button
          onClick={scrollToTop}
          className={`fixed bottom-8 ${positionClasses} z-[9999] w-12 h-12
            bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white
            rounded-full shadow-lg hover:shadow-xl hover:scale-110
            transition-all duration-300 flex items-center justify-center group ${className}`}
          aria-label="Scroll to top"
        >
          <ArrowUp className="h-6 w-6 group-hover:animate-bounce" />
        </button>
      )}
    </>
  );
};

export default ScrollToTop;
