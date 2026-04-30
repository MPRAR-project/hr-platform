import { ArrowRight, ChevronDown, X } from 'lucide-react';
import { useState, useEffect } from 'react';
import Button from '../ui/Button';
import { DEFAULT_LEAVE_TYPE, LEAVE_TYPES } from "../../config/leaveConfig";
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../../firebase/client'; // Import your Firebase storage instance
import { allowanceService } from '../../services/allowanceService';
import Loader from '../ui/Loader';

const AddAbsenceModal = ({ isOpen, onClose, onSave, userId, preloadedAllowances }) => {
  const [formData, setFormData] = useState({
    leaveType: DEFAULT_LEAVE_TYPE,
    reason: '',
    startingDate: '',
    endingDate: '',
    supportingFile: null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [userAllowances, setUserAllowances] = useState([]);
  const [loadingAllowances, setLoadingAllowances] = useState(false);

  // Fetch user's assigned leave types when modal opens
  useEffect(() => {
    if (isOpen && userId) {
      if (preloadedAllowances && preloadedAllowances.length > 0) {
        // Use preloaded allowances from parent for instant display
        setUserAllowances(preloadedAllowances);
        setFormData(prev => ({
          ...prev,
          leaveType: ''
        }));
      } else {
        fetchUserAllowances();
      }
    }
  }, [isOpen, userId, preloadedAllowances]);

  const fetchUserAllowances = async () => {
    setLoadingAllowances(true);
    try {
      const allowances = await allowanceService.getEmployeeAllowances(
        userId, 
        { userId }, 
        new Date().getFullYear()
      );
      setUserAllowances(allowances);
      
      if (allowances.length > 0) {
        setFormData(prev => ({
          ...prev,
          leaveType: ''
        }));
      }
    } catch (error) {
      console.error('Error fetching user allowances:', error);
      setUserAllowances([]);
    } finally {
      setLoadingAllowances(false);
    }
  };

  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayDate = getTodayDate();

  const handleStartingDateChange = (e) => {
    const newStartingDate = e.target.value;
    setFormData(prev => {
      const updatedData = { ...prev, startingDate: newStartingDate };
      if (prev.endingDate && newStartingDate && prev.endingDate < newStartingDate) {
        updatedData.endingDate = '';
      }
      return updatedData;
    });
  };

  const handleLeaveTypeChange = (e) => {
    setFormData(prev => ({
      ...prev,
      leaveType: e.target.value,
      supportingFile: null
    }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      // Validate file size (e.g., max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('File size must be less than 5MB');
        return;
      }
      // Validate file type
      const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
      if (!validTypes.includes(file.type)) {
        alert('Only PDF and image files (JPG, PNG) are allowed');
        return;
      }
    }
    setFormData(prev => ({
      ...prev,
      supportingFile: file || null
    }));
  };

  const uploadFileToStorage = async (file, userId, leaveType) => {
    try {
      // Create a unique filename
      const timestamp = Date.now();
      const fileName = `${timestamp}_${file.name}`;
      const filePath = `absences/${userId}/${leaveType}/${fileName}`;

      // Create storage reference
      const storageRef = ref(storage, filePath);

      // Upload file
      const snapshot = await uploadBytes(storageRef, file);

      // Get download URL
      const downloadURL = await getDownloadURL(snapshot.ref);

      return {
        url: downloadURL,
        path: filePath,
        name: file.name,
        size: file.size,
        type: file.type
      };
    } catch (error) {
      console.error('Error uploading file:', error);
      throw new Error('Failed to upload file. Please try again.');
    }
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.leaveType || !formData.startingDate || !formData.endingDate) {
      alert('Please fill in all required fields (Leave Type, Start Date, End Date).');
      return;
    }

    // Check allowance limits
    const normRequestedType = allowanceService.normalizeLeaveType(formData.leaveType);
    const selectedAllowance = userAllowances.find(a => 
      allowanceService.normalizeLeaveType(a.leaveType) === normRequestedType ||
      a.leaveType === formData.leaveType
    );

    if (selectedAllowance) {
      // remainingDays might be negative if already overused (e.g. virtual allowances)
      // but in the allowance collection it's usually 0 or positive.
      // We calculate the current actual remaining days based on total - used.
      const total = Number(selectedAllowance.totalDays) || 0;
      const used = Number(selectedAllowance.usedDays) || 0;
      const actualRemaining = total - used;
      
      const requestedDays = allowanceService.calculateDaysFromDates(formData.startingDate, formData.endingDate);
      
      if (requestedDays > actualRemaining) {
        const leaveDisplayName = allowanceService.getLeaveTypeDisplayName(formData.leaveType);
        const overMsg = actualRemaining <= 0 
          ? `You have already used all of your ${leaveDisplayName} allowance (Total: ${total} days).`
          : `You are requesting ${requestedDays} days, but you only have ${actualRemaining.toFixed(1)} days remaining for ${leaveDisplayName}.`;
        
        alert(overMsg);
        return;
      }
    }

    // Check if file is required
    const requiresFile = formData.leaveType === 'maternity_leave' || formData.leaveType === 'paternity_leave';

    if (requiresFile && !formData.supportingFile) {
      const chosenLabel = LEAVE_TYPES.find(t => t.value === formData.leaveType)?.label || formData.leaveType;
      alert(`The ${chosenLabel} request requires a supporting document/certificate.`);
      return;
    }

    setIsSaving(true);
    try {
      let fileData = null;

      // Upload file if present
      if (formData.supportingFile) {
        setUploadProgress(50);
        fileData = await uploadFileToStorage(formData.supportingFile, userId, formData.leaveType);
        setUploadProgress(100);
      }

      // Prepare data for submission (without the File object)
      const dataToSave = {
        leaveType: formData.leaveType,
        reason: formData.reason,
        startingDate: formData.startingDate,
        endingDate: formData.endingDate,
        ...(fileData && {
          supportingDocument: {
            url: fileData.url,
            path: fileData.path,
            name: fileData.name,
            size: fileData.size,
            type: fileData.type,
            uploadedAt: new Date().toISOString()
          }
        })
      };

      await onSave(dataToSave);

      // Reset form
      setFormData({
        leaveType: '',
        reason: '',
        startingDate: '',
        endingDate: '',
        supportingFile: null,
      });
      setUploadProgress(0);
      onClose();

    } catch (error) {
      console.error("Submission error:", error);
      alert('Failed to submit request: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const isMaternityOrPaternity = formData.leaveType === 'maternity_leave' || formData.leaveType === 'paternity_leave';

  const selectedAllowance = userAllowances.find(a => 
    allowanceService.normalizeLeaveType(a.leaveType) === allowanceService.normalizeLeaveType(formData.leaveType) ||
    a.leaveType === formData.leaveType
  );

  const totalDays = selectedAllowance ? (Number(selectedAllowance.totalDays) || 0) : 0;
  const usedDays = selectedAllowance ? (Number(selectedAllowance.usedDays) || 0) : 0;
  const actualRemaining = totalDays - usedDays;
  
  const requestedDays = (formData.startingDate && formData.endingDate) 
    ? allowanceService.calculateDaysFromDates(formData.startingDate, formData.endingDate) 
    : 0;
  
  const isExceedingAllowance = formData.leaveType && requestedDays > actualRemaining;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={isSaving ? null : onClose}></div>

      <div className="relative w-full max-w-[500px] max-h-[90vh] overflow-y-auto scrollbar-custom bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6">
        {/* Loading Overlay */}
        {isSaving && (
          <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm rounded-[24px] flex flex-col items-center justify-center">
            <Loader variant="spinner" size="lg" text="Submitting Request..." />
          </div>
        )}

        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-2xl font-bold text-text-primary">Add New Absence</h2>
            <button onClick={onClose} disabled={isSaving} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors disabled:opacity-50">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Leave Type Dropdown */}
          <div>
            <label className="text-md font-semibold text-text-primary mb-3 block">Leave Type</label>
            <div className="relative">
              <select
                value={formData.leaveType}
                onChange={handleLeaveTypeChange}
                disabled={isSaving || loadingAllowances}
                className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple appearance-none bg-white disabled:bg-gray-50"
              >
                <option value="" disabled>Select Leave Type</option>
                {loadingAllowances ? (
                  <option value="" disabled>Loading available leave types...</option>
                ) : (
                  userAllowances.map(allowance => {
                    // Find the corresponding leave type config to get the value
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
            {userAllowances.length === 0 && !loadingAllowances && (
              <p className="text-sm text-amber-600 mt-2">
                You don't have any leave types assigned. Please contact your administrator.
              </p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="text-md font-semibold text-text-primary mb-3 block">Reason</label>
            <textarea
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              placeholder="Brief description of your absence..."
              rows={3}
              disabled={isSaving}
              className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple resize-none disabled:bg-gray-50"
            />
          </div>

          {/* Starting and Ending Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">Starting Date</label>
              <input
                type="date"
                value={formData.startingDate}
                onChange={handleStartingDateChange}
                min={todayDate}
                disabled={isSaving}
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple disabled:bg-gray-50"
              />
            </div>

            <div>
              <label className="text-md font-semibold text-text-primary mb-3 block">Ending Date</label>
              <input
                type="date"
                value={formData.endingDate}
                onChange={(e) => setFormData({ ...formData, endingDate: e.target.value })}
                min={formData.startingDate || todayDate}
                disabled={isSaving}
                className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple disabled:bg-gray-50"
              />
            </div>
          </div>

          {/* Allowance Status */}
          {formData.leaveType && selectedAllowance && (
            <div className={`p-4 rounded-lg border flex flex-col gap-1 ${
              isExceedingAllowance ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'
            }`}>
              <div className="flex justify-between text-sm">
                <span className="font-semibold text-text-primary">Available Allowance:</span>
                <span className="font-bold">{parseFloat(actualRemaining.toFixed(1))} days</span>
              </div>
              {requestedDays > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="font-semibold text-text-primary">Requested:</span>
                  <span className={`font-bold ${isExceedingAllowance ? 'text-red-600' : 'text-green-700'}`}>
                    {requestedDays} days
                  </span>
                </div>
              )}
              {isExceedingAllowance && (
                <p className="text-xs text-red-600 mt-1 font-medium">
                  You are requesting more days than you have available.
                </p>
              )}
            </div>
          )}

          {/* Conditional File Upload */}
          {isMaternityOrPaternity && (
            <div className="file-upload-section border border-dashed border-border-accent-purple rounded-lg p-4 space-y-3 bg-indigo-50/50">
              <p className="text-sm font-semibold text-indigo-700">
                <span className="font-bold">Mandatory Document:</span> Please upload the required supporting form or certificate for {LEAVE_TYPES.find(t => t.value === formData.leaveType)?.label}.
              </p>
              <div>
                <label htmlFor="supportingFile" className="text-md font-semibold text-text-primary mb-2 block">
                  Upload File (PDF, JPG, PNG - Max 5MB)
                </label>
                <input
                  type="file"
                  id="supportingFile"
                  name="supportingFile"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileChange}
                  disabled={isSaving}
                  className="w-full file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-600 hover:file:bg-primary-100 disabled:opacity-50"
                />
                {formData.supportingFile && (
                  <p className="text-sm text-green-600 mt-2">
                    Selected: {formData.supportingFile.name} ({(formData.supportingFile.size / 1024).toFixed(2)} KB)
                  </p>
                )}
              </div>
              {uploadProgress > 0 && uploadProgress < 100 && (
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              cn='col-span-1 h-12'
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant='gradient'
              cn="col-span-2 h-12"
              icon={ArrowRight}
              disabled={isSaving || loadingAllowances || userAllowances.length === 0 || isExceedingAllowance}
            >
              <span>{isSaving ? 'Uploading...' : 'Submit Request'}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddAbsenceModal;