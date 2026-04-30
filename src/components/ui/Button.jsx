import { div } from 'framer-motion/client';
import React from 'react';
import Loader from './Loader';

const Button = ({ children, icon: Icon, iconFirst = false, onClick, type = 'button', variant = 'gradient', cn = '', disabled, size = 'default', isLoading = false, leftIcon, rightIcon, ...props }) => {
  const baseClasses = 'flex items-center justify-center rounded-base font-semibold transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-offset-2 touch-manipulation select-none';

  const sizeClasses = {
    sm: 'px-md py-sm text-sm min-h-[32px]',
    default: 'px-lg py-md text-md min-h-[40px]',
    lg: 'px-xl py-lg text-lg min-h-[48px]'
  };

  const variants = {
    gradient: 'bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white hover:opacity-90 focus:ring-[#AF54DD] disabled:opacity-50 disabled:cursor-not-allowed',
    primary: 'bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white hover:opacity-90 focus:ring-[#AF54DD] disabled:opacity-50 disabled:cursor-not-allowed',
    secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100 focus:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed',
    danger: "bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed",
    success: "bg-green-500 hover:bg-green-600 text-white focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed",
    'outline-danger': 'border border-border-accent-red text-text-accent-red hover:bg-background-accent-red focus:ring-border-accent-red disabled:opacity-50 disabled:cursor-not-allowed',
    'outline-success': 'border border-border-accent-green text-text-accent-green hover:bg-background-accent-green focus:ring-border-accent-green  disabled:opacity-50 disabled:cursor-not-allowed',
    'outline-primary': 'border border-border-accent-purple text-text-accent-purple hover:bg-background-accent-purple focus:ring-border-accent-purple disabled:opacity-50 disabled:cursor-not-allowed',
    'solid-success': 'bg-text-accent-green text-white hover:opacity-90 focus:ring-text-accent-green disabled:opacity-50 disabled:cursor-not-allowed',
    'solid-danger': 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed',
    'outline-secondary': 'border border-gray-300 text-gray-700 hover:bg-gray-100 focus:ring-gray-300 disabled:opacity-50 disabled:cursor-not-allowed',
  };

  const iconVariant = {
    gradient: 'bg-white mx-2 text-text-accent-purple',
    primary: 'bg-white mx-2 text-text-accent-purple',
    secondary: 'bg-white mx-2 text-text-secondary',
    danger: 'bg-white mx-2 text-text-accent-red',
    success: 'bg-white text-text-accent-green mx-2',
    'outline-danger': 'bg-transparent text-text-accent-red',
    'outline-success': 'bg-transparent text-text-accent-green',
    'outline-primary': 'bg-transparent text-text-accent-purple',
    'outline-secondary': 'bg-transparent text-text-secondary',
    'solid-success': 'bg-transparent text-white',
    'solid-danger': 'bg-transparent text-white',
  };

  const isDisabled = disabled || isLoading;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`flex ${iconFirst ? "flex-row" : "flex-row-reverse"} ${baseClasses} ${sizeClasses[size]} ${variants[variant]} ${cn}`}
      {...props}
    >
      {isLoading ? (
        <div className="mr-2">
          <Loader variant="spinner" size="sm" />
        </div>
      ) : (
        Icon && <div className={` p-1 rounded-full ${iconVariant[variant]}`}>
          <Icon className=" h-4 w-4" />
        </div>
      )}
      {children}
    </button>
  );
};

export default Button;