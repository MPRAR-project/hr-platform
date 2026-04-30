import React from 'react';
import { Search } from 'lucide-react';

const SearchInput = ({ placeholder, ...props }) => {
  return (
    <div className="flex items-center gap-md border border-border-secondary rounded-full px-xl py-lg w-[260px]">
      <Search className="h-4 w-4 text-text-secondary" />
      <input
        type="text"
        placeholder={placeholder}
        className="w-full bg-transparent focus:outline-none text-base font-bold text-text-secondary placeholder:text-text-secondary"
        {...props}
      />
    </div>
  );
};

export default SearchInput;