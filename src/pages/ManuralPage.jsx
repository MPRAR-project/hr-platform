import React, { useState } from 'react';
import { getFirestore, collection, addDoc, Timestamp } from 'firebase/firestore';
import { AlertCircle, CheckCircle, Loader2, Users, Calendar, Clock, Download } from 'lucide-react';

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
      autoLunchApplied: true,
      autoLunchBreakSec: lunchBreakSec,
      autoLunchThresholdHours: 6,
      date: dateStr,
      effectiveSec: effectiveSec,
      grossSec: grossSec,
      lunchBreakMinutes: 60,
      manualBreakSec: 0,
      notes: null,
      overtimeSec: 0,
      rawDurationSec: rawDurationSec,
      rawEffectiveSec: rawDurationSec,
      rawEnd: rawEnd,
      rawStart: rawStart,
      roundedEnd: roundedEnd,
      roundedStart: roundedStart,
      sessionIds: [`session_${dateStr}_${Math.random().toString(36).substr(2, 9)}`],
      source: "clock"
    };
  };

  const generateTimesheets = async () => {
    setGenerating(true);
    setResults([]);
    setSummary(null);
    setError(null);

    try {
      // Get Firestore instance
      const db = getFirestore();
      
      const documents = [];
      const today = new Date();
      
      // Generate daily timesheets for last 14 days (Mon-Fri only)
      config.users.forEach(user => {
        for (let day = 13; day >= 0; day--) {
          const date = new Date(today);
          date.setDate(today.getDate() - day);
          
          // Skip weekends
          const dayOfWeek = date.getDay();
          if (dayOfWeek === 0 || dayOfWeek === 6) continue;
          
          const entry = generateDayEntry(date);
          const periodDate = date.toISOString().split('T')[0];
          
          const document = {
            approvals: {
              hrManager: null,
              siteManager: null,
              teamManager: null
            },
            companyId: config.companyId,
            createdAt: Timestamp.now(),
            entries: [entry],
            managerUserId: "",
            period: periodDate,
            siteId: config.siteId,
            status: "pending",
            teamId: null,
            totals: {
              effectiveSec: entry.effectiveSec,
              grossSec: entry.grossSec,
              overtimeSec: 0
            },
            updatedAt: Timestamp.now(),
            userId: user.id
          };
          
          documents.push({
            data: document,
            userName: user.name,
            period: periodDate
          });
        }
      });

      // Add to Firestore one by one
      let successCount = 0;
      let errorCount = 0;
      const resultsList = [];

      for (const doc of documents) {
        try {
          // Add document to Firestore
          const docRef = await addDoc(collection(db, 'timesheets'), doc.data);
          
          resultsList.push({
            status: 'success',
            userName: doc.userName,
            period: doc.period,
            docId: docRef.id
          });
          successCount++;
          
          // Update UI progressively
          setResults([...resultsList]);
          
        } catch (err) {
          // Error adding document:
          resultsList.push({
            status: 'error',
            userName: doc.userName,
            period: doc.period,
            error: err.message
          });
          errorCount++;
        }
      }

      setResults(resultsList);
      setSummary({ 
        total: documents.length, 
        success: successCount, 
        error: errorCount 
      });

    } catch (err) {
      // Fatal error:
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const downloadJSON = () => {
    const documents = [];
    const today = new Date();
    
    config.users.forEach(user => {
      for (let day = 13; day >= 0; day--) {
        const date = new Date(today);
        date.setDate(today.getDate() - day);
        
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;
        
        const entry = generateDayEntry(date);
        const periodDate = date.toISOString().split('T')[0];
        
        documents.push({
          approvals: {
            hrManager: null,
            siteManager: null,
            teamManager: null
          },
          companyId: config.companyId,
          createdAt: new Date().toISOString(),
          entries: [entry],
          managerUserId: "",
          period: periodDate,
          siteId: config.siteId,
          status: "pending",
          teamId: null,
          totals: {
            effectiveSec: entry.effectiveSec,
            grossSec: entry.grossSec,
            overtimeSec: 0
          },
          updatedAt: new Date().toISOString(),
          userId: user.id
        });
      }
    });

    const dataStr = JSON.stringify(documents, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dummy-timesheets-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">Daily Timesheet Generator</h1>
              <p className="text-gray-600 text-sm sm:text-base">Generate daily dummy timesheets for the last 2 weeks (10 working days)</p>
            </div>
            <button
              onClick={downloadJSON}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              title="Download as JSON"
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
            {/* Configuration Section */}
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Site ID</label>
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

            {/* Users Section */}
            <div className="bg-green-50 p-4 rounded-lg">
              <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <Users size={20} />
                Users
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
                  placeholder="User ID"
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

            {/* Summary Info */}
            <div className="bg-indigo-50 p-4 rounded-lg">
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-indigo-600" />
                  <span className="font-medium">{config.users.length} Users</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={16} className="text-indigo-600" />
                  <span className="font-medium">10 Working Days</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={16} className="text-indigo-600" />
                  <span className="font-medium">{config.users.length * 10} Documents</span>
                </div>
              </div>
            </div>

            {/* Generate Button */}
            <button
              onClick={generateTimesheets}
              disabled={generating || config.users.length === 0}
              className="w-full bg-indigo-600 text-white py-4 rounded-lg hover:bg-indigo-700 transition-colors font-semibold text-lg disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {generating ? (
                <>
                  <Loader2 className="animate-spin" size={24} />
                  Generating... ({results.length}/{config.users.length * 10})
                </>
              ) : (
                <>
                  <Clock size={24} />
                  Generate Dummy Timesheets
                </>
              )}
            </button>
          </div>

          {/* Results Section */}
          {(results.length > 0 || summary) && (
            <div className="mt-8 space-y-4">
              {summary && (
                <div className="bg-gradient-to-r from-green-50 to-blue-50 p-6 rounded-lg border-2 border-green-200">
                  <h3 className="text-xl font-bold text-gray-800 mb-3">Generation Complete! 🎉</h3>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-gray-800">{summary.total}</p>
                      <p className="text-sm text-gray-600">Total</p>
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
                        {result.userName} - {result.period}
                      </p>
                      {result.status === 'success' ? (
                        <p className="text-sm text-gray-600 truncate">Document ID: {result.docId}</p>
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