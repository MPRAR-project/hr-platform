import { ArrowRight, Briefcase, Calendar, ChevronDown, Edit3, Plus, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_LEAVE_TYPE, LEAVE_TYPES } from '../../constants/leaveTypes';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { allowanceService } from '../../services/allowanceService';
import Loader from '../ui/Loader';

const CreateAllowanceModal = ({ isOpen, onClose, onSave, onDelete, employee, existingAllowances, mode = 'add', isFetchingData = false }) => {
  const isViewMode = mode === 'view';

  // Filter out Sick Leave since it's automatically created (for 'add' mode dropdown)
  const allowanceTypes = LEAVE_TYPES.filter(type => type.value !== DEFAULT_LEAVE_TYPE);

  // Get display names of already-existing allowances (to exclude from add mode)
  const existingTypeLabels = (existingAllowances || []).map(
    a => allowanceService.getLeaveTypeDisplayName(a.leaveType)
  );

  // Check if a leave type is Sick Leave
  const isSickLeaveType = (type) => {
    if (!type) return false;
    const normalized = allowanceService.normalizeLeaveType(type);
    return normalized === 'sickleave';
  };

  const createInitialAllowances = () => {
    return [{
      id: 1,
      allowanceId: null,
      type: '',
      totalDays: '',
      validFrom: '',
      validUntil: '',
      usedDays: 0,
      isSickLeave: false
    }];
  };

  const [allowances, setAllowances] = useState(createInitialAllowances);
  const [editingIds, setEditingIds] = useState(new Set()); // Track which allowances are in edit mode (view mode)
  const [isSaving, setIsSaving] = useState(false);

  // When modal opens or existingAllowances change, seed the form
  useEffect(() => {
    if (!isOpen || !employee) return;

    if (isViewMode) {
      // View mode: show ALL existing allowances (including Sick Leave)
      if (Array.isArray(existingAllowances) && existingAllowances.length > 0) {
        const mapped = existingAllowances.map((allowance, index) => ({
          id: index + 1,
          allowanceId: allowance.id,
          type: allowanceService.getLeaveTypeDisplayName(allowance.leaveType),
          totalDays: String(allowance.totalDays ?? ''),
          validFrom: allowance.validFrom || '',
          validUntil: allowance.validUntil || '',
          usedDays: Number(allowance.usedDays) || 0,
          remainingDays: Number(allowance.remainingDays) ?? null,
          isSickLeave: isSickLeaveType(allowance.leaveType)
        }));
        setAllowances(mapped);
      } else {
        setAllowances([]);
      }
      setEditingIds(new Set()); // reset editing state
    } else {
      // Add mode: start with blank form (no existing shown)
      setAllowances(createInitialAllowances());
      setEditingIds(new Set());
    }
  }, [isOpen, employee, existingAllowances, mode]);

  const handleAddAllowance = () => {
    // Find first unused allowance type (excluding both form types AND existing types)
    const usedTypes = allowances.map(a => a.type);
    const availableType = allowanceTypes.find(
      type => !usedTypes.includes(type.label) && !existingTypeLabels.includes(type.label)
    );

    setAllowances([
      ...allowances,
      {
        id: allowances.length + 1,
        allowanceId: null,
        type: availableType?.label || '',
        totalDays: '',
        validFrom: '',
        validUntil: '',
        usedDays: 0,
        isSickLeave: false
      }
    ]);
  };

  const handleRemoveAllowance = (id) => {
    if (allowances.length <= 1) return;

    const target = allowances.find(a => a.id === id);
    // Only allow removing rows that are not yet linked to Firestore
    if (target && !target.allowanceId) {
      setAllowances(allowances.filter(allowance => allowance.id !== id));
    }
  };

  const handleAllowanceChange = (id, field, value) => {
    setAllowances(allowances.map(allowance => {
      if (allowance.id === id) {
        const updated = { ...allowance, [field]: value };
        // If validFrom is updated and it's after current validUntil, clear validUntil
        if (field === 'validFrom' && updated.validUntil && value > updated.validUntil) {
          updated.validUntil = '';
        }
        return updated;
      }
      return allowance;
    }));
  };

  const getAvailableTypes = (currentType) => {
    const usedTypes = allowances.map(a => a.type).filter(type => type !== currentType);
    return allowanceTypes.filter(
      type => !usedTypes.includes(type.label) && !existingTypeLabels.includes(type.label)
    );
  };

  const toggleEdit = (id) => {
    setEditingIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDeleteAllowance = (allowance) => {
    if (!allowance.allowanceId) return;
    if (onDelete) {
      onDelete(allowance.allowanceId, allowance.type);
    }
    // Remove from local state
    setAllowances(prev => prev.filter(a => a.id !== allowance.id));
    // Remove from editing if it was being edited
    setEditingIds(prev => {
      const next = new Set(prev);
      next.delete(allowance.id);
      return next;
    });
  };

  const handleSave = async () => {
    // Split into existing allowances to update and brand new ones to create
    const toUpdate = [];
    const toCreate = [];

    allowances.forEach(allowance => {
      const hasAnyField = allowance.type || allowance.totalDays || allowance.validFrom || allowance.validUntil;
      if (!hasAnyField) return;

      if (allowance.allowanceId && !String(allowance.allowanceId).startsWith('default-empty-') && !String(allowance.allowanceId).startsWith('virtual-')) {
        // Only include if it was being edited (view mode) or always in add mode
        if (!isViewMode || editingIds.has(allowance.id)) {
          toUpdate.push({
            allowanceId: allowance.allowanceId,
            type: allowance.type,
            totalDays: allowance.totalDays,
            validFrom: allowance.validFrom,
            validUntil: allowance.validUntil,
            usedDays: allowance.usedDays || 0
          });
        }
      } else {
        toCreate.push({
          type: allowance.type,
          totalDays: allowance.totalDays,
          validFrom: allowance.validFrom,
          validUntil: allowance.validUntil
        });
      }
    });

    setIsSaving(true);
    try {
      await onSave(toCreate, toUpdate);
      onClose();
    } catch (error) {
      console.error('Error saving allowances:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen || !employee) return null;

  const hasEditableChanges = isViewMode
    ? editingIds.size > 0
    : allowances.some(a => a.type && a.totalDays);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={isSaving ? null : onClose}></div>

      <div className="relative w-full max-w-[620px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        {/* Loading Overlay */}
        {isSaving && (
          <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm rounded-[24px] flex flex-col items-center justify-center">
            <Loader variant="spinner" size="lg" text="Saving Allowances..." />
          </div>
        )}

        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-text-primary">
                {isViewMode ? 'View Allowances' : 'Create New Allowance'}
              </h2>
              <p className="text-sm text-text-secondary mt-1">
                {isViewMode
                  ? 'View and edit existing allowances for this employee'
                  : 'Fields marked with * are required'
                }
              </p>
              {!isViewMode && (
                <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-xs text-blue-700">
                    <strong>Note:</strong> Sick Leave (25 days) is automatically created for all employees each year. You only need to manually create other allowance types.
                  </p>
                </div>
              )}
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Employee Info Card */}
          <div className="bg-background-accent-purple-light border-2 border-border-accent-purple rounded-base p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={employee?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + employee?.name}
                  alt={employee?.name}
                  className="w-12 h-12 rounded-full"
                />
                <div className="flex flex-col gap-1">
                  <h3 className="text-lg font-bold text-text-primary">{employee.name}</h3>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <span className="flex items-center gap-1 text-orange-500">
                      <Briefcase className="h-3 w-3" />
                      {employee.department || 'Development'}
                    </span>
                    <span className="flex items-center gap-1 text-blue-500">
                      <Calendar className="h-3 w-3" />
                      Hired: {employee.hireDate || '2022-03-15'}
                    </span>
                  </div>
                </div>
              </div>
              <Badge variant="info">{employee.role || 'Employee'}</Badge>
            </div>
          </div>

          {/* Allowances List */}
          <div className="space-y-4">
            {isFetchingData ? (
              <div className="flex justify-center items-center py-8">
                <Loader variant="spinner" size="md" text="Loading allowances..." />
              </div>
            ) : isViewMode && allowances.length === 0 ? (
              <div className="text-center py-8 text-text-secondary">
                <p>No allowances found for this employee.</p>
              </div>
            ) : (
              allowances.map((allowance, index) => {
                const isEditing = editingIds.has(allowance.id);
                const isSick = allowance.isSickLeave;
                const isReadOnly = isViewMode && !isEditing;

              return (
                <div
                  key={allowance.id}
                  className={`border rounded-lg p-4 space-y-4 ${
                    isSick
                      ? 'border-green-200 bg-green-50/50'
                      : isEditing
                      ? 'border-border-accent-purple bg-purple-50/30'
                      : 'border-border-secondary'
                  }`}
                >
                  {/* Header with Actions */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-md font-semibold text-text-primary">
                        {isViewMode ? allowance.type : `Allowance ${index + 1}`}
                      </h3>
                      {isSick && (
                        <Badge variant="success">Auto-created</Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {/* View mode: show Edit button for all allowances */}
                      {isViewMode && (
                        <button
                          onClick={() => toggleEdit(allowance.id)}
                          className={`flex items-center gap-1 text-sm px-3 py-1 rounded-full transition-colors ${
                            isEditing
                              ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          <Edit3 className="h-3 w-3" />
                          {isEditing ? 'Editing' : 'Edit'}
                        </button>
                      )}

                      {/* View mode: show Delete button for existing allowances (not sick leave) */}
                      {isViewMode && allowance.allowanceId && !isSick && (
                        <button
                          onClick={() => handleDeleteAllowance(allowance)}
                          className="flex items-center gap-1 text-sm px-3 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      )}

                      {/* Add mode: show remove button for new rows */}
                      {!isViewMode && allowances.length > 1 && !allowance.allowanceId && (
                        <button
                          onClick={() => handleRemoveAllowance(allowance.id)}
                          className="text-red-500 hover:text-red-700 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Show editable form OR read-only summary */}
                  <>
                    {/* View mode, not editing: show read-only summary */}
                    {isViewMode && !isEditing && (
                      <div className="grid grid-cols-3 gap-4">
                        <div className={`bg-white rounded-lg p-3 text-center border ${isSick ? 'border-green-100' : 'border-gray-100'}`}>
                          <p className="text-xs text-text-secondary mb-1">Total Days</p>
                          <p className="text-lg font-bold text-text-primary">{allowance.totalDays || 0}</p>
                        </div>
                        <div className={`bg-white rounded-lg p-3 text-center border ${isSick ? 'border-green-100' : 'border-gray-100'}`}>
                          <p className="text-xs text-text-secondary mb-1">Used Days</p>
                          <p className="text-lg font-bold text-orange-500">{allowance.usedDays || 0}</p>
                        </div>
                        <div className={`bg-white rounded-lg p-3 text-center border ${isSick ? 'border-green-100' : 'border-gray-100'}`}>
                          <p className="text-xs text-text-secondary mb-1">Remaining</p>
                          <p className={`text-lg font-bold ${(allowance.remainingDays ?? (allowance.totalDays - allowance.usedDays)) < 0 ? 'text-red-500' : 'text-green-600'}`}>
                            {allowance.remainingDays ?? (Number(allowance.totalDays || 0) - Number(allowance.usedDays || 0))}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Editable fields: shown in Add mode always, or View mode when editing */}
                    {(!isViewMode || isEditing) && (
                      <>
                        {/* Allowance Type Dropdown - only in Add mode (type is NOT editable in view mode) */}
                        {!isViewMode && (
                          <div>
                            <label className="text-sm font-medium text-text-primary mb-2 block">
                              Allowance Type
                            </label>
                            <div className="relative">
                              <select
                                value={allowance.type}
                                required
                                onChange={(e) => handleAllowanceChange(allowance.id, 'type', e.target.value)}
                                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
                              >
                                <option value="">Select allowance type</option>
                                {getAvailableTypes(allowance.type).map(type => (
                                  <option key={type.value} value={type.label}>{type.label}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
                            </div>
                          </div>
                        )}

                        {/* Total Days Allocated */}
                        <div>
                          <label className="text-sm font-medium text-text-primary mb-2 block">
                            Total Days Allocated
                          </label>
                          <div className="relative">
                            <input
                              type="number"
                              value={allowance.totalDays}
                              onChange={(e) => handleAllowanceChange(allowance.id, 'totalDays', e.target.value)}
                              placeholder="e.g., 20"
                              className="w-full h-12 px-4 pr-14 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-text-secondary">days</span>
                          </div>
                        </div>

                        {/* Valid From and Valid Until */}
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm font-medium text-text-primary mb-2 block">
                              Valid From (Optional)
                            </label>
                            <input
                              type="date"
                              value={allowance.validFrom}
                              onChange={(e) => handleAllowanceChange(allowance.id, 'validFrom', e.target.value)}
                              className="w-full h-12 px-4 border border-border-secondary rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple"
                            />
                          </div>

                          <div>
                            <label className="text-sm font-medium text-text-primary mb-2 block">
                              Valid Until (Optional)
                            </label>
                            <input
                              type="date"
                              value={allowance.validUntil}
                              min={allowance.validFrom}
                              onChange={(e) => handleAllowanceChange(allowance.id, 'validUntil', e.target.value)}
                              className="w-full h-12 px-4 border border-border-secondary rounded-lg text-sm text-text-primary focus:outline-none focus:border-border-accent-purple"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </>
                </div>
              );
            }))}
          </div>

          {/* Add More Allowance Button - only in Add mode */}
          {!isViewMode && allowances.length < (allowanceTypes.length - existingTypeLabels.length) && (
            <Button
              variant='outline-primary'
              cn="w-full h-12 flex items-center justify-center"
              onClick={handleAddAllowance}
              icon={Plus}
              iconFirst={true}
            >
              Add Another Allowance Type
            </Button>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn='col-span-1 h-12'
              disabled={isSaving}
            >
              {isViewMode ? 'Close' : 'Cancel'}
            </Button>
            {isViewMode ? (
              hasEditableChanges ? (
                <Button
                  onClick={handleSave}
                  variant='gradient'
                  cn="col-span-2 h-12 flex justify-center"
                  icon={Save}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              ) : (
                <div className="col-span-2"></div>
              )
            ) : (
              <Button
                onClick={handleSave}
                variant='gradient'
                cn="col-span-2 h-12 flex justify-center"
                icon={ArrowRight}
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Add Allowance'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateAllowanceModal;