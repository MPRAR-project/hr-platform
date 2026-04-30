import React from 'react';

/**
 * Professional SaaS Loader Component
 * Designed for employee and team management SaaS applications
 * 
 * @param {Object} props
 * @param {string} props.variant - Variant: 'spinner', 'skeleton', 'progress', 'pulse', 'wave' (default: 'spinner')
 * @param {string} props.size - Size: 'sm', 'md', 'lg' (default: 'md')
 * @param {string} props.text - Optional text to display
 * @param {boolean} props.fullScreen - Full screen overlay (default: false)
 * @param {string} props.className - Additional CSS classes
 * @param {number} props.progress - Progress percentage (0-100) for progress variant
 */
/**
 * @param {string} props.color - 'theme' (purple from design system) or 'inverse' (white, for use on colored buttons)
 */
const Loader = ({ 
  variant = 'spinner', 
  size = 'md', 
  text = '', 
  fullScreen = false,
  className = '',
  progress = null,
  color = 'theme'
}) => {
  const isInverse = color === 'inverse';
  const themeBarClass = isInverse
    ? 'bg-gradient-to-t from-white/90 to-white rounded-t-full'
    : 'bg-gradient-to-t from-[#7617A7] to-[#AF54DD] rounded-t-full';
  // Size configurations
  const sizeConfig = {
    sm: {
      spinner: 'h-5 w-5',
      text: 'text-sm',
      skeleton: 'h-4',
      progress: 'h-1'
    },
    md: {
      spinner: 'h-8 w-8',
      text: 'text-md',
      skeleton: 'h-5',
      progress: 'h-1.5'
    },
    lg: {
      spinner: 'h-12 w-12',
      text: 'text-lg',
      skeleton: 'h-6',
      progress: 'h-2'
    }
  };

  // Modern Gradient Spinner - Premium SaaS feel
  const GradientSpinner = () => (
    <div className="relative">
      <div 
        className={`${sizeConfig[size].spinner} rounded-full`}
        style={{
          background: 'conic-gradient(from 0deg, transparent, #AF54DD, #7617A7, #AF54DD, transparent)',
          animation: 'spin 1.2s linear infinite'
        }}
      >
        <div className="absolute inset-[2px] bg-white rounded-full"></div>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  // Pulse Rings - Modern and professional
  const PulseRings = () => (
    <div className="relative flex items-center justify-center">
      <div 
        className={`${sizeConfig[size].spinner} rounded-full absolute border-2 border-text-accent-purple opacity-20 animate-ping`}
        style={{ animationDuration: '1.5s' }}
      />
      <div 
        className={`${sizeConfig[size].spinner} rounded-full absolute border-2 border-text-accent-purple opacity-40 animate-ping`}
        style={{ animationDuration: '1.5s', animationDelay: '0.3s' }}
      />
      <div 
        className={`${sizeConfig[size].spinner} rounded-full bg-gradient-to-br from-[#AF54DD] to-[#7617A7]`}
      />
    </div>
  );

  // Skeleton Loader - For content loading
  const SkeletonLoader = () => (
    <div className="space-y-3 w-full">
      <div className="flex items-center gap-3">
        <div className={`${sizeConfig[size].skeleton} w-12 rounded-full bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer`} />
        <div className="flex-1 space-y-2">
          <div className={`${sizeConfig[size].skeleton} w-3/4 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer`} />
          <div className={`${sizeConfig[size].skeleton} w-1/2 rounded bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer`} />
        </div>
      </div>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .animate-shimmer {
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </div>
  );

  // Progress Bar - For loading states with progress
  const ProgressLoader = () => {
    const progressValue = progress !== null ? Math.min(100, Math.max(0, progress)) : null;
    
    return (
      <div className="w-full space-y-2">
        <div className="w-full bg-gray-100 rounded-full overflow-hidden">
          <div 
            className={`${sizeConfig[size].progress} bg-gradient-to-r from-[#AF54DD] to-[#7617A7] rounded-full transition-all duration-300 ease-out`}
            style={{ 
              width: progressValue !== null ? `${progressValue}%` : '30%',
              animation: progressValue === null ? 'pulse 1.5s ease-in-out infinite' : 'none'
            }}
          />
        </div>
        {progressValue !== null && (
          <p className={`${sizeConfig[size].text} text-text-secondary text-center`}>
            {progressValue}%
          </p>
        )}
      </div>
    );
  };

  // Wave Animation - Theme-based; use color='inverse' on danger/dark buttons
  const WaveLoader = () => (
    <div className="flex items-end gap-1">
      {[0, 1, 2, 3, 4].map((index) => (
        <div
          key={index}
          className={`w-1 rounded-t-full ${themeBarClass}`}
          style={{
            height: size === 'sm' ? '16px' : size === 'md' ? '24px' : '32px',
            animation: `wave 1.2s ease-in-out infinite`,
            animationDelay: `${index * 0.1}s`
          }}
        />
      ))}
      <style>{`
        @keyframes wave {
          0%, 40%, 100% { transform: scaleY(0.4); }
          20% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );

  // Pulse Dots - Professional and clean
  const PulseDots = () => (
    <div className="flex items-center gap-2">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={`${size === 'sm' ? 'h-2 w-2' : size === 'md' ? 'h-2.5 w-2.5' : 'h-3 w-3'} rounded-full bg-gradient-to-br from-[#AF54DD] to-[#7617A7]`}
          style={{
            animation: `pulse-dot 1.4s ease-in-out infinite`,
            animationDelay: `${index * 0.2}s`
          }}
        />
      ))}
      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { 
            transform: scale(0.8);
            opacity: 0.5;
          }
          40% { 
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );

  // Render the appropriate variant
  const renderLoader = () => {
    switch (variant) {
      case 'skeleton':
        return <SkeletonLoader />;
      case 'progress':
        return <ProgressLoader />;
      case 'pulse':
        return <PulseRings />;
      case 'wave':
        return <WaveLoader />;
      case 'spinner':
      default:
        return <GradientSpinner />;
    }
  };

  // Container classes
  const containerClasses = fullScreen
    ? 'fixed inset-0 z-50 flex items-center justify-center bg-white/95 backdrop-blur-md'
    : 'flex items-center justify-center';

  const contentClasses = text
    ? 'flex flex-col items-center justify-center gap-4'
    : 'flex items-center justify-center';

  return (
    <div className={`${containerClasses} ${className}`}>
      <div className={contentClasses}>
        {renderLoader()}
        {text && (
          <p className={`${sizeConfig[size].text} text-text-secondary font-medium`}>
            {text}
          </p>
        )}
      </div>
    </div>
  );
};

export default Loader;
