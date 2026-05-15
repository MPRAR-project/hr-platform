import React, { useEffect, useState, useMemo } from 'react';
import { fetchAllCompanies, updateWeekStartConfig } from '../../services/superAdminService';
import Header from '../../components/layout/Header';
import Button from '../../components/ui/Button';
import { useAuth } from '../../hooks/useAuth';
import { WEEKDAY_CODES_LIST, normalizeWeekStartDay, DEFAULT_WEEK_START_DAY } from '../../utils/weekStartUtils';
import { toast } from 'react-toastify';
import { invalidateWeekStartCaches } from '../../services/weekStartConfig';

const MAX_BATCH_SIZE = 400;

const createSelectableWeekdays = () =>
  WEEKDAY_CODES_LIST.map((day) => ({
    value: day,
    label: day.charAt(0).toUpperCase() + day.slice(1),
  }));

const WeekStartHelper = () => {
  const { user } = useAuth();
  const [companies, setCompanies] = useState([]);
  const [formState, setFormState] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [savingCompanyId, setSavingCompanyId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const weekdayOptions = useMemo(() => createSelectableWeekdays(), []);

  const canAccess = useMemo(() => {
    if (!user) return false;
    const allowedRoles = ['superUser', 'adminManager', 'hrManager'];
    return allowedRoles.includes(user.role);
  }, [user]);

  useEffect(() => {
    const loadCompanies = async () => {
      setIsLoading(true);
      try {
        const loaded = await fetchAllCompanies();
        setCompanies(loaded);

        const initialState = loaded.reduce((acc, company) => {
          const normalized = normalizeWeekStartDay(company.weekStartDay);
          acc[company.id] = {
            weekStartDay: normalized,
            propagateUsers: true,
            propagateSites: false,
          };
          return acc;
        }, {});
        setFormState(initialState);
      } catch (error) {
        console.error('[WeekStartHelper] Failed to load companies via REST', error);
        toast.error('Failed to load companies');
      } finally {
        setIsLoading(false);
      }
    };

    if (canAccess) {
      loadCompanies();
    } else {
      setIsLoading(false);
    }
  }, [canAccess]);

  const handleSelectChange = (companyId, value) => {
    setFormState((prev) => ({
      ...prev,
      [companyId]: {
        ...prev[companyId],
        weekStartDay: normalizeWeekStartDay(value),
      },
    }));
  };

  const handleToggle = (companyId, key) => {
    setFormState((prev) => ({
      ...prev,
      [companyId]: {
        ...prev[companyId],
        [key]: !prev[companyId]?.[key],
      },
    }));
  };


  const handleSave = async (company) => {
    const state = formState[company.id];
    if (!state) return;

    const normalizedDay = normalizeWeekStartDay(state.weekStartDay) || DEFAULT_WEEK_START_DAY;

    setSavingCompanyId(company.id);
    try {
      await updateWeekStartConfig(company.id, {
        weekStartDay: normalizedDay,
        propagateUsers: state.propagateUsers,
        propagateSites: state.propagateSites
      });

      invalidateWeekStartCaches(`companies/${company.id}`);
      toast.success(`Updated week start for ${company.name || company.id}`);
    } catch (error) {
      console.error('[WeekStartHelper] Failed to update week start via REST', error);
      toast.error(`Failed to update ${company.name || company.id}: ${error.message || 'Unknown error'}`);
    } finally {
      setSavingCompanyId(null);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const refreshed = await fetchAllCompanies();
      setCompanies(refreshed);
      const refreshedState = refreshed.reduce((acc, company) => {
        const normalized = normalizeWeekStartDay(company.weekStartDay);
        acc[company.id] = {
          weekStartDay: normalized,
          propagateUsers: formState[company.id]?.propagateUsers ?? true,
          propagateSites: formState[company.id]?.propagateSites ?? false,
        };
        return acc;
      }, {});
      setFormState(refreshedState);
    } catch (error) {
      toast.error('Failed to refresh companies');
    } finally {
      setRefreshing(false);
    }
  };

  if (!canAccess) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <Header title="Week Start Helper" subtitle="Manage week start preferences" />
        <div className="flex-1 p-6 flex items-center justify-center">
          <div className="text-center space-y-2">
            <h2 className="text-xl font-semibold text-text-primary">Access Restricted</h2>
            <p className="text-text-secondary text-sm">
              This tool is available only to Super Users, Admin Managers, or HR Managers.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title="Week Start Helper"
        subtitle="Backfill and manage week start preferences for existing companies, sites, and users"
      />

      <div className="flex-1 overflow-y-auto p-3xl space-y-4 scrollbar-custom">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Companies</h2>
            <p className="text-sm text-text-secondary">
              Set the preferred week starting day for each company. Optionally backfill existing users and sites.
            </p>
          </div>
          <Button
            variant="outline-primary"
            onClick={handleRefresh}
            disabled={isLoading || refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {companies.map((company) => {
              const state = formState[company.id] || {
                weekStartDay: DEFAULT_WEEK_START_DAY,
                propagateUsers: true,
                propagateSites: false,
              };

              return (
                <div
                  key={company.id}
                  className="border border-border-secondary rounded-lg p-6 bg-white shadow-sm space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-semibold text-text-primary">
                        {company.name || `Company ${company.id}`}
                      </h3>
                      <p className="text-sm text-text-secondary">
                        Current setting: {company.weekStartDay ? company.weekStartDay : 'Not set (defaults to Monday)'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="text-sm font-medium text-text-primary">Week Starting</label>
                      <select
                        value={state.weekStartDay}
                        onChange={(e) => handleSelectChange(company.id, e.target.value)}
                        className="h-10 px-4 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                      >
                        {weekdayOptions.map((option) => (
                          <option key={`${company.id}-${option.value}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={state.propagateUsers}
                        onChange={() => handleToggle(company.id, 'propagateUsers')}
                        className="h-4 w-4 rounded border border-border-secondary text-purple-600 focus:ring-2 focus:ring-purple-200"
                      />
                      Backfill `users` weekStartDay field
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={state.propagateSites}
                        onChange={() => handleToggle(company.id, 'propagateSites')}
                        className="h-4 w-4 rounded border border-border-secondary text-purple-600 focus:ring-2 focus:ring-purple-200"
                      />
                      Update associated `sites` documents
                    </label>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="solid-primary"
                      onClick={() => handleSave(company)}
                      disabled={savingCompanyId === company.id}
                    >
                      {savingCompanyId === company.id ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              );
            })}

            {companies.length === 0 && (
              <div className="text-center py-12 text-text-secondary">
                No companies found.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WeekStartHelper;

