import React, { useState, useEffect } from 'react';
import { AlertTriangle, RefreshCw, CheckCircle, XCircle, Users, Calendar, Clock, Trash2, Settings } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import { Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from '../shared/Table';
import LoadingSkeleton from '../ui/LoadingSkeleton';
import { timesheetDeduplication } from '../../services/timesheetDeduplication';
import { timesheetConsistency } from '../../utils/timesheetConsistency';
import { timesheetValidation } from '../../services/timesheetValidation';
import { toast } from 'react-toastify';
import { formatTimeDisplay } from '../../utils/numberFormatter';

const TimesheetDuplicateManager = () => {
  const [duplicateData, setDuplicateData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [filterStatus, setFilterStatus] = useState('all');
  const [stats, setStats] = useState(null);
  const [showBulkActions, setShowBulkActions] = useState(false);

  // Load duplicate data
  const loadDuplicates = async () => {
    setLoading(true);
    try {
      // This would typically be a backend API call
      // For now, we'll simulate loading duplicate data
      const mockData = [
        {
          id: 'dup-1',
          userId: 'user123',
          userName: 'John Doe',
          weekStart: '2025-10-13',
          weekEnd: '2025-10-19',
          duplicateGroups: [
            { date: '2025-10-13', count: 3 },
            { date: '2025-10-15', count: 2 }
          ],
          totalDocs: 12,
          status: 'detected',
          lastDetected: new Date('2025-10-19T10:00:00Z')
        },
        {
          id: 'dup-2',
          userId: 'user456',
          userName: 'Jane Smith',
          weekStart: '2025-10-06',
          weekEnd: '2025-10-12',
          duplicateGroups: [
            { date: '2025-10-08', count: 2 }
          ],
          totalDocs: 8,
          status: 'detected',
          lastDetected: new Date('2025-10-12T15:30:00Z')
        }
      ];
      
      setDuplicateData(mockData);
      
      // Calculate stats
      const totalUsers = new Set(mockData.map(d => d.userId)).size;
      const totalDuplicateGroups = mockData.reduce((sum, d) => sum + d.duplicateGroups.length, 0);
      const totalExcessDocs = mockData.reduce((sum, d) => sum + (d.totalDocs - 7), 0);
      
      setStats({
        totalUsers,
        totalDuplicateGroups,
        totalExcessDocs,
        avgDuplicatesPerUser: totalUsers > 0 ? (totalDuplicateGroups / totalUsers).toFixed(1) : 0
      });
      
    } catch (error) {
      console.error('Failed to load duplicate data:', error);
      toast.error('Failed to load duplicate data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDuplicates();
  }, []);

  // Handle individual duplicate resolution
  const handleResolveDuplicate = async (duplicateItem, strategy = 'latest') => {
    setProcessing(true);
    try {
      console.log(`Resolving duplicates for user ${duplicateItem.userId}, week ${duplicateItem.weekStart}`);
      
      const cleanupResult = await timesheetDeduplication.cleanupDuplicates(
        duplicateItem.userId, 
        duplicateItem.weekStart, 
        { strategy, dryRun: false }
      );
      
      if (cleanupResult.success) {
        toast.success(`Resolved ${cleanupResult.cleaned} duplicate entries for ${duplicateItem.userName}`);
        
        // Remove from list
        setDuplicateData(prev => prev.filter(d => d.id !== duplicateItem.id));
        
        // Update stats
        setStats(prev => ({
          ...prev,
          totalUsers: prev.totalUsers - 1,
          totalDuplicateGroups: prev.totalDuplicateGroups - duplicateItem.duplicateGroups.length,
          totalExcessDocs: prev.totalExcessDocs - (duplicateItem.totalDocs - 7)
        }));
      } else {
        toast.error('Failed to resolve duplicates');
      }
      
    } catch (error) {
      console.error('Failed to resolve duplicate:', error);
      toast.error(`Failed to resolve duplicates: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Handle bulk resolution
  const handleBulkResolve = async (strategy = 'latest') => {
    if (selectedItems.size === 0) {
      toast.warning('Please select items to resolve');
      return;
    }

    setProcessing(true);
    try {
      const selectedDuplicates = duplicateData.filter(d => selectedItems.has(d.id));
      let successCount = 0;
      let failCount = 0;

      for (const duplicate of selectedDuplicates) {
        try {
          const cleanupResult = await timesheetDeduplication.cleanupDuplicates(
            duplicate.userId, 
            duplicate.weekStart, 
            { strategy, dryRun: false }
          );
          
          if (cleanupResult.success) {
            successCount++;
          } else {
            failCount++;
          }
        } catch (error) {
          console.error(`Failed to resolve duplicate for ${duplicate.userId}:`, error);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Successfully resolved duplicates for ${successCount} users`);
        
        // Remove resolved items from list
        setDuplicateData(prev => prev.filter(d => !selectedItems.has(d.id)));
        setSelectedItems(new Set());
      }

      if (failCount > 0) {
        toast.error(`Failed to resolve duplicates for ${failCount} users`);
      }

    } catch (error) {
      console.error('Bulk resolution failed:', error);
      toast.error('Bulk resolution failed');
    } finally {
      setProcessing(false);
    }
  };

  // Handle item selection
  const handleItemSelect = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  // Handle select all
  const handleSelectAll = () => {
    if (selectedItems.size === filteredData.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredData.map(d => d.id)));
    }
  };

  // Filter data
  const filteredData = duplicateData.filter(item => {
    if (filterStatus === 'all') return true;
    return item.status === filterStatus;
  });

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStatusVariant = (status) => {
    switch (status) {
      case 'detected': return 'warning';
      case 'resolved': return 'success';
      case 'failed': return 'danger';
      default: return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Timesheet Duplicate Manager</h2>
          <p className="text-sm text-text-secondary mt-1">
            Detect and resolve duplicate timesheet entries across the system
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline-secondary"
            icon={RefreshCw}
            onClick={loadDuplicates}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="outline-primary"
            icon={Settings}
            onClick={() => setShowBulkActions(!showBulkActions)}
          >
            Bulk Actions
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-border-secondary">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Affected Users</p>
                <p className="text-xl font-bold text-text-primary">{stats.totalUsers}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-lg border border-border-secondary">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Duplicate Groups</p>
                <p className="text-xl font-bold text-text-primary">{stats.totalDuplicateGroups}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-lg border border-border-secondary">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Excess Documents</p>
                <p className="text-xl font-bold text-text-primary">{stats.totalExcessDocs}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-white p-4 rounded-lg border border-border-secondary">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-text-secondary">Avg per User</p>
                <p className="text-xl font-bold text-text-primary">{stats.avgDuplicatesPerUser}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters and Bulk Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-text-secondary">Filter by status:</span>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
          >
            <option value="all">All Status</option>
            <option value="detected">Detected</option>
            <option value="resolved">Resolved</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {showBulkActions && selectedItems.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">
              {selectedItems.size} selected
            </span>
            <Button
              variant="outline-primary"
              onClick={() => handleBulkResolve('latest')}
              disabled={processing}
            >
              Resolve Selected (Latest)
            </Button>
            <Button
              variant="outline-secondary"
              onClick={() => handleBulkResolve('sum')}
              disabled={processing}
            >
              Resolve Selected (Sum)
            </Button>
          </div>
        )}
      </div>

      {/* Duplicates Table */}
      <div className="bg-white border border-border-primary rounded-lg">
        {loading ? (
          <div className="p-6">
            <LoadingSkeleton type="table" rows={5} columns={6} />
          </div>
        ) : filteredData.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-text-primary mb-2">No Duplicates Found</h3>
            <p className="text-text-secondary">All timesheet data appears to be consistent.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableHeaderCell>
                <input
                  type="checkbox"
                  checked={selectedItems.size === filteredData.length && filteredData.length > 0}
                  onChange={handleSelectAll}
                  className="rounded border-border-secondary"
                />
              </TableHeaderCell>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Week Period</TableHeaderCell>
              <TableHeaderCell>Duplicate Groups</TableHeaderCell>
              <TableHeaderCell>Total Docs</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableHeader>
            <TableBody>
              {filteredData.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => handleItemSelect(item.id)}
                      className="rounded border-border-secondary"
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-semibold text-text-primary">{item.userName}</p>
                      <p className="text-xs text-text-secondary">{item.userId}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-text-primary">
                        {formatDate(item.weekStart)} - {formatDate(item.weekEnd)}
                      </p>
                      <p className="text-xs text-text-secondary">
                        Detected: {formatDate(item.lastDetected)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {item.duplicateGroups.map((group, index) => (
                        <div key={index} className="flex items-center gap-2 text-xs">
                          <span className="text-text-secondary">{group.date}:</span>
                          <Badge variant="warning" className="text-xs">
                            {group.count} entries
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-center">
                      <p className="font-semibold text-text-primary">{item.totalDocs}</p>
                      <p className="text-xs text-text-secondary">
                        ({item.totalDocs - 7} excess)
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(item.status)}>
                      {item.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline-primary"
                        onClick={() => handleResolveDuplicate(item, 'latest')}
                        disabled={processing}
                        className="text-xs"
                      >
                        Resolve (Latest)
                      </Button>
                      <Button
                        variant="outline-secondary"
                        onClick={() => handleResolveDuplicate(item, 'sum')}
                        disabled={processing}
                        className="text-xs"
                      >
                        Resolve (Sum)
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Processing Overlay */}
      {processing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-lg p-6 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
              <p className="text-text-primary">Processing duplicates...</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimesheetDuplicateManager;