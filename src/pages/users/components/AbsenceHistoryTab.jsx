import React, { useState } from 'react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import EditAbsenceModal from '../../../components/modals/EditAbsenceModal';
import ViewAbsenceModal from '../../../components/modals/ViewAbsenceModal';
import { absenceService } from '../../../services/absenceService';
import { allowanceService } from '../../../services/allowanceService';
import { toast } from 'react-toastify';

const AbsencesHistoryTab = ({ absences, currentUser, refreshAbsences }) => {
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAbsence, setSelectedAbsence] = useState(null);
  const handleOpenEdit = (absence) => {
    console.log('Edit absence:', absence);
    setSelectedAbsence(absence);
    setHistoryModalOpen(true);
  }
  const handleOpenView = async (absence) => {
    // Show modal immediately with existing data
    setSelectedAbsence(absence);
    setShowViewModal(true);

    // Only fetch fresh allowance data if user is a manager and absence has a leave type
    if (['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(currentUser?.role) && absence.leaveType) {
      try {
        const allowanceSummary = await allowanceService.getAllowanceSummary(absence.userId, absence.leaveType);
        if (allowanceSummary) {
          // Update the selected absence with fresh allowance data
          setSelectedAbsence(prev => ({
            ...prev,
            allowanceInfo: allowanceSummary
          }));
        }
      } catch (error) {
        console.error('Error fetching fresh allowance data:', error);
        // Modal is already open with existing data, so no need to handle error
      }
    }
  }
  const handleEditSave = async (updatedData) => {
    try {
      const absenceId = selectedAbsence.id;

      // Call the absence service to update the data
      await absenceService.updateAbsence(absenceId, updatedData, currentUser);

      toast.success('Absence updated successfully!');

      // Refresh the absences data to show the updated information
      if (refreshAbsences) {
        await refreshAbsences();
      }

    } catch (error) {
      console.error('Error updating absence:', error);
      toast.error('Failed to update absence. Please try again.');
    }

    setHistoryModalOpen(false);
    setSelectedAbsence(null);
  }
  const handleApprove = async (absenceId) => {
    try {
      await absenceService.approveAbsence(absenceId, currentUser);
      toast.success('Absence request approved successfully!');
      if (refreshAbsences) {
        await refreshAbsences();
      }
    } catch (error) {
      console.error('Error approving absence:', error);
      toast.error('Failed to approve absence. Please try again.');
    }
    setShowViewModal(false);
  };

  const handleDecline = async (absenceId, reason) => {
    try {
      await absenceService.declineAbsence(absenceId, reason, currentUser);
      toast.success('Absence request declined successfully!');
      if (refreshAbsences) {
        await refreshAbsences();
      }
    } catch (error) {
      console.error('Error declining absence:', error);
      toast.error('Failed to decline absence. Please try again.');
    }
    setShowViewModal(false);
  };

  const handleCancel = async (absenceId, reason) => {
    try {
      await absenceService.cancelAbsence(absenceId, { cancellationReason: reason }, currentUser);
      toast.success('Absence request cancelled successfully!');
      if (refreshAbsences) {
        await refreshAbsences();
      }
    } catch (error) {
      console.error('Error cancelling absence:', error);
      toast.error('Failed to cancel absence. Please try again.');
    }
    setShowViewModal(false);
  };

  return (
    <>
      <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
        <h3 className="text-xl md:text-2xl font-bold text-text-primary">Absences History</h3>

        {/* Desktop View - Table */}
        <div className="hidden md:block overflow-x-auto scrollbar-custom">
          {absences.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4m-6 0V6a2 2 0 012-2h4a2 2 0 012 2v1m-6 0h8m-8 0H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-2m-8 0V7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No absence history</h3>
              <p className="text-gray-600">This employee has no absence records.</p>
            </div>
          ) : (
            <div className="min-w-[900px]  space-y-4">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-bg-secondary rounded-lg text-xs font-semibold text-text-secondary uppercase">
                <div className="col-span-2">Type</div>
                <div className="col-span-3">Reason</div>
                <div className="col-span-2">Date</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-3">Actions</div>
              </div>

              {/* Table Rows */}
              {absences.map((absence, index) => (
                <div key={index} className="grid grid-cols-12 gap-4 px-4 py-4 border border-border-secondary rounded-lg items-center hover:bg-bg-secondary transition-colors">
                  <div className="col-span-2 font-semibold text-text-primary">{absence.leave}</div>
                  <div className="col-span-3 text-sm text-text-secondary">{absence.reason}</div>
                  <div className="col-span-2 text-sm text-text-secondary">{absence.date}</div>
                  <div className="col-span-2">
                    <Badge variant={absence.status === 'Approved' ? 'success' : absence.status === 'Pending' ? 'warning' : 'info'}>
                      {absence.status}
                    </Badge>
                  </div>
                  <div className="col-span-2 flex gap-2 text-sm text-text-secondary">

                    <Button variant="outline-primary" onClick={() => {
                      handleOpenView(absence);
                    }} >View</Button>

                    {
                      absence.status == "Pending" &&

                      <Button variant="outline-primary" onClick={() => {
                        handleOpenEdit(absence);
                      }} >Edit</Button>

                    }
                  </div>

                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mobile View - Cards */}
        <div className="md:hidden space-y-4">
          {absences.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3a2 2 0 012-2h4a2 2 0 012 2v4m-6 0V6a2 2 0 012-2h4a2 2 0 012 2v1m-6 0h8m-8 0H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-2m-8 0V7" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No absence history</h3>
              <p className="text-gray-600">This employee has no absence records.</p>
            </div>
          ) : (
            absences.map((absence, index) => (
              <div key={index} className="border border-border-secondary rounded-lg p-4 space-y-3 hover:bg-bg-secondary transition-colors">
                {/* Leave Type and Status */}
                <div className="flex justify-between items-start gap-2">
                  <h4 className="font-semibold text-text-primary">{absence.leave}</h4>
                  <Badge variant={absence.status === 'Approved' ? 'success' : absence.status === 'Pending' ? 'warning' : 'info'}>
                    {absence.status}
                  </Badge>
                </div>

                {/* Details */}
                <div className="space-y-2 text-sm">
                  <div className="flex flex-col gap-1">
                    <span className="text-text-secondary">Reason:</span>
                    <span className="font-medium text-text-primary">{absence.reason}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Date:</span>
                    <span className="font-medium text-text-primary">{absence.date}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 flex gap-2" >
                  <Button variant="outline-primary" onClick={() => {
                    handleOpenView(absence);
                  }} >View</Button>

                  {
                    absence.status == "Pending" &&
                    <Button variant="outline-primary" className="w-full" onClick={() => {
                      handleOpenEdit(absence);
                    }}>
                      Edit
                    </Button>
                  }
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <ViewAbsenceModal
        isOpen={showViewModal}
        onClose={() => {
          setShowViewModal(false);
          setSelectedAbsence(null);
        }}
        absence={selectedAbsence}
        onApprove={handleApprove}
        onDecline={handleDecline}
        onCancel={handleCancel}
        currentUser={currentUser}
      />

      <EditAbsenceModal
        isOpen={historyModalOpen}
        onClose={() => setHistoryModalOpen(false)}
        onSave={handleEditSave}
        absence={selectedAbsence}
      />
    </>

  );
};

export default AbsencesHistoryTab;