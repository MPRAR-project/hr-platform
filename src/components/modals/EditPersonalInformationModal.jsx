import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import Button from '../ui/Button';
import { getUserById, updateUserBySiteManager } from '../../services/users';
import { getUserOnboardingApplication, submitOnboardingStep } from '../../services/onboarding';

const EditPersonalInformationModal = ({ isOpen, onClose, userId, companyId, currentData, onSave }) => {
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [originalFormData, setOriginalFormData] = useState({});
  const initializedRef = React.useRef(false);
  const [formData, setFormData] = useState({
    // Basic Information
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    maritalStatus: '',
    nationality: '',
    address: '',
    // Identification & Compliance
    nationalInsurance: '',
    taxCode: '',
    passportNumber: '',
    issuingCountry: '',
    passportExpiry: '',
    rightToWork: '',
    // Emergency Contact
    emergencyContactName: '',
    emergencyRelationship: '',
    emergencyPhone: '',
    emergencyEmail: '',
    emergencyAddress: ''
  });

  // Helper function to convert date to YYYY-MM-DD format for input fields
  const formatDateForInput = (dateString) => {
    if (!dateString) return '';
    try {
      // Handle various date formats
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';

      // Format as YYYY-MM-DD
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return '';
    }
  };

  useEffect(() => {
    const initializeFormData = async () => {
      // Skip if modal is not open, no data, or already initialized for this session
      if (!isOpen) {
        initializedRef.current = false;
        return;
      }

      if (initializedRef.current || !currentData || loading) return;

      // Parse current data into form fields
      const basic = currentData.basic || {};
      const identification = currentData.identification || {};

      // Prioritize firstName/lastName from user document over parsed display name
      let userDocData = {};
      try {
        const userData = await getUserById(userId);
        if (userData) {
          userDocData = userData;
        }
      } catch (error) {
        console.warn('Failed to fetch user document:', error);
      }

      // Use actual firstName/lastName from user document if available, otherwise parse from display name
      const fullName = basic['Full Name'] || '';
      const nameParts = fullName.trim().split(' ');
      const firstName = userDocData.firstName || basic['First Name'] || nameParts[0] || '';
      const lastName = userDocData.lastName || basic['Last Name'] || nameParts.slice(1).join(' ') || '';

      const rawPhone = (userDocData.phone || basic['Phone'] || '').toString();
      const rawEmergencyPhone = (identification['Phone'] || '').toString();

    const newFormData = {
      firstName,
      lastName,
      email: (basic['Email'] || '').trim(),
      phone: rawPhone.replace(/\D/g, '').slice(0, 10),
      dateOfBirth: formatDateForInput(userDocData.dateOfBirth || basic['Date Of Birth']),
      gender: userDocData.gender || basic['Gender'] || '',
      maritalStatus: userDocData.maritalStatus || basic['Marital Status'] || '',
      nationality: userDocData.nationality || basic['Nationality'] || '',
      address: userDocData.address?.raw || basic['Address'] || '',
      nationalInsurance: userDocData.nationalInsurance || identification['National Insurance'] || '',
      taxCode: (userDocData.taxCode || identification['Tax Code'] || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 9),
      passportNumber: (userDocData.passportNumber || identification['Passport Number'] || '').toString().replace(/[^A-Za-z0-9]/g, '').slice(0, 12),
      issuingCountry: userDocData.issuingCountry || identification['Issuing Country'] || '',
      passportExpiry: formatDateForInput(userDocData.passportExpiry || identification['Passport Expiry Date']),
      rightToWork: userDocData.rightToWork || identification['Right To Work Status'] || '',
      emergencyContactName: userDocData.emergencyContactName || identification['Name'] || '',
      emergencyRelationship: userDocData.emergencyRelationship || identification['Relationship'] || '',
      emergencyPhone: userDocData.emergencyPhone || rawEmergencyPhone.replace(/\D/g, '').slice(0, 10),
      emergencyEmail: userDocData.emergencyEmail || (identification['Email'] || '').trim(),
      emergencyAddress: userDocData.emergencyAddress || identification['Address'] || ''
    };

    setFormData(newFormData);
      setOriginalFormData(newFormData);
      setHasChanges(false);
      initializedRef.current = true;
    };

    initializeFormData();
  }, [isOpen, currentData, loading, userId]);

  const handleChange = (field, value) => {
    // Relaxed text-only validation: allow the user to type or delete characters.
    // We only block if the NEW character is a number and it's a name field.
    // This allows existing bad data (like emails in name fields) to be edited.
    if (
      (field === 'firstName' || field === 'lastName' ||
        field === 'emergencyContactName' || field === 'emergencyRelationship')
    ) {
      // Only strip out numbers, allow letters, spaces, hyphens, dots, and common name symbols
      // If the user is trying to fix an email-as-name, we don't want to block the backspace or deletion.
      const cleanedValue = value.replace(/[0-9]/g, '');

      setFormData(prev => {
        const newFormData = { ...prev, [field]: cleanedValue };
        const hasFieldChanges = Object.keys(newFormData).some(key => {
          const currentVal = (newFormData[key] || '').toString().trim();
          const originalVal = (originalFormData[key] || '').toString().trim();
          return currentVal !== originalVal;
        });
        setHasChanges(hasFieldChanges);
        return newFormData;
      });
      return;
    }

    // Restrict Phone and Emergency Phone to numbers only, max 10 digits
    if (field === 'phone' || field === 'emergencyPhone') {
      const digitsOnly = value.replace(/\D/g, '').slice(0, 10);
      setFormData(prev => {
        const newFormData = { ...prev, [field]: digitsOnly };
        // Check if any field has changed from original with normalization
        const hasFieldChanges = Object.keys(newFormData).some(key => {
          const currentVal = (newFormData[key] || '').toString().trim();
          const originalVal = (originalFormData[key] || '').toString().trim();
          return currentVal !== originalVal;
        });
        setHasChanges(hasFieldChanges);
        return newFormData;
      });
      return;
    }

    // Alphanumeric fields (Passport, Tax Code)
    if (field === 'passportNumber' || field === 'taxCode') {
      const maxLength = field === 'passportNumber' ? 12 : 9;
      const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, maxLength);
      setFormData(prev => {
        const newFormData = { ...prev, [field]: cleaned };
        const hasFieldChanges = Object.keys(newFormData).some(key => {
          const currentVal = (newFormData[key] || '').toString().trim();
          const originalVal = (originalFormData[key] || '').toString().trim();
          return currentVal !== originalVal;
        });
        setHasChanges(hasFieldChanges);
        return newFormData;
      });
      return;
    }

    setFormData(prev => {
      const newFormData = {
        ...prev,
        [field]: value
      };
      // Check if any field has changed from original with normalization
      const hasFieldChanges = Object.keys(newFormData).some(key => {
        const currentVal = (newFormData[key] || '').toString().trim();
        const originalVal = (originalFormData[key] || '').toString().trim();
        return currentVal !== originalVal;
      });
      setHasChanges(hasFieldChanges);
      return newFormData;
    });
  };

  const handleSave = async () => {
    if (!userId) {
      toast.error('User ID is required');
      return;
    }

    // Date of Birth validation (no future dates)
    if (formData.dateOfBirth) {
      const dob = new Date(formData.dateOfBirth);
      const now = new Date();
      if (dob > now) {
        toast.error('Date of Birth cannot be in the future');
        return;
      }
    }

    // Phone fields: only numbers, exactly 10 digits
    if (formData.phone && /\D/.test(formData.phone)) {
      toast.error('Phone number can only contain digits');
      return;
    }
    if (formData.phone && formData.phone.length !== 10) {
      toast.error('Phone number must be 10 digits');
      return;
    }
    if (formData.emergencyPhone && /\D/.test(formData.emergencyPhone)) {
      toast.error('Emergency contact phone can only contain digits');
      return;
    }
    if (formData.emergencyPhone && formData.emergencyPhone.length !== 10) {
      toast.error('Emergency contact phone must be 10 digits');
      return;
    }

    // Emergency Contact Name: letters only
    if (formData.emergencyContactName?.trim() && /\d/.test(formData.emergencyContactName)) {
      toast.error('Emergency contact name cannot contain numbers');
      return;
    }

    // Relationship: letters only
    if (formData.emergencyRelationship?.trim() && /\d/.test(formData.emergencyRelationship)) {
      toast.error('Relationship cannot contain numbers');
      return;
    }

    // Emergency Contact Email: valid email format if provided
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (formData.emergencyEmail?.trim() && !emailRegex.test(formData.emergencyEmail.trim())) {
      toast.error('Please enter a valid emergency contact email (e.g. name@example.com)');
      return;
    }

    // Main Email: valid email format and no leading/trailing spaces if provided
    if (formData.email?.trim() && !emailRegex.test(formData.email.trim())) {
      toast.error('Please enter a valid email address (e.g. name@example.com)');
      return;
    }

    // Passport Number: alphanumeric only, 6–12 characters if provided
    if (formData.passportNumber?.trim()) {
      if (/[^A-Za-z0-9]/.test(formData.passportNumber)) {
        toast.error('Passport number can only contain letters and numbers');
        return;
      }
      if (formData.passportNumber.length < 6 || formData.passportNumber.length > 12) {
        toast.error('Passport number must be 6 to 12 characters');
        return;
      }
    }

    // Tax Code: alphanumeric only, 2–9 characters if provided (e.g. UK 1257L, BR)
    if (formData.taxCode?.trim()) {
      if (/[^A-Za-z0-9]/.test(formData.taxCode)) {
        toast.error('Tax code can only contain letters and numbers');
        return;
      }
      if (formData.taxCode.length < 2 || formData.taxCode.length > 9) {
        toast.error('Tax code must be 2 to 9 characters');
        return;
      }
    }

    // Passport Expiry validation (usually should be future, but let's just log if it's past? QA didn't ask for it)

    try {
      setLoading(true);

      const normalizedUserId = userId.includes('/') ? userId.split('/').pop() : userId;

      const updates = {
        updatedAt: new Date().toISOString()
      };

      // Update basic information fields in users collection
      if (formData.firstName) updates.firstName = formData.firstName;
      if (formData.lastName) updates.lastName = formData.lastName;
      if (formData.firstName || formData.lastName) {
        updates.displayName = `${formData.firstName || ''} ${formData.lastName || ''}`.trim();
      }
      if (formData.phone) updates.phone = formData.phone;
      if (formData.dateOfBirth) updates.dateOfBirth = formData.dateOfBirth;
      if (formData.gender) updates.gender = formData.gender;
      if (formData.maritalStatus) updates.maritalStatus = formData.maritalStatus;
      if (formData.nationality) updates.nationality = formData.nationality;
      if (formData.address) updates.address = { raw: formData.address };

      // Update identification fields in users collection
      if (formData.nationalInsurance) updates.nationalInsurance = formData.nationalInsurance;
      if (formData.taxCode) updates.taxCode = formData.taxCode;
      if (formData.passportNumber) updates.passportNumber = formData.passportNumber;
      if (formData.issuingCountry) updates.issuingCountry = formData.issuingCountry;
      if (formData.passportExpiry) updates.passportExpiry = formData.passportExpiry;
      if (formData.rightToWork) updates.rightToWork = formData.rightToWork;
      if (formData.emergencyContactName) updates.emergencyContactName = formData.emergencyContactName;
      if (formData.emergencyRelationship) updates.emergencyRelationship = formData.emergencyRelationship;
      if (formData.emergencyPhone) updates.emergencyPhone = formData.emergencyPhone;
      if (formData.emergencyEmail) updates.emergencyEmail = formData.emergencyEmail;
      if (formData.emergencyAddress) updates.emergencyAddress = formData.emergencyAddress;

      // 1. Update User Document via REST
      await updateUserBySiteManager(normalizedUserId, updates);

      // 2. Update Onboarding Application via REST (if it exists)
      try {
        const application = await getUserOnboardingApplication(normalizedUserId);
        if (application) {
          const stepData = application.stepData || {};
          const updatedStepData = { ...stepData };

          updatedStepData.personalInfo = {
            ...(stepData.personalInfo || {}),
            firstName: formData.firstName,
            lastName: formData.lastName,
            email: formData.email?.trim(),
            phone: formData.phone,
            dateOfBirth: formData.dateOfBirth,
            gender: formData.gender,
            maritalStatus: formData.maritalStatus,
            nationality: formData.nationality,
            addressLine1: formData.address
          };

          updatedStepData.identification = {
            ...(stepData.identification || {}),
            nationalInsurance: formData.nationalInsurance,
            passportNumber: formData.passportNumber,
            issuingCountry: formData.issuingCountry,
            passportExpiry: formData.passportExpiry,
            rightToWork: formData.rightToWork,
            emergencyContactName: formData.emergencyContactName,
            emergencyRelationship: formData.emergencyRelationship,
            emergencyPhone: formData.emergencyPhone,
            emergencyEmail: formData.emergencyEmail,
            emergencyAddress: formData.emergencyAddress
          };

          await submitOnboardingStep(normalizedUserId, 1, updatedStepData.personalInfo);
          await submitOnboardingStep(normalizedUserId, 2, updatedStepData.identification);
        }
      } catch (onboardingError) {
        console.warn('Failed to update onboarding application (non-critical):', onboardingError);
      }

      // Sync personal info to HR onboarding profile if it exists
      try {
        const { syncPersonalInfoToHRProfile } = await import('../../services/hrOnboarding');
        const personalInfoData = {
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          dateOfBirth: formData.dateOfBirth,
          gender: formData.gender,
          maritalStatus: formData.maritalStatus,
          nationality: formData.nationality,
          addressLine1: formData.address,
          nationalInsurance: formData.nationalInsurance,
          taxCode: formData.taxCode,
          passportNumber: formData.passportNumber,
          issuingCountry: formData.issuingCountry,
          passportExpiryDate: formData.passportExpiry,
          rightToWorkStatus: formData.rightToWork
        };

        await syncPersonalInfoToHRProfile(normalizedUserId, personalInfoData);
        console.log('[EditPersonalInfo] Synced to HR onboarding profile');
      } catch (hrSyncError) {
        console.warn('Failed to sync to HR onboarding (non-critical):', hrSyncError);
        // Don't throw - this is a secondary sync
      }

      // Central sync is handled by the HR backend on every PUT /hr/employees/:id.
      toast.success('Personal information updated successfully');

      // Reset changes flag after successful save
      setHasChanges(false);

      // Pass updated data to parent for optimistic UI update
      if (onSave) {
        const updatedData = {
          basic: {
            'Full Name': `${formData.firstName} ${formData.lastName}`.trim(),
            'Email': formData.email?.trim() || '',
            'Phone': formData.phone,
            'Date Of Birth': formData.dateOfBirth,
            'Gender': formData.gender,
            'Marital Status': formData.maritalStatus,
            'Nationality': formData.nationality,
            'Address': formData.address
          },
          identification: {
            'National Insurance': formData.nationalInsurance,
            'Tax Code': formData.taxCode,
            'Passport Number': formData.passportNumber,
            'Issuing Country': formData.issuingCountry,
            'Passport Expiry Date': formData.passportExpiry,
            'Right To Work Status': formData.rightToWork,
            'Name': formData.emergencyContactName,
            'Relationship': formData.emergencyRelationship,
            'Phone': formData.emergencyPhone,
            'Email': formData.emergencyEmail?.trim() || '',
            'Address': formData.emergencyAddress
          }
        };
        onSave(updatedData);
      }
      onClose();
    } catch (error) {
      console.error('Error updating personal information:', error);
      toast.error(error.message || 'Failed to update personal information');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-4xl bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl font-bold text-text-primary">Edit Personal Information</h2>
              <p className="text-sm text-text-secondary mt-1">Update personal details and identification information</p>
            </div>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Basic Information */}
            <div className="border border-border-secondary rounded-base p-6 space-y-4">
              <h4 className="text-lg font-semibold text-text-primary mb-4">Basic Information</h4>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">First Name *</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => handleChange('firstName', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Last Name *</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => handleChange('lastName', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    readOnly
                    disabled
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-secondary bg-gray-50 cursor-not-allowed"
                  />
                  <p className="text-xs text-text-secondary mt-1">Email cannot be changed</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Phone</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    placeholder="10 digits only"
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Date Of Birth</label>
                  <input
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => handleChange('dateOfBirth', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Gender</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => handleChange('gender', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Gender</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Marital Status</label>
                  <select
                    value={formData.maritalStatus}
                    onChange={(e) => handleChange('maritalStatus', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Marital Status</option>
                    <option value="Single">Single</option>
                    <option value="Married">Married</option>
                    <option value="Divorced">Divorced</option>
                    <option value="Widowed">Widowed</option>
                    <option value="Civil Partnership">Civil Partnership</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Nationality</label>
                  <input
                    type="text"
                    value={formData.nationality}
                    onChange={(e) => handleChange('nationality', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Address</label>
                  <textarea
                    value={formData.address}
                    onChange={(e) => handleChange('address', e.target.value)}
                    rows="3"
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Identification & Compliance */}
            <div className="border border-border-secondary rounded-base p-6 space-y-4">
              <h4 className="text-lg font-semibold text-text-primary mb-4">Identification & Compliance</h4>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">National Insurance</label>
                  <input
                    type="text"
                    value={formData.nationalInsurance}
                    onChange={(e) => handleChange('nationalInsurance', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Tax Code</label>
                  <input
                    type="text"
                    value={formData.taxCode}
                    onChange={(e) => handleChange('taxCode', e.target.value)}
                    placeholder="Letters and numbers only (2–9 chars)"
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Passport Number</label>
                  <input
                    type="text"
                    value={formData.passportNumber}
                    onChange={(e) => handleChange('passportNumber', e.target.value)}
                    placeholder="Letters and numbers only (6–12 chars)"
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Issuing Country</label>
                  <input
                    type="text"
                    value={formData.issuingCountry}
                    onChange={(e) => handleChange('issuingCountry', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Passport Expiry Date</label>
                  <input
                    type="date"
                    value={formData.passportExpiry}
                    onChange={(e) => handleChange('passportExpiry', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Right To Work Status</label>
                  <select
                    value={formData.rightToWork}
                    onChange={(e) => handleChange('rightToWork', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Status</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                    <option value="Pending">Pending</option>
                  </select>
                </div>

                <div className="border-t border-border-secondary pt-4 mt-4">
                  <h5 className="text-md font-semibold text-text-primary mb-4">Emergency Contact</h5>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Name</label>
                      <input
                        type="text"
                        value={formData.emergencyContactName}
                        onChange={(e) => handleChange('emergencyContactName', e.target.value)}
                        placeholder="Letters only (no numbers)"
                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                      />
                      <p className="text-xs text-text-secondary mt-1">Letters and spaces only — numbers not allowed</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Relationship</label>
                      <input
                        type="text"
                        value={formData.emergencyRelationship}
                        onChange={(e) => handleChange('emergencyRelationship', e.target.value)}
                        placeholder="e.g. Mother, Spouse, Friend"
                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                      />
                      <p className="text-xs text-text-secondary mt-1">Letters and spaces only — numbers not allowed</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Phone</label>
                      <input
                        type="tel"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={formData.emergencyPhone}
                        onChange={(e) => handleChange('emergencyPhone', e.target.value)}
                        placeholder="10 digits only"
                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Email</label>
                      <input
                        type="email"
                        value={formData.emergencyEmail}
                        onChange={(e) => handleChange('emergencyEmail', e.target.value)}
                        placeholder="e.g. name@example.com"
                        className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-text-primary mb-2">Address</label>
                      <textarea
                        value={formData.emergencyAddress}
                        onChange={(e) => handleChange('emergencyAddress', e.target.value)}
                        rows="2"
                        className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple resize-none"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-4 pt-4 border-t border-border-secondary">
            <Button
              onClick={onClose}
              variant="outline-secondary"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              variant="gradient"
              disabled={loading || !hasChanges || !formData.firstName?.trim() || !formData.lastName?.trim()}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditPersonalInformationModal;

