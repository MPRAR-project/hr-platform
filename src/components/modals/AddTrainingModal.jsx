import React, { useState, useEffect } from 'react';
import { X, ArrowRight, ChevronDown } from 'lucide-react';
import { toast } from 'react-toastify';
import Button from '../ui/Button';

const AddTrainingModal = ({ isOpen, onClose, employee, onAdd, training = null }) => {
  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayDate = getTodayDate();

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    assignmentDate: todayDate, // Today's date
    dueDate: '',
    expiryDate: '',
    trainingType: 'Technical'
  });

  const [loading, setLoading] = useState(false);

  // Initialize form data when training prop changes (for editing)
  useEffect(() => {
    if (training) {
      setFormData({
        name: training.name || '',
        description: training.description || '',
        assignmentDate: training.assignmentDate || todayDate,
        dueDate: training.dueDate || '',
        expiryDate: training.expiryDate || '',
        trainingType: training.trainingType || training.category || 'Technical'
      });
    } else {
      // Reset form for new training
      setFormData({
        name: '',
        description: '',
        assignmentDate: todayDate,
        dueDate: '',
        expiryDate: '',
        trainingType: 'Technical'
      });
    }
  }, [training, isOpen]);

  const handleSubmit = async () => {
    // Validate required fields
    if (!formData.name.trim()) {
      toast.error('Training name is required');
      return;
    }
    
    // Check if training name contains numbers
    if (/[0-9]/.test(formData.name)) {
      toast.error('Training name cannot contain numbers. Only alphabetic characters and special symbols are allowed.');
      return;
    }
    
    if (!formData.description.trim()) {
      toast.error('Description is required');
      return;
    }
    if (!formData.assignmentDate) {
      toast.error('Assignment date is required');
      return;
    }
    if (!formData.dueDate) {
      toast.error('Due date is required');
      return;
    }
    if (!formData.expiryDate) {
      toast.error('Expiry date is required');
      return;
    }

    // Validate date logic
    const assignmentDate = new Date(formData.assignmentDate);
    const dueDate = new Date(formData.dueDate);
    const expiryDate = new Date(formData.expiryDate);

    if (dueDate <= assignmentDate) {
      toast.error('Due date must be after assignment date');
      return;
    }
    if (expiryDate <= dueDate) {
      toast.error('Expiry date must be after due date');
      return;
    }

    setLoading(true);
    try {
      if (onAdd) {
        await onAdd(formData);
      }
    } catch (error) {
      console.error('Error submitting training:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field, value) => {
    // Validate training name to only allow alphabetic characters and special characters
    if (field === 'name') {
      // Remove numbers from the input
      const sanitizedValue = value.replace(/[0-9]/g, '');
      
      // Show warning if numbers were removed
      if (value !== sanitizedValue && sanitizedValue.length > 0) {
        toast.warning('Numbers are not allowed in training name');
      }
      
      setFormData(prev => {
        const updatedData = { ...prev, [field]: sanitizedValue };

        // If assignment date changes, reset due date and expiry date if they become invalid
        if (field === 'assignmentDate') {
          if (prev.dueDate && value && prev.dueDate < value) {
            updatedData.dueDate = '';
            updatedData.expiryDate = '';
          } else if (prev.expiryDate && prev.dueDate && prev.expiryDate < prev.dueDate) {
            updatedData.expiryDate = '';
          }
        }

        // If due date changes, reset expiry date if it becomes invalid
        if (field === 'dueDate') {
          if (prev.expiryDate && value && prev.expiryDate < value) {
            updatedData.expiryDate = '';
          }
        }

        return updatedData;
      });
    } else {
      setFormData(prev => {
        const updatedData = { ...prev, [field]: value };

        // If assignment date changes, reset due date and expiry date if they become invalid
        if (field === 'assignmentDate') {
          if (prev.dueDate && value && prev.dueDate < value) {
            updatedData.dueDate = '';
            updatedData.expiryDate = '';
          } else if (prev.expiryDate && prev.dueDate && prev.expiryDate < prev.dueDate) {
            updatedData.expiryDate = '';
          }
        }

        // If due date changes, reset expiry date if it becomes invalid
        if (field === 'dueDate') {
          if (prev.expiryDate && value && prev.expiryDate < value) {
            updatedData.expiryDate = '';
          }
        }

        return updatedData;
      });
    }
  };

  if (!isOpen || !employee) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[540px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-text-primary">
              {training ? `Edit Training for ${employee?.name}` : `Add Training for ${employee?.name}`}
            </h2>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Training Name */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Training Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              placeholder="Enter training name..."
              pattern="[A-Za-z\s\-\_\.\/\,\!\?\:\;\(\)\[\]\{\}]+"
              title="Only alphabetic characters and special symbols are allowed (no numbers)"
              className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Description *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleChange('description', e.target.value)}
              placeholder="Enter training description..."
              rows="3"
              className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary resize-none focus:outline-none focus:border-border-accent-purple"
            ></textarea>
          </div>

          {/* Date Fields */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-md font-medium text-text-primary mb-3 block">
                Assignment Date *
              </label>
              <input
                type="date"
                value={formData.assignmentDate}
                onChange={(e) => handleChange('assignmentDate', e.target.value)}
                min={todayDate}
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
              />
            </div>

            <div>
              <label className="text-md font-medium text-text-primary mb-3 block">
                Due Date *
              </label>
              <input
                type="date"
                value={formData.dueDate}
                onChange={(e) => handleChange('dueDate', e.target.value)}
                min={formData.assignmentDate || todayDate}
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
              />
            </div>

            <div>
              <label className="text-md font-medium text-text-primary mb-3 block">
                Expiry Date *
              </label>
              <input
                type="date"
                value={formData.expiryDate}
                onChange={(e) => handleChange('expiryDate', e.target.value)}
                min={formData.dueDate || formData.assignmentDate || todayDate}
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
              />
            </div>
          </div>

          {/* Training Type */}
          <div>
            <label className="text-md font-medium text-text-primary mb-3 block">
              Training Type *
            </label>
            <div className="relative">
              <select
                value={formData.trainingType}
                onChange={(e) => handleChange('trainingType', e.target.value)}
                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary appearance-none focus:outline-none focus:border-border-accent-purple"
              >
                <option value="Technical">Technical</option>
                <option value="Safety & Compliance">Safety & Compliance</option>
                <option value="Soft Skills">Soft Skills</option>
                <option value="Leadership">Leadership</option>
                <option value="Mandatory on Sign Up">Mandatory on Sign Up</option>
                <option value="Other">Other</option>
              </select>
              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
            </div>
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
              <span>{loading ? 'Saving...' : (training ? 'Update Training' : 'Create Training')}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddTrainingModal;