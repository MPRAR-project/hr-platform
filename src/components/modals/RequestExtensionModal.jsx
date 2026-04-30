import React, { useState } from 'react';
import { X, Calendar, ArrowRight } from 'lucide-react';
import { toast } from 'react-toastify';
import Button from '../ui/Button';

const RequestExtensionModal = ({ isOpen, onClose, assignment, employee, onSubmit }) => {
  const [formData, setFormData] = useState({
    requestedDueDate: '',
    justification: '',
    reason: 'workload'
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    // Validate required fields
    if (!formData.requestedDueDate) {
      toast.error('Please select a new due date');
      return;
    }
    if (!formData.justification.trim()) {
      toast.error('Please provide justification for the extension');
      return;
    }

    // Validate new due date is after current due date
    const dueDateValue = assignment.dueDate || assignment.due;
    const currentDueDate = dueDateValue?.toDate ? dueDateValue.toDate() : new Date(dueDateValue);
    const requestedDate = new Date(formData.requestedDueDate);
    
    if (requestedDate <= currentDueDate) {
      toast.error('New due date must be after the current due date');
      return;
    }

    // Validate extension is reasonable (not more than 90 days)
    const daysDifference = Math.ceil((requestedDate - currentDueDate) / (1000 * 60 * 60 * 24));
    if (daysDifference > 90) {
      toast.error('Extension cannot be more than 90 days from the current due date');
      return;
    }

    setLoading(true);
    try {
      if (onSubmit) {
        await onSubmit({
          assignmentId: assignment.id || assignment.assignmentId,
          currentDueDate: assignment.dueDate || assignment.due,
          requestedDueDate: formData.requestedDueDate,
          reason: formData.reason,
          justification: formData.justification,
          employeeId: assignment.userId || assignment.employeeId,
          trainingName: assignment.training?.name || assignment.name || 'Unknown Training'
        });
      }
      
      // Reset form and close modal
      setFormData({
        requestedDueDate: '',
        justification: '',
        reason: 'workload'
      });
      onClose();
    } catch (error) {
      console.error('Error submitting extension request:', error);
      toast.error('Failed to submit extension request. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Calculate minimum date (tomorrow)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split('T')[0];

  // Calculate current due date for display
  const dueDateValue = assignment?.dueDate || assignment?.due;
  const currentDueDate = dueDateValue?.toDate ? dueDateValue.toDate() : new Date(dueDateValue);
  const formattedCurrentDue = currentDueDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  if (!isOpen || !assignment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>
      
      <div className="relative w-full max-w-[540px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-text-primary">Request Extension</h2>
              <p className="text-sm text-text-secondary mt-1">
                Request a deadline extension for "{assignment.training?.name || 'Training'}"
              </p>
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Current Due Date Info */}
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-medium text-orange-800">Current Due Date</span>
            </div>
            <p className="text-orange-700">{formattedCurrentDue}</p>
          </div>

          {/* Extension Reason */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Reason for Extension *
            </label>
            <select
              value={formData.reason}
              onChange={(e) => handleChange('reason', e.target.value)}
              className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
            >
              <option value="workload">Heavy workload / Time constraints</option>
              <option value="technical">Technical issues / System problems</option>
              <option value="medical">Medical leave / Health issues</option>
              <option value="travel">Business travel / Off-site work</option>
              <option value="training">Waiting for prerequisite training</option>
              <option value="resources">Lack of required resources</option>
              <option value="other">Other (please specify in justification)</option>
            </select>
          </div>

          {/* New Due Date */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Requested New Due Date *
            </label>
            <input
              type="date"
              value={formData.requestedDueDate}
              onChange={(e) => handleChange('requestedDueDate', e.target.value)}
              min={minDate}
              className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
            />
            <p className="text-xs text-text-secondary mt-1">
              Maximum extension: 90 days from current due date
            </p>
          </div>

          {/* Justification */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Justification *
            </label>
            <textarea
              value={formData.justification}
              onChange={(e) => handleChange('justification', e.target.value)}
              placeholder="Please provide a detailed explanation for why you need this extension..."
              rows="4"
              maxLength="500"
              className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-accent-purple"
            ></textarea>
            <p className="text-xs text-text-secondary mt-1">
              {formData.justification.length}/500 characters
            </p>
          </div>

          {/* Info Note */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> Your extension request will be reviewed by your manager or HR team. 
              You will be notified of the decision via email. Please continue working on the training 
              while your request is being processed.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              className="col-span-1 h-12"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant='gradient'
              cn="col-span-2 h-12 flex justify-center"
              icon={ArrowRight}
              disabled={loading}
            >
              <span>{loading ? 'Submitting...' : 'Submit Request'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RequestExtensionModal;