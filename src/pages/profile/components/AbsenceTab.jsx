import { useState, useEffect } from "react";
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "../../../components/shared/Table";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import EditAbsenceModal from "../../../components/modals/EditAbsenceModal";
import AddAbsenceModal from "../../../components/modals/AddAbsenceModal";
import { Plus } from 'lucide-react';
import ViewAbsenceModal from "../../../components/modals/ViewAbsenceModal";
import { useAuth } from "../../../hooks/useAuth";
import { absenceService } from "../../../services/absenceService";
import { allowanceService } from "../../../services/allowanceService";
import { toast, Slide } from 'react-toastify';

export const AbsencesTab = () => {
  const { user } = useAuth();
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAbsence, setSelectedAbsence] = useState(null);
  const [absences, setAbsences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load user's absences on component mount and when user changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadAbsences();
  }, [user?.userId]);

  const loadAbsences = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      const userAbsences = await absenceService.getUserAbsences(user.userId);
      setAbsences(userAbsences.map(absence => ({
        ...absence,
        leave: absence.leaveType,
        date: formatDateRange(absence.startDate, absence.endDate)
      })));
    } catch (err) {
      console.error('Error loading absences:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDateRange = (startDate, endDate) => {
    if (!startDate || !endDate) return 'N/A';

    const start = new Date(startDate);
    const end = new Date(endDate);

    const formatDate = (date) => {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: start.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
      });
    };

    if (start.toDateString() === end.toDateString()) {
      return formatDate(start);
    }

    return `${formatDate(start)}-${formatDate(end)}`;
  };

  const handleEditAbsence = (absence) => {
    setSelectedAbsence(absence);
    setShowEditModal(true);
  };

  const handleViewAbsence = async (absence) => {
    // Show modal immediately with existing data
    setSelectedAbsence(absence);
    setShowViewModal(true);

    // Only fetch fresh allowance data if user is a manager and absence has a leave type
    if (['siteManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'teamManager'].includes(user?.role) && absence.leaveType) {
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

  const handleSaveAbsence = async (updatedData) => {
    try {
      await absenceService.updateAbsence(selectedAbsence.id, updatedData, user);
      toast.success('Absence request updated successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });
      loadAbsences(); // Reload data to show the updated absence
    } catch (err) {
      console.error('Error saving absence:', err);
      setError(err.message);
      toast.error('Failed to update absence request. Please try again.');
    }
  };

  const handleAddAbsence = async (newAbsence) => {
    try {
      await absenceService.createAbsence(newAbsence, user.userId);
      toast.success('Absence request created successfully!', {
        position: "top-center",
        transition: Slide,
        theme: "colored",
        autoClose: 3000
      });
      loadAbsences(); // Reload data to show the new absence
    } catch (err) {
      console.error('Error adding absence:', err);
      setError(err.message);
      toast.error('Failed to create absence request. Please try again.');
    }
  };

  const handleApprove = async (absenceId) => {
    try {
      await absenceService.approveAbsence(absenceId, user);
      toast.success('Absence request approved successfully!');
      loadAbsences(); // Reload data to show the updated status
      setShowViewModal(false);
    } catch (err) {
      console.error('Error approving absence:', err);
      setError(err.message);
      toast.error('Failed to approve absence request. Please try again.');
    }
  };

  const handleDecline = async (absenceId, reason) => {
    try {
      await absenceService.declineAbsence(absenceId, reason, user);
      toast.success('Absence request declined successfully!');
      loadAbsences(); // Reload data to show the updated status
      setShowViewModal(false);
    } catch (err) {
      console.error('Error declining absence:', err);
      setError(err.message);
      toast.error('Failed to decline absence request. Please try again.');
    }
  };

  return (
    <>
      <div className="bg-white p-4 rounded-base shadow-lg space-y-4xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-text-primary">Absences History</h2>
          <Button
            variant="gradient"
            icon={Plus}
            onClick={() => setShowAddModal(true)}
          >
            Add Absence
          </Button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm mb-4">
            {error}
          </div>
        )}

        <div className="bg-white border border-border-primary rounded-base">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-4"></div>
              <p className="text-text-secondary">Loading your absences...</p>
            </div>
          ) : absences.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-text-secondary">No absence requests found.</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableHeaderCell>Leave</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableHeader>
                <TableBody>
                  {absences.map((absence, index) => (
                    <TableRow key={absence.id || index}>
                      <TableCell>
                        <span className="font-medium text-text-primary">{absence.leave}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{absence.reason}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-text-secondary">{absence.date}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={absence.status === 'Approved' ? 'success' : absence.status === 'Rejected' ? 'danger' : 'warning'}>
                          {absence.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline-primary"
                            onClick={() => handleViewAbsence(absence)}
                          >
                            View
                          </Button>
                          {
                            absence.status == "Pending" &&
                            <Button
                              variant="outline-primary"
                              onClick={() => handleEditAbsence(absence)}
                            >
                              Edit
                            </Button>
                          }
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs py-4 text-text-secondary text-center md:hidden">
                ← Scroll horizontally to view all columns →
              </p>
            </>
          )}
        </div>
      </div>

      {/* Add Absence Modal */}
      <AddAbsenceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSave={handleAddAbsence}
        userId={user?.uid}
      />

      <ViewAbsenceModal
        isOpen={showViewModal}
        onClose={() => {
          setShowViewModal(false);
          setSelectedAbsence(null);
        }}
        absence={selectedAbsence}
        onApprove={handleApprove}
        onDecline={handleDecline}
        currentUser={user}
      />

      {/* Edit Absence Modal */}
      <EditAbsenceModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setSelectedAbsence(null);
        }}
        absence={selectedAbsence}
        onSave={handleSaveAbsence}
      />
    </>
  );
};