import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Reusable Input Component with Icon
 * 
 * @param {Component} icon - Lucide React icon component
 * @param {string} placeholder - Input placeholder text
 * @param {string} type - Input type (text, email, password, tel, etc.)
 * @param {string} value - Controlled input value
 * @param {function} onChange - Change handler function
 * @param {string} name - Input name attribute
 * @param {string} className - Additional CSS classes
 */
const Input = ({
  icon: Icon,
  placeholder,
  type = 'text',
  value,
  onChange,
  name,
  className = ''
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <div className={`relative ${className}`}>
      {Icon && (
        <div className="absolute left-[18px] top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
          <Icon className="h-4 w-4 text-text-secondary opacity-90" />
        </div>
      )}
      <input
        type={inputType}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full h-12 ${Icon ? 'pl-10' : 'pl-4'} ${isPassword ? 'pr-10' : 'pr-4'} border-border-secondary rounded-base text-md text-text-primary placeholder:text-text-secondary placeholder:font-medium focus:outline-none focus:border-border-accent-purple border focus:border-2 transition-colors`}
      />
      {isPassword && (
        <button
          type="button"
          onClick={togglePasswordVisibility}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary focus:outline-none"
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
};

export default Input;