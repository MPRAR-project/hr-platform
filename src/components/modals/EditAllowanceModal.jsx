import React, { useState } from 'react';
import { X, ArrowRight, Briefcase, Calendar, CreditCard, Save } from 'lucide-react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { useAuth } from '../../hooks/useAuth';

const EditAllowanceModal = ({ isOpen, onClose, onSave, employee, allowance }) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    totalDays: allowance?.total || allowance?.totalDays || 0,
    notes: ''
  });

  const [loading, setLoading] = useState(false);

  // Update form data when allowance prop changes
  React.useEffect(() => {
    if (allowance) {
      setFormData({
        totalDays: allowance.total || allowance.totalDays || 0,
        notes: ''
      });
    }
  }, [allowance]);

  // Use real audit trail from allowance object, fallback to empty array
  const auditTrail = allowance?.rawData?.auditTrail || allowance?.auditTrail || [];

  const handleSave = async () => {
    if (!allowance?.id) {
      console.error('No allowance ID provided');
      return;
    }

    try {
      setLoading(true);

      // Calculate the difference in total days
      const oldTotal = allowance.total || allowance.totalDays || 0;
      const newTotal = parseInt(formData.totalDays) || 0;
      const difference = newTotal - oldTotal;

      // Calculate new remaining days
      const usedDays = allowance.used || allowance.usedDays || 0;
      const newRemainingDays = newTotal - usedDays;

      // Create new audit entry
      const auditEntry = {
        action: 'Manual Adjustment',
        details: difference === 0
          ? 'Updated notes'
          : `${difference > 0 ? '+' : ''}${difference} days ${difference > 0 ? 'added' : 'removed'}`,
        date: new Date().toISOString(),
        performedBy: user?.uid,
        performedByName: user?.displayName || user?.email || 'Unknown',
        performedByRole: user?.role || 'Unknown'
      };

      const updateData = {
        totalDays: newTotal,
        remainingDays: newRemainingDays,
        notes: formData.notes,
        auditEntry // Pass this to service to handle arrayUnion
      };

      await onSave(allowance.id, updateData);
      onClose();
    } catch (error) {
      console.error('Error saving allowance:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[880px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-text-primary">Employee Allowances</h2>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Employee Info Card */}
          <div className="bg-background-accent-purple-light border-2 border-border-accent-purple rounded-base p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <img
                  src={employee?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(employee?.name || 'User')}`}
                  alt={employee?.name}
                  className="w-12 h-12 rounded-full"
                />
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-bold text-text-primary">{employee?.name}</h3>
                  <div className="flex flex-wrap items-center gap-4 text-xs">
                    <span className="flex items-center gap-1 text-orange-500">
                      <Briefcase className="h-3 w-3" />
                      {employee?.department || 'N/A'}
                    </span>
                    <span className="flex items-center gap-1 text-blue-500">
                      <Calendar className="h-3 w-3" />
                      Hired: {employee?.hireDate || 'N/A'}
                    </span>
                    <span className="flex items-center gap-1 text-green-500">
                      <CreditCard className="h-3 w-3" />
                      Employee ID: {employee?.employeeId || employee?.id || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
              <Badge variant="info">{employee?.role || 'Employee'}</Badge>
            </div>
          </div>

          {/* Allowance Type */}
          <div className="flex items-center gap-3 p-4 bg-pink-50 rounded-lg">
            <div className="w-10 h-10 bg-pink-100 rounded-full flex items-center justify-center">
              {allowance?.icon || <Calendar className="h-5 w-5 text-pink-500" />}
            </div>
            <h3 className="text-lg font-semibold text-text-primary">{allowance?.name || allowance?.leaveType || 'Allowance'}</h3>
          </div>

          {/* Allowance Stats */}
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-sm text-text-secondary mb-2">Total Days:</p>
              <p className="text-3xl font-bold text-blue-500">{allowance?.total || allowance?.totalDays || 0}</p>
            </div>
            <div>
              <p className="text-sm text-text-secondary mb-2">Used Days:</p>
              <p className={`text-3xl font-bold ${(allowance?.isOverused) ? 'text-red-600' : 'text-red-500'}`}>
                {allowance?.used || allowance?.usedDays || 0}
              </p>
            </div>
            <div>
              <p className="text-sm text-text-secondary mb-2">
                {allowance?.isOverused ? 'Overused:' : 'Remaining:'}
              </p>
              <p className={`text-3xl font-bold ${allowance?.isOverused ? 'text-red-600' : 'text-green-500'}`}>
                {allowance?.isOverused
                  ? (allowance?.overuseAmount || 0)
                  : (allowance?.remaining || allowance?.remainingDays || 0)
                }
              </p>
            </div>
          </div>

          {/* Usage Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">
                {allowance?.isOverused ? 'Overuse Progress' : 'Usage Progress'}
              </span>
              <span className={`font-semibold ${allowance?.isOverused ? 'text-red-600' : 'text-text-primary'}`}>
                {allowance?.progress || 0}%
              </span>
            </div>
            <div className="w-full h-2 bg-background-secondary rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${allowance?.isOverused
                  ? 'bg-red-500 animate-pulse'
                  : (allowance?.progress > 80 ? 'bg-red-500' : allowance?.progress > 60 ? 'bg-yellow-500' : 'bg-green-500')
                  }`}
                style={{ width: `${Math.min(allowance?.progress || 0, 100)}%` }}
              ></div>
            </div>
            {allowance?.isOverused && (
              <div className="text-xs text-red-600 text-center font-medium">
                Exceeded allowance limit
              </div>
            )}
          </div>

          {/* Total Allowance */}
          <div>
            <label className="text-md font-semibold text-text-primary mb-3 block">Total Allowance</label>
            <div className="flex sm:flex-row flex-col sm:items-center items-start gap-3">
              <div className='flex gap-2 items-center w-full'>
                <input
                  type="number"
                  min="0"
                  value={formData.totalDays}
                  onChange={(e) => setFormData({ ...formData, totalDays: parseInt(e.target.value) || 0 })}
                  placeholder="Enter total days"
                  className="flex-1 w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                />
                <span className="text-text-secondary">Days</span>
              </div>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, totalDays: formData.totalDays + 1 })}
                className="px-4 w-full h-12 py-2 border border-border-accent-purple text-text-accent-purple rounded-base text-sm font-medium hover:bg-background-accent-purple-light transition-colors"
              >
                +1 Day
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-md font-semibold text-text-primary mb-3 block">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Add a note (e.g., 'added a day for bank holiday 05/07/2025')"
              rows="3"
              className="w-full px-4 py-3 border border-border-secondary rounded-lg text-sm text-text-secondary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-accent-purple"
            ></textarea>
          </div>

          {/* Audit Trail */}
          <div>
            <h4 className="text-md font-semibold text-text-primary mb-3">Audit Trail</h4>
            <div className="space-y-3">
              {auditTrail.length > 0 ? (
                // Sort by date descending (newest first)
                [...auditTrail].sort((a, b) => new Date(b.date) - new Date(a.date)).map((entry, index) => (
                  <div key={index} className="p-4 bg-background-secondary rounded-lg">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-col">
                        <h5 className="font-semibold text-text-primary text-sm">{entry.action}</h5>
                        <span className="text-xs text-text-secondary mt-1">
                          by {entry.performedByName} <span className="opacity-70">({entry.performedByRole})</span>
                        </span>
                      </div>
                      <span className="text-xs text-text-secondary">
                        {entry.date ? new Date(entry.date).toLocaleDateString() + ' ' + new Date(entry.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Unknown Date'}
                      </span>
                    </div>
                    <p className="text-xs text-text-primary font-medium">{entry.details}</p>
                  </div>
                ))) : (
                <div className="text-center py-4 text-text-secondary text-sm">No audit history available</div>
              )}
            </div>
          </div>

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
              cn="col-span-2 h-12 flex justify-center"
              icon={Save}
              iconFirst={true}
              disabled={loading}
            >
              <span>{loading ? 'Saving...' : 'Save Changes'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditAllowanceModal;