import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Loader2, Users, Calendar, Clock, Download } from 'lucide-react';
import apiClient from '../api/apiClient';

const DummyTimesheetGenerator = () => {
  const [config, setConfig] = useState({
    companyId: 'Me85lgnGautdAF3oKFQC',
    siteId: 'n8q26y1QuD9rflq7Q3yH',
    users: [
      { id: 'KTG1Na79NVWCu559d02u9tiI5aw1', name: 'User 1' }
    ]
  });

  const [newUser, setNewUser] = useState({ id: '', name: '' });
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const addUser = () => {
    if (newUser.id && newUser.name) {
      setConfig({
        ...config,
        users: [...config.users, { ...newUser }]
      });
      setNewUser({ id: '', name: '' });
    }
  };

  const removeUser = (index) => {
    setConfig({
      ...config,
      users: config.users.filter((_, i) => i !== index)
    });
  };

  const generateDayEntry = (date) => {
    const clockInMinute = Math.floor(Math.random() * 16) + 15; // 15-30
    const clockInSecond = Math.floor(Math.random() * 60);
    const clockOutMinute = Math.floor(Math.random() * 16) + 15; // 15-30
    const clockOutSecond = Math.floor(Math.random() * 60);
    
    const dateStr = date.toISOString().split('T')[0];
    const rawStart = `${dateStr}T07:${String(clockInMinute).padStart(2, '0')}:${String(clockInSecond).padStart(2, '0')}.000Z`;
    const rawEnd = `${dateStr}T18:${String(clockOutMinute).padStart(2, '0')}:${String(clockOutSecond).padStart(2, '0')}.000Z`;
    
    const roundedStartMin = Math.round(clockInMinute / 5) * 5;
    const roundedEndMin = Math.round(clockOutMinute / 5) * 5;
    const roundedStart = `${dateStr}T07:${String(roundedStartMin).padStart(2, '0')}:00.000Z`;
    const roundedEnd = `${dateStr}T18:${String(roundedEndMin).padStart(2, '0')}:00.000Z`;
    
    const rawDurationSec = (18 * 3600 + clockOutMinute * 60 + clockOutSecond) - 
                           (7 * 3600 + clockInMinute * 60 + clockInSecond);
    const grossSec = (18 * 3600 + roundedEndMin * 60) - 
                     (7 * 3600 + roundedStartMin * 60);
    const lunchBreakSec = 3600; // 60 minutes
    const effectiveSec = grossSec - lunchBreakSec;
    
    return {
      id: `entry_${dateStr}_${Math.random().toString(36).substr(2, 9)}`,
      date: dateStr,
      effectiveSec,
      grossSec,
      rawStart,
      rawEnd,
      roundedStart,
      roundedEnd,
      notes: "Auto-generated dummy entry"
    };
  };

  const generateTimesheets = async () => {
    setGenerating(true);
    setResults([]);
    setSummary(null);
    setError(null);

    try {
      const today = new Date();
      const cleanCompanyId = config.companyId.replace('companies/', '');
      
      const payloadList = [];
      
      config.users.forEach(user => {
        // Group entries by week to match our new Timesheet model (week-based)
        const weeklyGroups = {};

        for (let day = 13; day >= 0; day--) {
          const date = new Date(today);
          date.setDate(today.getDate() - day);
          
          const dayOfWeek = date.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) continue;
          
          const entry = generateDayEntry(date);
          // Find the Monday of this week
          const monday = new Date(date);
          monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
          const weekStart = monday.toISOString().split('T')[0];

          if (!weeklyGroups[weekStart]) {
            weeklyGroups[weekStart] = {
              userId: user.id,
              companyId: cleanCompanyId,
              siteId: config.siteId,
              weekStartDate: weekStart,
              entries: [],
              status: 'pending'
            };
          }
          weeklyGroups[weekStart].entries.push(entry);
        }

        Object.values(weeklyGroups).forEach(group => {
            payloadList.push({
                data: group,
                userName: user.name,
                period: group.weekStartDate
            });
        });
      });

      let successCount = 0;
      let errorCount = 0;
      const resultsList = [];

      for (const item of payloadList) {
        try {
          const response = await apiClient.post(`/hr/${cleanCompanyId}/timesheets`, item.data);
          
          resultsList.push({
            status: 'success',
            userName: item.userName,
            period: item.period,
            docId: response.data.id
          });
          successCount++;
          setResults([...resultsList]);
          
        } catch (err) {
          resultsList.push({
            status: 'error',
            userName: item.userName,
            period: item.period,
            error: err.response?.data?.error || err.message
          });
          errorCount++;
          setResults([...resultsList]);
        }
      }

      setSummary({ 
        total: payloadList.length, 
        success: successCount, 
        error: errorCount 
      });

    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const downloadJSON = () => {
    // Keep legacy JSON export if needed, but updated for new structure
    const dataStr = JSON.stringify(results, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dummy-results-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Daily Timesheet Generator (V2)</h1>
              <p className="text-gray-600 text-sm sm:text-base">Genuinely migrated to Central Backend. Generates weekly timesheets with daily entries.</p>
            </div>
            <button
              onClick={downloadJSON}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              title="Download results"
            >
              <Download size={20} />
              <span className="hidden sm:inline">JSON</span>
            </button>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 font-medium">Error: {error}</p>
            </div>
          )}

          <div className="space-y-6">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h2 className="text-lg font-semibold text-gray-800 mb-3">Configuration</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company ID</label>
                  <input
                    type="text"
                    value={config.companyId}
                    onChange={(e) => setConfig({...config, companyId: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={generating}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Site ID (Optional)</label>
                  <input
                    type="text"
                    value={config.siteId}
                    onChange={(e) => setConfig({...config, siteId: e.target.value})}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={generating}
                  />
                </div>
              </div>
            </div>

            <div className="bg-green-50 p-4 rounded-lg">
              <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Users size={20} />
                Users (Central User IDs)
              </h2>
              
              <div className="space-y-2 mb-4">
                {config.users.map((user, index) => (
                  <div key={index} className="flex items-center justify-between bg-white p-3 rounded-lg">
                    <div className="flex-1 min-w-0 mr-2">
                      <p className="font-medium text-gray-800 truncate">{user.name}</p>
                      <p className="text-sm text-gray-500 truncate">{user.id}</p>
                    </div>
                    <button
                      onClick={() => removeUser(index)}
                      className="text-red-500 hover:text-red-700 font-medium whitespace-nowrap"
                      disabled={generating}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="User Name"
                  value={newUser.name}
                  onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  disabled={generating}
                />
                <input
                  type="text"
                  placeholder="User UUID"
                  value={newUser.id}
                  onChange={(e) => setNewUser({...newUser, id: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  disabled={generating}
                />
                <button
                  onClick={addUser}
                  disabled={!newUser.name || !newUser.id || generating}
                  className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  Add User
                </button>
              </div>
            </div>

            <button
              onClick={generateTimesheets}
              disabled={generating || config.users.length === 0}
              className="w-full bg-indigo-600 text-white py-4 rounded-lg hover:bg-indigo-700 transition-colors font-semibold text-lg disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="animate-spin" size={24} />
                  Generating... ({results.length}/{summary?.total || '?'})
                </>
              ) : (
                <>
                  <Clock size={24} />
                  Generate Central Timesheets
                </>
              )}
            </button>
          </div>

          {(results.length > 0 || summary) && (
            <div className="mt-8 space-y-4">
              {summary && (
                <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg border-2 border-green-200">
                  <h3 className="text-xl font-bold text-gray-800 mb-3">Generation Complete! 🎉</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-gray-800">{summary.total}</p>
                      <p className="text-sm text-gray-600">Total Weeks</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-green-600">{summary.success}</p>
                      <p className="text-sm text-gray-600">Success</p>
                    </div>
                    <div className="text-center">
                      <p className="text-3xl font-bold text-red-600">{summary.error}</p>
                      <p className="text-sm text-gray-600">Errors</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={`p-3 rounded-lg flex items-start gap-3 ${
                      result.status === 'success' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                    }`}
                  >
                    {result.status === 'success' ? (
                      <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800">
                        {result.userName} - Week of {result.period}
                      </p>
                      {result.status === 'success' ? (
                        <p className="text-sm text-gray-600 truncate">Timesheet ID: {result.docId}</p>
                      ) : (
                        <p className="text-sm text-red-600">{result.error}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DummyTimesheetGenerator;