import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { trainingService } from '../../services/trainingService';
import { toast } from 'react-toastify';

const EditTrainingAssignmentModal = ({ isOpen, onClose, assignment, training, user, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  // Get today's date in YYYY-MM-DD format
  const getTodayDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayDate = getTodayDate();

  const [newHistoryEntry, setNewHistoryEntry] = useState({
    bookedDate: todayDate,
    completedDate: '',
    expiryDate: ''
  });

  // Load history entries when modal opens or assignment changes
  useEffect(() => {
    if (isOpen && assignment) {
      const historyLength = assignment.history?.length || 0;
      const historyKey = `${assignment.id}-${historyLength}`;

      console.log('[EditTrainingAssignmentModal] Loading history entries for assignment:', {
        assignmentId: assignment.id,
        historyKey: historyKey,
        hasHistory: !!assignment.history,
        historyType: Array.isArray(assignment.history) ? 'array' : typeof assignment.history,
        historyLength: historyLength,
        history: assignment.history,
        assignedDate: assignment.assignedDate?.toDate ? assignment.assignedDate.toDate().toISOString() : assignment.assignedDate,
        completedDate: assignment.completedDate?.toDate ? assignment.completedDate.toDate().toISOString() : assignment.completedDate,
        expiryDate: assignment.expiryDate?.toDate ? assignment.expiryDate.toDate().toISOString() : assignment.expiryDate
      });
      // Reset state and reload
      setHistoryEntries([]);
      setNewHistoryEntry({ bookedDate: '', completedDate: '', expiryDate: '' });
      loadHistoryEntries();
    }
  }, [isOpen, assignment?.id, assignment?.history?.length]);

  const loadHistoryEntries = () => {
    if (!assignment) {
      console.warn('[EditTrainingAssignmentModal] No assignment provided to loadHistoryEntries');
      return;
    }

    console.log('[EditTrainingAssignmentModal] Loading history entries:', {
      assignmentId: assignment.id,
      hasHistory: !!assignment.history,
      historyType: Array.isArray(assignment.history) ? 'array' : typeof assignment.history,
      historyLength: assignment.history?.length || 0,
      history: assignment.history,
      assignedDate: assignment.assignedDate?.toDate ? assignment.assignedDate.toDate().toISOString() : assignment.assignedDate,
      completedDate: assignment.completedDate?.toDate ? assignment.completedDate.toDate().toISOString() : assignment.completedDate,
      expiryDate: assignment.expiryDate?.toDate ? assignment.expiryDate.toDate().toISOString() : assignment.expiryDate
    });

    // Initialize with current assignment data if no history exists
    const currentEntry = {
      id: 'current',
      bookedDate: assignment.assignedDate,
      completedDate: assignment.completedDate || null,
      expiryDate: assignment.expiryDate || null,
      status: calculateStatus(assignment.assignedDate, assignment.completedDate, assignment.expiryDate)
    };

    // If assignment has history array, use it; otherwise use current entry
    if (assignment.history && Array.isArray(assignment.history) && assignment.history.length > 0) {
      console.log('[EditTrainingAssignmentModal] Processing history array with', assignment.history.length, 'entries');
      const history = assignment.history.map((entry, index) => {
        const historyEntry = {
          id: entry.id || `history-${index}`,
          bookedDate: entry.bookedDate || entry.assignedDate,
          completedDate: entry.completedDate || null,
          expiryDate: entry.expiryDate || null,
          status: calculateStatus(entry.bookedDate || entry.assignedDate, entry.completedDate, entry.expiryDate),
          createdAt: entry.createdAt || null
        };
        console.log(`[EditTrainingAssignmentModal] History entry ${index}:`, {
          id: historyEntry.id,
          booked: historyEntry.bookedDate?.toDate ? historyEntry.bookedDate.toDate().toISOString() : historyEntry.bookedDate,
          completed: historyEntry.completedDate?.toDate ? historyEntry.completedDate.toDate().toISOString() : historyEntry.completedDate,
          expiry: historyEntry.expiryDate?.toDate ? historyEntry.expiryDate.toDate().toISOString() : historyEntry.expiryDate,
          status: historyEntry.status
        });
        return historyEntry;
      });

      // Sort by createdAt descending (newest first)
      history.sort((a, b) => {
        const aDate = a.createdAt?.toDate ? a.createdAt.toDate() : (a.createdAt ? new Date(a.createdAt) : new Date(0));
        const bDate = b.createdAt?.toDate ? b.createdAt.toDate() : (b.createdAt ? new Date(b.createdAt) : new Date(0));
        return bDate - aDate;
      });

      // Show all history entries PLUS the current entry at the end
      // This way users can see the full history including the current state
      console.log('[EditTrainingAssignmentModal] Setting history entries - showing all history:', history.length, 'entries + current entry');
      console.log('[EditTrainingAssignmentModal] Current entry:', {
        booked: currentEntry.bookedDate?.toDate ? currentEntry.bookedDate.toDate().toISOString() : currentEntry.bookedDate,
        completed: currentEntry.completedDate?.toDate ? currentEntry.completedDate.toDate().toISOString() : currentEntry.completedDate,
        expiry: currentEntry.expiryDate?.toDate ? currentEntry.expiryDate.toDate().toISOString() : currentEntry.expiryDate
      });

      // Show all history entries plus the current entry at the end
      setHistoryEntries([...history, currentEntry]);
    } else {
      console.log('[EditTrainingAssignmentModal] No history found, using current entry only');
      setHistoryEntries([currentEntry]);
    }
  };

  const calculateStatus = (bookedDate, completedDate, expiryDate) => {
    const now = new Date();

    // If completed date is not filled, status is Pending
    if (!completedDate) {
      return 'Pending';
    }

    // Convert dates to Date objects
    let completed = null;
    if (completedDate) {
      if (completedDate.toDate) {
        completed = completedDate.toDate();
      } else if (completedDate instanceof Date) {
        completed = completedDate;
      } else {
        completed = new Date(completedDate);
      }
    }

    // If expiry date is not filled, status is Pending
    if (!expiryDate) {
      return 'Pending';
    }

    let expiry = null;
    if (expiryDate) {
      if (expiryDate.toDate) {
        expiry = expiryDate.toDate();
      } else if (expiryDate instanceof Date) {
        expiry = expiryDate;
      } else {
        expiry = new Date(expiryDate);
      }
    }

    if (!completed || !expiry || isNaN(completed.getTime()) || isNaN(expiry.getTime())) {
      return 'Pending';
    }

    // If past expiry date, status is Expired
    if (expiry < now) {
      return 'Expired';
    }

    // Calculate days until expiry
    const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    // If within 30 days of expiry, status is Expiring Soon
    if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
      return 'Expiring Soon';
    }

    // Otherwise, status is Completed
    return 'Completed';
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD format
  };

  const formatDateDisplay = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'Completed': return 'success';
      case 'Pending': return 'warning';
      case 'Expiring Soon': return 'warning';
      case 'Expired': return 'danger';
      default: return 'secondary';
    }
  };

  const handleAddHistoryEntry = () => {
    if (!newHistoryEntry.bookedDate) {
      toast.error('Date Course was booked is required');
      return;
    }

    const booked = new Date(newHistoryEntry.bookedDate);
    booked.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 1. Completed date: must not be before booked; must be today or in the future
    if (newHistoryEntry.completedDate) {
      const completed = new Date(newHistoryEntry.completedDate);
      completed.setHours(0, 0, 0, 0);
      if (completed < booked) {
        toast.error('Completed date cannot be before the booked (start) date');
        return;
      }
      if (completed < today) {
        toast.error('Completed date must be today or in the future');
        return;
      }
    }

    // 2. Expiry date: must not be before booked; must be after completed (if any); must be today or in the future
    if (newHistoryEntry.expiryDate) {
      const expiry = new Date(newHistoryEntry.expiryDate);
      expiry.setHours(0, 0, 0, 0);
      if (expiry < booked) {
        toast.error('Expiry date cannot be before the booked (start) date');
        return;
      }
      if (newHistoryEntry.completedDate) {
        const completed = new Date(newHistoryEntry.completedDate);
        completed.setHours(0, 0, 0, 0);
        if (expiry < completed) {
          toast.error('Expiry date cannot be before the completed date');
          return;
        }
      }
      if (expiry < today) {
        toast.error('Expiry date must be today or in the future');
        return;
      }
    }

    const entry = {
      id: `new-${Date.now()}`,
      bookedDate: newHistoryEntry.bookedDate,
      completedDate: newHistoryEntry.completedDate || null,
      expiryDate: newHistoryEntry.expiryDate || null,
      status: calculateStatus(newHistoryEntry.bookedDate, newHistoryEntry.completedDate, newHistoryEntry.expiryDate),
      createdAt: new Date().toISOString()
    };

    setHistoryEntries([...historyEntries, entry]);
    setNewHistoryEntry({ bookedDate: todayDate, completedDate: '', expiryDate: '' });
    toast.success('History entry added');
  };

  const handleRemoveHistoryEntry = (entryId) => {
    if (entryId === 'current') {
      toast.error('Cannot remove the current assignment entry');
      return;
    }
    setHistoryEntries(historyEntries.filter(entry => entry.id !== entryId));
  };

  const handleSave = async () => {
    if (!assignment || !user) return;

    try {
      setLoading(true);

      if (historyEntries.length === 0) {
        toast.error('No history entries found');
        return;
      }

      // Separate current entry and history entries
      const currentEntry = historyEntries.find(entry => entry.id === 'current');
      const nonCurrentEntries = historyEntries.filter(entry => entry.id !== 'current');

      // Find the latest entry (most recent expiry date or most recently added)
      let latestEntry = currentEntry;

      if (nonCurrentEntries.length > 0) {
        // Sort by expiry date descending, or by createdAt if no expiry date
        const sortedEntries = [...nonCurrentEntries].sort((a, b) => {
          const aExpiry = a.expiryDate?.toDate ? a.expiryDate.toDate() :
            (a.expiryDate ? new Date(a.expiryDate) : null);
          const bExpiry = b.expiryDate?.toDate ? b.expiryDate.toDate() :
            (b.expiryDate ? new Date(b.expiryDate) : null);

          if (aExpiry && bExpiry) {
            return bExpiry - aExpiry; // Most recent expiry first
          }
          if (aExpiry) return -1;
          if (bExpiry) return 1;

          // If no expiry dates, sort by createdAt
          const aCreated = a.createdAt?.toDate ? a.createdAt.toDate() :
            (a.createdAt ? new Date(a.createdAt) : new Date(0));
          const bCreated = b.createdAt?.toDate ? b.createdAt.toDate() :
            (b.createdAt ? new Date(b.createdAt) : new Date(0));
          return bCreated - aCreated;
        });

        latestEntry = sortedEntries[0]; // Get the most recent entry
      }

      if (!latestEntry) {
        toast.error('No valid entry found');
        return;
      }

      // Update assignment with latest history entry data
      const companyId = user.companyId.includes('/') ? user.companyId.split('/')[1] : user.companyId;

      // Recalculate status for latest entry
      const newStatus = calculateStatus(latestEntry.bookedDate, latestEntry.completedDate, latestEntry.expiryDate);

      // Helper function to convert to ISO string
      const toIso = (date) => {
        if (!date) return null;
        if (date.toDate && typeof date.toDate === 'function') return date.toDate().toISOString();
        const d = new Date(date);
        return isNaN(d.getTime()) ? null : d.toISOString();
      };

      // Prepare history array - save ALL entries (both existing history and new ones)
      // The latest entry will become the new current (updates main assignment dates)

      // Get existing history from assignment (if any) - these are already in Firestore format
      const existingHistory = assignment.history && Array.isArray(assignment.history) ? assignment.history : [];

      // Helper to normalize an entry to REST format
      const normalizeEntry = (entry) => {
        return {
          bookedDate: toIso(entry.bookedDate),
          completedDate: toIso(entry.completedDate),
          expiryDate: toIso(entry.expiryDate),
          status: entry.status || calculateStatus(entry.bookedDate, entry.completedDate, entry.expiryDate),
          createdAt: entry.createdAt ? toIso(entry.createdAt) : new Date().toISOString()
        };
      };

      // Start with existing history (normalized)
      const historyArray = existingHistory.map(normalizeEntry);

      // Add new non-current entries (avoid duplicates by checking createdAt)
      nonCurrentEntries.forEach(newEntry => {
        const newEntryNormalized = normalizeEntry(newEntry);
        // Check if this entry already exists (by comparing all three dates)
        const exists = historyArray.some(existing => {
          const existingBooked = existing.bookedDate?.toDate ? existing.bookedDate.toDate().toISOString() : '';
          const existingCompleted = existing.completedDate?.toDate ? existing.completedDate.toDate().toISOString() : '';
          const existingExpiry = existing.expiryDate?.toDate ? existing.expiryDate.toDate().toISOString() : '';

          const newBooked = newEntryNormalized.bookedDate?.toDate ? newEntryNormalized.bookedDate.toDate().toISOString() : '';
          const newCompleted = newEntryNormalized.completedDate?.toDate ? newEntryNormalized.completedDate.toDate().toISOString() : '';
          const newExpiry = newEntryNormalized.expiryDate?.toDate ? newEntryNormalized.expiryDate.toDate().toISOString() : '';

          return existingBooked === newBooked &&
            existingCompleted === newCompleted &&
            existingExpiry === newExpiry;
        });

        if (!exists) {
          historyArray.push(newEntryNormalized);
        }
      });

      console.log('Preparing history array:', {
        existingHistoryCount: existingHistory.length,
        newEntriesCount: nonCurrentEntries.length,
        totalEntries: historyArray.length,
        entries: historyArray.map(e => ({
          booked: e.bookedDate?.toDate ? e.bookedDate.toDate().toISOString() : e.bookedDate,
          completed: e.completedDate?.toDate ? e.completedDate.toDate().toISOString() : e.completedDate,
          expiry: e.expiryDate?.toDate ? e.expiryDate.toDate().toISOString() : e.expiryDate,
          status: e.status,
          createdAt: e.createdAt?.toDate ? e.createdAt.toDate().toISOString() : e.createdAt
        }))
      });

      // Update assignment document
      const updateData = {
        assignedDate: toIso(latestEntry.bookedDate || assignment.assignedDate),
        completedDate: toIso(latestEntry.completedDate) || null,
        expiryDate: toIso(latestEntry.expiryDate) || null,
        history: historyArray,
        updatedAt: new Date().toISOString()
      };

      // Update status based on latest entry
      if (newStatus === 'Completed' && latestEntry.completedDate && latestEntry.expiryDate) {
        updateData.status = 'completed';
      } else if (newStatus === 'Expired') {
        updateData.status = 'expired';
      } else if (newStatus === 'Expiring Soon') {
        updateData.status = 'completed'; // Keep as completed but will show expiring soon
      } else {
        updateData.status = 'assigned';
      }

      console.log('Saving assignment update:', {
        assignmentId: assignment.id,
        updateData: {
          ...updateData,
          assignedDate: updateData.assignedDate?.toDate ? updateData.assignedDate.toDate().toISOString() : updateData.assignedDate,
          completedDate: updateData.completedDate?.toDate ? updateData.completedDate.toDate().toISOString() : updateData.completedDate,
          expiryDate: updateData.expiryDate?.toDate ? updateData.expiryDate.toDate().toISOString() : updateData.expiryDate,
          historyCount: updateData.history?.length || 0
        }
      });

      const result = await trainingService.updateAssignment(assignment.id, updateData, user.uid, companyId);
      console.log('Assignment update result:', result);

      if (result.success) {
        toast.success('Training assignment updated successfully');
        if (onUpdate) {
          // Pass the updated assignment back to the parent to avoid re-fetching
          onUpdate(result.data || { ...assignment, ...updateData });
        }
        onClose();
      } else {
        throw new Error(result.error || 'Failed to update assignment');
      }
    } catch (error) {
      console.error('Error updating training assignment:', error);
      toast.error(error.message || 'Failed to update training assignment');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !assignment || !training) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>

      <div className="relative w-full max-w-[900px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-text-primary">{training?.name || 'Edit Training Assignment'}</h2>
              <p className="text-sm text-text-secondary mt-1">{training?.description || ''}</p>
            </div>
            <button onClick={onClose} className="w-6 h-6 flex items-center justify-center bg-black/10 rounded-full hover:bg-black/20 transition-colors flex-shrink-0">
              <X className="h-4 w-4 text-text-secondary" />
            </button>
          </div>

          {/* Training Information Section */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">Training Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-blue-700 mb-1">Category</p>
                <p className="text-md font-semibold text-blue-900">{training?.category || training?.trainingType || 'General'}</p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Type</p>
                <p className="text-md font-semibold text-blue-900">{training?.type || 'Mandatory'}</p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Priority</p>
                <p className="text-md font-semibold text-blue-900 capitalize">{training?.priority || 'Medium'}</p>
              </div>
              <div>
                <p className="text-sm text-blue-700 mb-1">Validity Period</p>
                <p className="text-md font-semibold text-blue-900">{training?.validityPeriod || 365} days</p>
              </div>
            </div>
          </div>

          {/* Training History Section */}
          <div>
            <h3 className="text-lg font-semibold text-text-primary mb-4">Training History</h3>

            {/* History Table */}
            <div className="border border-border-secondary rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Date Course was booked</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Date Course was completed</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Date Course expires</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">Course Status</th>
                    <th className="px-4 py-3 text-center text-sm font-semibold text-text-primary">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-secondary">
                  {historyEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-text-primary">
                        {formatDateDisplay(entry.bookedDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-primary">
                        {formatDateDisplay(entry.completedDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-primary">
                        {formatDateDisplay(entry.expiryDate)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getStatusVariant(entry.status)}>
                          {entry.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {entry.id !== 'current' && (
                          <button
                            onClick={() => handleRemoveHistoryEntry(entry.id)}
                            className="text-red-500 hover:text-red-700 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Add New History Entry */}
            <div className="mt-4 p-4 bg-gray-50 border border-border-secondary rounded-lg">
              <h4 className="text-md font-semibold text-text-primary mb-3">Add New History Entry</h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Date Course was booked
                  </label>
                  <input
                    type="date"
                    value={newHistoryEntry.bookedDate}
                    onChange={(e) => setNewHistoryEntry({ ...newHistoryEntry, bookedDate: e.target.value })}
                    className="w-full h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Date Course was completed
                  </label>
                  <input
                    type="date"
                    value={newHistoryEntry.completedDate}
                    onChange={(e) => setNewHistoryEntry({ ...newHistoryEntry, completedDate: e.target.value })}
                    min={(() => {
                      if (!newHistoryEntry.bookedDate) return todayDate;
                      const booked = new Date(newHistoryEntry.bookedDate);
                      const today = new Date(todayDate);
                      return booked > today ? newHistoryEntry.bookedDate : todayDate;
                    })()}
                    className="w-full h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Date Course expires
                  </label>
                  <input
                    type="date"
                    value={newHistoryEntry.expiryDate}
                    onChange={(e) => setNewHistoryEntry({ ...newHistoryEntry, expiryDate: e.target.value })}
                    min={(() => {
                      const ref = newHistoryEntry.completedDate || newHistoryEntry.bookedDate;
                      if (!ref) return todayDate;
                      const refDate = new Date(ref);
                      const today = new Date(todayDate);
                      return refDate > today ? ref : todayDate;
                    })()}
                    className="w-full h-10 px-3 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    variant="outline-primary"
                    icon={Plus}
                    onClick={handleAddHistoryEntry}
                    disabled={!newHistoryEntry.bookedDate}
                    cn="w-full"
                  >
                    Add Entry
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            <Button
              variant="outline-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              variant="solid-primary"
              onClick={handleSave}
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

export default EditTrainingAssignmentModal;

