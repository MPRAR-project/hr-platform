import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Shield, AlertTriangle, CheckCircle, TrendingUp, Users, Calendar, RefreshCw, Download } from 'lucide-react';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import LoadingSkeleton from '../ui/LoadingSkeleton';
import { timesheetConsistency } from '../../utils/timesheetConsistency';
import { timesheetDeduplication } from '../../services/timesheetDeduplication';
import { toast } from 'react-toastify';

const TimesheetConsistencyDashboard = () => {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTimeRange, setSelectedTimeRange] = useState('4weeks');
  const [autoRefresh, setAutoRefresh] = useState(false);

  // Load dashboard data
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Simulate loading consistency data
      // In a real implementation, this would call backend APIs
      const mockData = {
        overview: {
          totalUsers: 156,
          consistentUsers: 142,
          inconsistentUsers: 14,
          consistencyRate: 91.0,
          totalIssuesResolved: 23,
          lastScanDate: new Date()
        },
        issueTypes: [
          { name: 'Duplicates', count: 12, color: '#f59e0b' },
          { name: 'Missing Metadata', count: 8, color: '#ef4444' },
          { name: 'Inconsistent Keys', count: 3, color: '#8b5cf6' }
        ],
        weeklyTrend: [
          { week: 'Week 1', consistent: 89, inconsistent: 11 },
          { week: 'Week 2', consistent: 92, inconsistent: 8 },
          { week: 'Week 3', consistent: 88, inconsistent: 12 },
          { week: 'Week 4', consistent: 91, inconsistent: 9 }
        ],
        recentActivity: [
          {
            id: 1,
            type: 'auto_repair',
            message: 'Auto-repaired 3 duplicate entries for John Doe',
            timestamp: new Date(Date.now() - 1000 * 60 * 30),
            severity: 'success'
          },
          {
            id: 2,
            type: 'detection',
            message: 'Detected inconsistent week keys for 2 users',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
            severity: 'warning'
          },
          {
            id: 3,
            type: 'bulk_repair',
            message: 'Bulk repair completed for 5 users',
            timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4),
            severity: 'success'
          }
        ],
        userStats: [
          { userId: 'user123', name: 'John Doe', consistencyRate: 85, issueCount: 3, lastCheck: new Date() },
          { userId: 'user456', name: 'Jane Smith', consistencyRate: 95, issueCount: 1, lastCheck: new Date() },
          { userId: 'user789', name: 'Bob Johnson', consistencyRate: 78, issueCount: 5, lastCheck: new Date() }
        ]
      };

      setDashboardData(mockData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      toast.error('Failed to load consistency dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [selectedTimeRange]);

  // Auto-refresh functionality
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      loadDashboardData();
    }, 5 * 60 * 1000); // Refresh every 5 minutes

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Handle bulk consistency check
  const handleBulkConsistencyCheck = async () => {
    try {
      toast.info('Starting bulk consistency check...');
      
      // This would trigger a backend job to check all users
      // For now, we'll simulate the process
      setTimeout(() => {
        toast.success('Bulk consistency check completed');
        loadDashboardData();
      }, 3000);
      
    } catch (error) {
      console.error('Bulk consistency check failed:', error);
      toast.error('Bulk consistency check failed');
    }
  };

  // Export consistency report
  const handleExportReport = () => {
    if (!dashboardData) return;

    const reportData = {
      generatedAt: new Date().toISOString(),
      overview: dashboardData.overview,
      issueTypes: dashboardData.issueTypes,
      weeklyTrend: dashboardData.weeklyTrend,
      userStats: dashboardData.userStats
    };

    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-consistency-report-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success('Consistency report exported');
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'success': return 'text-green-600';
      case 'warning': return 'text-orange-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton type="dashboard" />
      </div>
    );
  }

  if (!dashboardData) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-text-primary mb-2">Failed to Load Dashboard</h3>
        <Button onClick={loadDashboardData}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Timesheet Consistency Dashboard</h2>
          <p className="text-sm text-text-secondary mt-1">
            Monitor and maintain timesheet data integrity across the system
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoRefresh"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-border-secondary"
            />
            <label htmlFor="autoRefresh" className="text-sm text-text-secondary">
              Auto-refresh
            </label>
          </div>
          <select
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value)}
            className="px-3 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
          >
            <option value="1week">Last Week</option>
            <option value="4weeks">Last 4 Weeks</option>
            <option value="12weeks">Last 12 Weeks</option>
          </select>
          <Button
            variant="outline-secondary"
            icon={RefreshCw}
            onClick={loadDashboardData}
          >
            Refresh
          </Button>
          <Button
            variant="outline-primary"
            icon={Download}
            onClick={handleExportReport}
          >
            Export Report
          </Button>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <Shield className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Consistency Rate</p>
              <p className="text-2xl font-bold text-green-600">{dashboardData.overview.consistencyRate}%</p>
              <p className="text-xs text-text-secondary">
                {dashboardData.overview.consistentUsers}/{dashboardData.overview.totalUsers} users
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Inconsistent Users</p>
              <p className="text-2xl font-bold text-orange-600">{dashboardData.overview.inconsistentUsers}</p>
              <p className="text-xs text-text-secondary">Require attention</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Issues Resolved</p>
              <p className="text-2xl font-bold text-blue-600">{dashboardData.overview.totalIssuesResolved}</p>
              <p className="text-xs text-text-secondary">This period</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <Calendar className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-text-secondary">Last Scan</p>
              <p className="text-lg font-bold text-purple-600">
                {formatTimestamp(dashboardData.overview.lastScanDate)}
              </p>
              <p className="text-xs text-text-secondary">System-wide</p>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Trend Chart */}
        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Weekly Consistency Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dashboardData.weeklyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="consistent" fill="#10b981" name="Consistent" />
              <Bar dataKey="inconsistent" fill="#f59e0b" name="Inconsistent" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Issue Types Pie Chart */}
        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Issue Types Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={dashboardData.issueTypes}
                cx="50%"
                cy="50%"
                outerRadius={100}
                fill="#8884d8"
                dataKey="count"
                label={({ name, count }) => `${name}: ${count}`}
              >
                {dashboardData.issueTypes.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent Activity and User Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-text-primary">Recent Activity</h3>
            <Button
              variant="outline-primary"
              onClick={handleBulkConsistencyCheck}
              className="text-sm"
            >
              Run Bulk Check
            </Button>
          </div>
          <div className="space-y-3">
            {dashboardData.recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <div className={`w-2 h-2 rounded-full mt-2 ${
                  activity.severity === 'success' ? 'bg-green-500' :
                  activity.severity === 'warning' ? 'bg-orange-500' : 'bg-red-500'
                }`}></div>
                <div className="flex-1">
                  <p className="text-sm text-text-primary">{activity.message}</p>
                  <p className="text-xs text-text-secondary">{formatTimestamp(activity.timestamp)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Users with Issues */}
        <div className="bg-white p-6 rounded-lg border border-border-secondary">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Users Requiring Attention</h3>
          <div className="space-y-3">
            {dashboardData.userStats
              .filter(user => user.issueCount > 0)
              .sort((a, b) => b.issueCount - a.issueCount)
              .slice(0, 5)
              .map((user) => (
                <div key={user.userId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-text-primary">{user.name}</p>
                    <p className="text-xs text-text-secondary">{user.userId}</p>
                  </div>
                  <div className="text-right">
                    <Badge variant={user.consistencyRate >= 90 ? 'success' : user.consistencyRate >= 75 ? 'warning' : 'danger'}>
                      {user.consistencyRate}%
                    </Badge>
                    <p className="text-xs text-text-secondary mt-1">
                      {user.issueCount} issues
                    </p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TimesheetConsistencyDashboard;