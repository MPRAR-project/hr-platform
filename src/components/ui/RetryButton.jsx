import React, { useState } from 'react';
import { RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import Button from './Button';

/**
 * Retry button component with loading states and feedback
 */
const RetryButton = ({ 
  onRetry, 
  disabled = false, 
  variant = 'outline-primary',
  size = 'md',
  className = '',
  children = 'Retry',
  showFeedback = true,
  autoResetFeedback = true,
  resetDelay = 2000
}) => {
  const [isRetrying, setIsRetrying] = useState(false);
  const [feedback, setFeedback] = useState(null); // 'success' | 'error' | null

  const handleRetry = async () => {
    if (disabled || isRetrying || !onRetry) return;

    setIsRetrying(true);
    setFeedback(null);

    try {
      await onRetry();
      
      if (showFeedback) {
        setFeedback('success');
        
        if (autoResetFeedback) {
          setTimeout(() => {
            setFeedback(null);
          }, resetDelay);
        }
      }
    } catch (error) {
      console.error('Retry failed:', error);
      
      if (showFeedback) {
        setFeedback('error');
        
        if (autoResetFeedback) {
          setTimeout(() => {
            setFeedback(null);
          }, resetDelay);
        }
      }
    } finally {
      setIsRetrying(false);
    }
  };

  // Determine button state and appearance
  const getButtonProps = () => {
    if (feedback === 'success') {
      return {
        variant: 'success',
        icon: CheckCircle,
        disabled: true,
        children: 'Success'
      };
    }
    
    if (feedback === 'error') {
      return {
        variant: 'outline-danger',
        icon: XCircle,
        disabled: false,
        children: 'Failed - Retry'
      };
    }
    
    if (isRetrying) {
      return {
        variant,
        icon: RefreshCw,
        disabled: true,
        children: 'Retrying...',
        iconClassName: 'animate-spin'
      };
    }
    
    return {
      variant,
      icon: RefreshCw,
      disabled,
      children
    };
  };

  const buttonProps = getButtonProps();

  return (
    <Button
      {...buttonProps}
      size={size}
      className={className}
      onClick={handleRetry}
      iconFirst
    />
  );
};

/**
 * Simple retry button without feedback
 */
export const SimpleRetryButton = ({ onRetry, disabled, className = '' }) => (
  <RetryButton
    onRetry={onRetry}
    disabled={disabled}
    className={className}
    showFeedback={false}
    size="sm"
  />
);

/**
 * Retry button with custom text
 */
export const CustomRetryButton = ({ 
  onRetry, 
  disabled, 
  children, 
  variant = 'outline-primary',
  className = '' 
}) => (
  <RetryButton
    onRetry={onRetry}
    disabled={disabled}
    variant={variant}
    className={className}
    showFeedback={true}
  >
    {children}
  </RetryButton>
);

/**
 * Retry link component for inline use
 */
export const RetryLink = ({ onRetry, disabled = false, className = '' }) => {
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async (e) => {
    e.preventDefault();
    if (disabled || isRetrying || !onRetry) return;

    setIsRetrying(true);
    try {
      await onRetry();
    } catch (error) {
      console.error('Retry failed:', error);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <button
      onClick={handleRetry}
      disabled={disabled || isRetrying}
      className={`
        inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 
        disabled:text-gray-400 disabled:cursor-not-allowed
        ${className}
      `}
    >
      <RefreshCw 
        className={`h-3 w-3 ${isRetrying ? 'animate-spin' : ''}`} 
      />
      {isRetrying ? 'Retrying...' : 'Try again'}
    </button>
  );
};

export default RetryButton;