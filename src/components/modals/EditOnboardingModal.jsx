import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { toast } from 'react-toastify';
import Button from '../ui/Button';
import { db } from '../../firebase/client';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { getClients } from '../../services/clients';
import { getSites } from '../../services/sites';
import { useAuth } from '../../hooks/useAuth';

const EditOnboardingModal = ({ isOpen, onClose, userId, currentData, onSave }) => {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    clientId: '',
    siteId: '', // Added siteId
    jobTitle: '',
    employmentType: '',
    startDate: '',
    primaryWorkLocation: '',
    officeAddress: '',
    workPattern: '',
    probationPeriod: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankName: '',
    sortCode: '',
    branchName: '',
    iban: '',
    annualSalary: '',
    payFrequency: '',
    benefits: '',
    hourlyRate: '',
    chargeRate: '',
    adminNotes: ''
  });

  useEffect(() => {
    if (isOpen && currentData) {
      setFormData({
        clientId: currentData.clientId || '',
        siteId: currentData.siteId?.replace('sites/', '') || '', // Added siteId
        jobTitle: currentData.jobTitle || '',
        employmentType: currentData.employmentType || '',
        startDate: currentData.startDate || '',
        department: currentData.department || '',
        primaryWorkLocation: currentData.primaryWorkLocation || currentData.workLocation || '',
        officeAddress: currentData.officeAddress || '',
        workPattern: currentData.workPattern || '',
        probationPeriod: currentData.probationPeriod || '',

        // Bank Details
        bankAccountName: currentData.bankAccountName || '',
        bankAccountNumber: currentData.bankAccountNumber || '',
        bankName: currentData.bankName || '',
        sortCode: currentData.sortCode || '',
        branchName: currentData.branchName || '',
        iban: currentData.iban || '',

        // Compensation
        annualSalary: currentData.annualSalary || '',
        payFrequency: currentData.payFrequency || '',
        benefits: currentData.benefits || '',
        hourlyRate: currentData.hourlyRate || '',
        chargeRate: currentData.chargeRate || '',

        // Notes
        adminNotes: currentData.adminNotes || currentData.notes || ''
      });
    }
  }, [isOpen, currentData]);

  // FRESH DATA: Fetch latest user siteId/clientId when modal opens
  useEffect(() => {
    const fetchFreshUserData = async () => {
      if (!isOpen || !userId) return;

      try {
        const normalizedUserId = userId.includes('/') ? userId.split('/').pop() : userId;
        const userRef = doc(db, 'users', normalizedUserId);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          // Update formData with fresh site/client IDs
          setFormData(prev => ({
            ...prev,
            clientId: userData.clientId || prev.clientId || '',
            siteId: userData.siteId?.includes('/')
              ? userData.siteId.split('/')[1]
              : (userData.siteId || prev.siteId || '')
          }));
          console.log('[Onboarding] Loaded fresh user data:', {
            clientId: userData.clientId,
            siteId: userData.siteId
          });
        }
      } catch (error) {
        console.error('[Onboarding] Failed to fetch fresh user data:', error);
        // Don't fail - just use what we have from currentData
      }
    };

    fetchFreshUserData();
  }, [isOpen, userId]);

  useEffect(() => {
    const loadData = async () => {
      if (!isOpen || !user?.companyId) return;
      try {
        const cid = user.companyId.split('/').pop();

        // Parallel fetch for clients and sites
        const [clientsData, sitesData] = await Promise.all([
          getClients(cid),
          getSites(cid)
        ]);

        setClients(clientsData);
        setSites(sitesData);
      } catch (e) {
        console.error('Failed to load form data', e);
      }
    };
    loadData();
  }, [isOpen, user?.companyId]);

  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    console.log('[EditOnboarding] ========= SAVE STARTED =========');
    console.log('[EditOnboarding] userId:', userId);
    console.log('[EditOnboarding] formData.siteId:', formData.siteId);
    console.log('[EditOnboarding] formData.clientId:', formData.clientId);

    if (!userId) {
      toast.error('User ID is required');
      return;
    }

    try {
      setLoading(true);

      // Normalize userId (handle both 'uid' and 'users/uid' formats)
      const normalizedUserId = userId.includes('/') ? userId.split('/').pop() : userId;

      // Find onboarding application
      const appCol = collection(db, 'onboardingApplications');
      const queries = [
        query(appCol, where('userId', '==', normalizedUserId)),
        query(appCol, where('userId', '==', `users/${normalizedUserId}`))
      ];

      const results = await Promise.allSettled(queries.map(q => getDocs(q)));
      const allDocs = [];
      for (const r of results) {
        if (r.status === 'fulfilled' && !r.value.empty) {
          r.value.docs.forEach(d => allDocs.push({ id: d.id, ...d.data() }));
        }
      }

      let latestOnboarding = null;
      let onboardingRef = null;

      if (allDocs.length === 0) {
        // Create new onboarding application if it doesn't exist
        const userRef = doc(db, 'users', normalizedUserId);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          toast.error('User not found');
          return;
        }

        const userData = userSnap.data();
        const companyId = userData.companyId?.includes('/')
          ? userData.companyId
          : (userData.companyId ? `companies/${userData.companyId}` : null);
        const siteId = userData.siteId?.includes('/')
          ? userData.siteId
          : (userData.siteId ? `sites/${userData.siteId}` : null);

        if (!companyId || !siteId) {
          toast.error('User company or site information is missing');
          return;
        }

        // Create new onboarding application
        const newOnboardingRef = doc(collection(db, 'onboardingApplications'));
        const now = serverTimestamp();

        const newOnboardingData = {
          userId: normalizedUserId,
          companyId,
          siteId,
          status: 'pending',
          currentStep: 'personalInfo',
          formData: {
            personalInfo: {},
            identification: {},
            banking: {},
            hrInfo: {},
            policies: {},
            optionalInfo: {}
          },
          employmentDetails: {},
          documents: [],
          createdAt: now,
          updatedAt: now,
          completedAt: null
        };

        await setDoc(newOnboardingRef, newOnboardingData);

        latestOnboarding = { id: newOnboardingRef.id, ...newOnboardingData };
        onboardingRef = newOnboardingRef;
      } else {
        // Get the latest onboarding application
        allDocs.sort((a, b) => {
          const at = (a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0);
          const bt = (b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0);
          return bt - at;
        });
        latestOnboarding = allDocs[0];
        onboardingRef = doc(db, 'onboardingApplications', latestOnboarding.id);
      }

      // Prepare employment details update
      const employmentDetailsUpdate = {
        jobTitle: formData.jobTitle || '',
        department: formData.department || '',
        employmentType: formData.employmentType || '',
        startDate: formData.startDate || '',
        primaryWorkLocation: formData.primaryWorkLocation || '',
        officeAddress: formData.officeAddress || '',
        workPattern: formData.workPattern || '',
        probationPeriod: formData.probationPeriod || '',
        lastUpdated: serverTimestamp(),
        updatedBy: normalizedUserId,
        source: 'onboarding',

        // Bank Details
        bankAccountName: formData.bankAccountName || '',
        bankAccountNumber: formData.bankAccountNumber || '',
        bankName: formData.bankName || '',
        sortCode: formData.sortCode || '',
        branchName: formData.branchName || '',
        iban: formData.iban || '',

        // Compensation
        annualSalary: formData.annualSalary || '',
        payFrequency: formData.payFrequency || '',
        benefits: formData.benefits || '',
        hourlyRate: formData.hourlyRate || '',
        chargeRate: formData.chargeRate || '',

        // Notes
        adminNotes: formData.adminNotes || ''
      };

      // Calculate probation end date if start date and probation period are provided
      if (formData.startDate && formData.probationPeriod) {
        const startDate = new Date(formData.startDate);
        // Extract number from strings like "3 Months" or just use the number
        const probationMonths = parseInt(formData.probationPeriod.toString().match(/\d+/)?.[0]) || 3;
        const endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + probationMonths);
        employmentDetailsUpdate.probationEndDate = endDate.toISOString().split('T')[0];
      }

      // Update onboarding application
      const onboardingUpdates = {
        employmentDetails: {
          ...(latestOnboarding.employmentDetails || {}),
          ...employmentDetailsUpdate
        },
        'formData.banking': {
          accountHolderName: formData.bankAccountName,
          accountNumber: formData.bankAccountNumber,
          bankName: formData.bankName,
          sortCode: formData.sortCode,
          branchName: formData.branchName,
          iban: formData.iban
        },
        'formData.hrInfo': {
          ...(latestOnboarding.formData?.hrInfo || {}),
          annualSalary: formData.annualSalary,
          payFrequency: formData.payFrequency,
          benefits: formData.benefits,
          hourlyRate: formData.hourlyRate,
          chargeRate: formData.chargeRate,
          notes: formData.adminNotes, // Sync with adminNotes
          position: formData.jobTitle, // Keep these in sync too
          department: formData.department,
          employmentType: formData.employmentType,
          startDate: formData.startDate,
          probationEndDate: employmentDetailsUpdate.probationEndDate || ''
        },
        updatedAt: serverTimestamp()
      };

      await updateDoc(onboardingRef, onboardingUpdates);

      // Update users collection with employment details AND sync site/client
      const userRef = doc(db, 'users', normalizedUserId);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userUpdates = {};
        if (formData.jobTitle) userUpdates.jobTitle = formData.jobTitle;
        if (formData.employmentType) userUpdates.employmentType = formData.employmentType;
        if (formData.department) userUpdates.department = formData.department;
        if (formData.startDate) userUpdates.hireDate = formData.startDate;

        // CRITICAL FIX: Save the FULL employment details structure to the user document
        userUpdates.employmentDetails = {
          ...(userSnap.data().employmentDetails || {}),
          ...employmentDetailsUpdate
        };

        userUpdates.updatedAt = serverTimestamp();
        await updateDoc(userRef, userUpdates);

        // USE CENTRALIZED SYNC for site/client changes
        // This ensures assignments are properly managed
        if (formData.siteId !== undefined) {
          try {
            const { updateUserSiteAndClient } = await import('../../services/userSiteClientSync');
            console.log('[EditOnboarding] Calling updateUserSiteAndClient with:', {
              userId: normalizedUserId,
              siteId: formData.siteId || null,
              clientId: formData.clientId || null
            });
            const syncResult = await updateUserSiteAndClient(
              normalizedUserId,
              formData.siteId || null,
              formData.clientId || null
            );
            console.log('[EditOnboarding] Site/client sync result:', syncResult);
          } catch (syncError) {
            console.error(`[Onboarding] Failed to sync site/client:`, syncError);
            // Don't fail the whole operation, just log
          }
        }
      }

      console.log('[EditOnboarding] ========= SAVE COMPLETED =========');
      toast.success('Onboarding details updated successfully');
      onSave && onSave();
      onClose();
    } catch (error) {
      console.error('[EditOnboarding] ========= SAVE FAILED =========');
      console.error('[EditOnboarding] Error:', error);
      toast.error(`Failed to update onboarding details: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-2xl bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <h2 className="text-xl font-bold text-text-primary">Edit Onboarding Details</h2>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors"
            >
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Form */}
          <div className="space-y-4">
            {/* Position Details Section */}
            <div className="border border-border-secondary rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Position Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Job Title *</label>
                  <input
                    type="text"
                    value={formData.jobTitle}
                    onChange={(e) => handleChange('jobTitle', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Department</label>
                  <input
                    type="text"
                    value={formData.department}
                    onChange={(e) => handleChange('department', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    placeholder="e.g. Engineering"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Client Allocation</label>
                  <select
                    value={formData.clientId}
                    onChange={(e) => handleChange('clientId', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Client (Optional)</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Site Allocation</label>
                  <select
                    value={formData.siteId}
                    onChange={(e) => handleChange('siteId', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Site (Optional)</option>
                    {sites.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Employment Type *</label>
                  <select
                    value={formData.employmentType}
                    onChange={(e) => handleChange('employmentType', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    required
                  >
                    <option value="">Select Type</option>
                    <option value="Full-Time">Full-Time</option>
                    <option value="Part-Time">Part-Time</option>
                    <option value="Contract">Contract</option>
                    <option value="Temporary">Temporary</option>
                    <option value="Intern">Intern</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Start Date *</label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => handleChange('startDate', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Probation Period</label>
                  <select
                    value={formData.probationPeriod}
                    onChange={(e) => handleChange('probationPeriod', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Period</option>
                    <option value="1 Month">1 Month</option>
                    <option value="2 Months">2 Months</option>
                    <option value="3 Months">3 Months</option>
                    <option value="6 Months">6 Months</option>
                    <option value="12 Months">12 Months</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Work Location Section */}
            <div className="border border-border-secondary rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Work Location</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Primary Location</label>
                  <input
                    type="text"
                    value={formData.primaryWorkLocation}
                    onChange={(e) => handleChange('primaryWorkLocation', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    placeholder="e.g., Main Office - Building A"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Work Pattern</label>
                  <select
                    value={formData.workPattern}
                    onChange={(e) => handleChange('workPattern', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Pattern</option>
                    <option value="Office-Based">Office-Based</option>
                    <option value="Remote">Remote</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Flexible">Flexible</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-2">Office Address</label>
                  <textarea
                    value={formData.officeAddress}
                    onChange={(e) => handleChange('officeAddress', e.target.value)}
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    rows={3}
                    placeholder="Enter full office address"
                  />
                </div>
              </div>
            </div>
            {/* Bank Details Section */}
            <div className="border border-border-secondary rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Bank Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Account Name</label>
                  <input
                    type="text"
                    value={formData.bankAccountName}
                    onChange={(e) => handleChange('bankAccountName', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Bank Name</label>
                  <input
                    type="text"
                    value={formData.bankName}
                    onChange={(e) => handleChange('bankName', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Account Number</label>
                  <input
                    type="text"
                    value={formData.bankAccountNumber}
                    onChange={(e) => handleChange('bankAccountNumber', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Sort Code</label>
                  <input
                    type="text"
                    value={formData.sortCode}
                    onChange={(e) => handleChange('sortCode', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Branch Name</label>
                  <input
                    type="text"
                    value={formData.branchName}
                    onChange={(e) => handleChange('branchName', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">IBAN</label>
                  <input
                    type="text"
                    value={formData.iban}
                    onChange={(e) => handleChange('iban', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
              </div>
            </div>

            {/* Compensation Section */}
            <div className="border border-border-secondary rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Compensation & Rates</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Annual Salary</label>
                  <input
                    type="text"
                    value={formData.annualSalary}
                    onChange={(e) => handleChange('annualSalary', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    placeholder="e.g. 45000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Pay Frequency</label>
                  <select
                    value={formData.payFrequency}
                    onChange={(e) => handleChange('payFrequency', e.target.value)}
                    className="w-full h-12 px-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                  >
                    <option value="">Select Frequency</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Bi-Weekly">Bi-Weekly</option>
                    <option value="Annually">Annually</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Hourly Pay Rate (£)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">£</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.hourlyRate}
                      onChange={(e) => handleChange('hourlyRate', e.target.value)}
                      className="w-full h-12 pl-8 pr-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Charge Rate (£)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">£</span>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.chargeRate}
                      onChange={(e) => handleChange('chargeRate', e.target.value)}
                      className="w-full h-12 pl-8 pr-4 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-text-primary mb-2">Benefits</label>
                  <textarea
                    value={formData.benefits}
                    onChange={(e) => handleChange('benefits', e.target.value)}
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    rows={3}
                  />
                </div>
              </div>
            </div>

            {/* Additional Notes Section */}
            <div className="border border-border-secondary rounded-lg p-4">
              <h3 className="text-lg font-semibold text-text-primary mb-4">Additional Notes</h3>

              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">Admin Notes</label>
                  <textarea
                    value={formData.adminNotes}
                    onChange={(e) => handleChange('adminNotes', e.target.value)}
                    className="w-full px-4 py-3 border border-border-secondary rounded-lg text-md text-text-primary focus:outline-none focus:border-border-accent-purple"
                    rows={4}
                    placeholder="Enter any additional notes..."
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end pt-4">
            <Button
              onClick={onClose}
              variant='outline-secondary'
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              variant='gradient'
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditOnboardingModal;

