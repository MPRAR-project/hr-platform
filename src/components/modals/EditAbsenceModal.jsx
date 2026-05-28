import React, { useState, useEffect } from 'react';
import { X, ArrowRight, ChevronDown, Save } from 'lucide-react';
import Button from '../ui/Button';
import { ADMIN_LEAVE_TYPES, DEFAULT_LEAVE_TYPE, LEAVE_TYPES } from '../../constants/leaveTypes';
import { formatToISODate } from '../../utils/safeDateParse';
import { allowanceService } from '../../services/allowanceService';
import Loader from '../ui/Loader';

const EditAbsenceModal = ({ isOpen, onClose, onSave, absence }) => {
  const [formData, setFormData] = useState({
    leaveType: absence?.leaveType || absence?.leave || DEFAULT_LEAVE_TYPE,
    reason: absence?.reason || '',
    startingDate: formatToISODate(absence?.startDate || absence?.startingDate || ''),
    endingDate: formatToISODate(absence?.endDate || absence?.endingDate || '')
  });

  const [userAllowances, setUserAllowances] = useState([]);
  const [loadingAllowances, setLoadingAllowances] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Update form data when absence prop changes
  useEffect(() => {
    if (absence) {
      setFormData({
        leaveType: absence.leaveType || absence.leave || DEFAULT_LEAVE_TYPE,
        reason: absence.reason || '',
        startingDate: formatToISODate(absence.startDate || absence.startingDate || ''),
        endingDate: formatToISODate(absence.endDate || absence.endingDate || '')
      });
      fetchUserAllowances(absence.userId || absence.employeeId);
    }
  }, [absence]);

  const fetchUserAllowances = async (userId) => {
    if (!userId) return;
    setLoadingAllowances(true);
    try {
      const allowances = await allowanceService.getEmployeeAllowances(
        userId, 
        { userId }, 
        new Date().getFullYear()
      );
      setUserAllowances(allowances);
    } catch (error) {
      console.error('Error fetching user allowances:', error);
      setUserAllowances([]);
    } finally {
      setLoadingAllowances(false);
    }
  };

  const oldStartingDate = formatToISODate(absence?.startDate || absence?.startingDate || '');
  const oldEndingDate = formatToISODate(absence?.endDate || absence?.endingDate || '');
  const oldRequestedDays = (oldStartingDate && oldEndingDate) 
    ? allowanceService.calculateDaysFromDates(oldStartingDate, oldEndingDate) 
    : 0;

  const selectedAllowance = userAllowances.find(a => 
    allowanceService.normalizeLeaveType(a.leaveType) === allowanceService.normalizeLeaveType(formData.leaveType) ||
    a.leaveType === formData.leaveType
  );

  const remainingDays = selectedAllowance ? (Number(selectedAllowance.remainingDays) || 0) : 0;
  
  // Calculate newly requested days
  const newRequestedDays = (formData.startingDate && formData.endingDate) 
    ? allowanceService.calculateDaysFromDates(formData.startingDate, formData.endingDate) 
    : 0;

  // If the leave type remains the same, we conceptually add back the 'old' duration to the 'remaining' pool before subtracting the 'new' duration.
  // We disable if the net increase in days exceeds the available remaining balance.
  const isSameLeaveType = allowanceService.normalizeLeaveType(formData.leaveType) === allowanceService.normalizeLeaveType(absence?.leaveType || absence?.leave);
  const effectiveRemainingDays = isSameLeaveType ? remainingDays + oldRequestedDays : remainingDays;
  const isExceedingAllowance = formData.leaveType && selectedAllowance && newRequestedDays > effectiveRemainingDays;

  const handleSave = async () => {
    setErrorMsg('');
    if (!formData.leaveType || !formData.startingDate || !formData.endingDate) {
      setErrorMsg('Please fill in all required fields.');
      return;
    }

    if (isExceedingAllowance) {
      setErrorMsg(`You are requesting ${newRequestedDays} days, but only have ${effectiveRemainingDays} days available for this type.`);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(formData);
      setErrorMsg('');
      onClose();
    } catch (error) {
      console.error('Error saving absence:', error);
      setErrorMsg(error.message || 'Failed to save changes. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={isSaving ? null : onClose}></div>

      <div className="relative w-full max-w-[500px] max-h-[90vh] overflow-y-auto scrollbar-custom bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6">
        {/* Loading Overlay */}
        {isSaving && (
          <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm rounded-[24px] flex flex-col items-center justify-center">
            <Loader variant="spinner" size="lg" text="Saving Changes..." />
          </div>
        )}

        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-text-primary">Edit Absence</h2>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Leave Type Dropdown */}
          <div>
            <label className="text-md font-semibold text-text-primary mb-3 block">Leave Type</label>
            <div className="relative">
              <select
                value={formData.leaveType}
                onChange={(e) => {
                  setErrorMsg('');
                  setFormData({ ...formData, leaveType: e.target.value });
                }}
                disabled={loadingAllowances}
                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple disabled:bg-gray-50"
              >
                {loadingAllowances ? (
                  <option value="" disabled>Loading available leave types...</option>
                ) : (
                  userAllowances.map(allowance => {
                    const leaveTypeConfig = LEAVE_TYPES.find(type => 
                      type.label === allowance.leaveType || 
                      allowanceService.getLeaveTypeDisplayName(allowance.leaveType) === type.label
                    );
                    const typeValue = leaveTypeConfig?.value || allowance.leaveType;
                    const typeLabel = allowanceService.getLeaveTypeDisplayName(allowance.leaveType);
                    
                    return (
                      <option key={allowance.id || typeValue} value={typeValue}>
                        {typeLabel}
                      </option>
                    );
                  })
                )}
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="text-md font-semibold text-text-primary mb-3 block">Reason</label>
            <input
              type="text"
              value={formData.reason}
              onChange={(e) => {
                setErrorMsg('');
                setFormData({ ...formData, reason: e.target.value });
              }}
              placeholder="Fever"
              className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
            />
          </div>

          {/* Starting and Ending Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">Starting Date</label>
              <input
                type="date"
                value={formData.startingDate}
                onChange={(e) => {
                  const newDate = e.target.value;
                  setErrorMsg('');
                  setFormData(prev => ({
                    ...prev,
                    startingDate: newDate,
                    endingDate: prev.endingDate && newDate && prev.endingDate < newDate ? '' : prev.endingDate
                  }));
                }}
                placeholder="DD-MM-YYYY"
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
              />
            </div>

            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">Ending Date</label>
              <input
                type="date"
                value={formData.endingDate}
                min={formData.startingDate}
                onChange={(e) => {
                  setErrorMsg('');
                  setFormData({ ...formData, endingDate: e.target.value });
                }}
                placeholder="DD-MM-YYYY"
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
              />
            </div>
          </div>

          {/* Allowance Status */}
          {formData.leaveType && selectedAllowance && (
            <div className={`p-4 rounded-lg border flex flex-col gap-1 ${
              isExceedingAllowance ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-text-primary">Effective Available (including this absence):</span>
                <span className="font-bold">{effectiveRemainingDays} days</span>
              </div>
              {newRequestedDays > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-text-primary">New Requested:</span>
                  <span className={`font-bold ${isExceedingAllowance ? 'text-red-600' : 'text-green-700'}`}>
                    {newRequestedDays} days
                  </span>
                </div>
              )}
              {isExceedingAllowance && (
                <p className="text-xs text-red-600 mt-1 font-medium">
                  You are changing the dates to request more days than available.
                </p>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm font-medium">
              {errorMsg}
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn='col-span-1 h-12'
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              variant='gradient'
              cn="col-span-2 h-12 "
              iconFirst={true}
              icon={Save}
              disabled={loadingAllowances || isExceedingAllowance || isSaving}
            >
              <span>{isSaving ? 'Saving...' : loadingAllowances ? 'Loading...' : 'Save Changes'}</span>

            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditAbsenceModal;