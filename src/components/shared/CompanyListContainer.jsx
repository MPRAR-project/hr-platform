import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import SearchInput from '../ui/SearchInput';
import CompanyCard from './CompanyCard';

const CompanyListContainer = ({ companies }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All States');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filterOptions = ['All States', 'Active', 'Inactive', 'Suspended'];

  const filteredCompanies = useMemo(() => {
    let result = companies;

    if (statusFilter !== 'All States') {
      result = result.filter(company =>
        (company.status || '').toLowerCase() === statusFilter.toLowerCase()
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((company) => {
        const name = (company.name || '').toLowerCase();
        const email = (company.email || '').toLowerCase();
        return name.includes(q) || email.includes(q);
      });
    }

    return result;
  }, [companies, searchQuery, statusFilter]);

  return (
    // Main container styles from your CSS, mapped to our theme
    <div className="bg-white p-4 sm:p-4xl rounded-base shadow-lg flex flex-col gap-xl">
      {/* Top section with search and filters */}
      <div className="flex justify-between items-center flex-wrap gap-md">
        <SearchInput
          placeholder="Search by company name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="flex items-center gap-lg relative" ref={dropdownRef}>
          <span className="text-md font-bold text-text-secondary">Filtered by:</span>
          <div
            className="flex items-center gap-sm border border-border-neutral rounded-full px-2xl py-md cursor-pointer hover:bg-bg-secondary transition-colors"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <span className="text-base font-bold text-text-secondary">{statusFilter}</span>
            <ChevronDown className={`h-5 w-5 text-text-secondary transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
          </div>

          {isDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-border-neutral rounded-lg shadow-lg z-50 overflow-hidden">
              {filterOptions.map((option) => (
                <div
                  key={option}
                  className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-bg-secondary transition-colors group"
                  onClick={() => {
                    setStatusFilter(option);
                    setIsDropdownOpen(false);
                  }}
                >
                  <span className={`text-sm font-medium ${statusFilter === option ? 'text-text-primary absolute_active_state font-bold' : 'text-text-secondary group-hover:text-text-primary'}`}>
                    {option}
                  </span>
                  {statusFilter === option && (
                    <Check className="h-4 w-4 text-purple-600" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* List of Company Cards */}
      <div className="space-y-md">
        {filteredCompanies.length > 0 ? (
          filteredCompanies.map((company, index) => (
            <CompanyCard key={company.id ?? index} company={company} />
          ))
        ) : (
          <div className="text-center py-8 text-text-secondary bg-bg-secondary rounded-lg border border-dashed border-border-neutral">
            No companies found matching the current filters.
          </div>
        )}
      </div>
    </div>
  );
};

export default CompanyListContainer;