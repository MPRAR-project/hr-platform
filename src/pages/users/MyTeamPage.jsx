import { useState, useEffect } from "react";
import Header from "../../components/layout/Header";
import UserListItem from "../../components/shared/UserListItem";
import { useAuth } from "../../hooks/useAuth";
import { getTeamMembers } from "../../services/teams";
import { getUserDisplayName } from "../../utils/dataParser";
import Loader from "../../components/ui/Loader";
import OnboardingManagementPage from "../onboarding/OnboardingManagementPage";

// Simple cache to store team members data
const teamMembersCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const MyTeamPage = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('my_team');
  const [teamMembers, setTeamMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  // Role to job title mapping
  const roleToJobTitle = (role) => {
    const roleLower = role?.toLowerCase() || '';
    const mapping = {
      'teammanager': 'Team Manager',
      'adminmanager': 'Admin Manager',
      'hrmanager': 'HR Manager',
      'adminadvisor': 'Admin Advisor',
      'hradvisor': 'HR Advisor',
      'contractmanager': 'Contract Manager',
      'employee': 'Employee',
      'sitemanager': 'Site Manager',
      'seniormanager': 'Senior Manager'
    };
    return mapping[roleLower] || 'Employee';
  };

  // Role to category mapping
  const roleToCategory = (role) => {
    const roleLower = role?.toLowerCase() || '';
    const managerRoles = ['teammanager', 'adminmanager', 'hrmanager', 'sitemanager', 'seniormanager'];
    return managerRoles.includes(roleLower) ? 'Manager' : 'Employee';
  };

  useEffect(() => {
    const loadTeamMembers = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (!user || !user.uid) {
          setError('User not authenticated');
          setIsLoading(false);
          return;
        }

        // Extract companyId from user object
        let companyId = user.companyId || '';
        if (companyId && companyId.includes('/')) {
          // Extract company ID from path like "companies/companyId"
          companyId = companyId.split('/')[1] || companyId;
        }

        if (!companyId) {
          setError('Company ID not found');
          setIsLoading(false);
          return;
        }

        console.log('[MyTeamPage] Loading team members for manager:', user.uid, 'company:', companyId);

        // Check cache first
        const cacheKey = `${user.uid}_${companyId}`;
        const cachedData = teamMembersCache.get(cacheKey);
        
        if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_DURATION) {
          console.log('[MyTeamPage] Using cached team members:', cachedData.data.length);
          setTeamMembers(cachedData.data);
          setIsLoading(false);
          return;
        }

        let members = [];

        // Senior Managers should see all users in the company
        if (user?.role === 'seniorManager') {
          console.log('[MyTeamPage] Senior Manager detected - fetching all company users');
          const { subscribeToCompanyUsers } = await import('../../services/users');
          
          // Get all users in the company
          const allUsers = await new Promise((resolve, reject) => {
            const unsubscribe = subscribeToCompanyUsers(
              companyId,
              (users) => resolve(users),
              (error) => reject(error)
            );
            // Unsubscribe immediately after getting data
            setTimeout(() => unsubscribe(), 1000);
          });
          
          members = allUsers || [];
          console.log('[MyTeamPage] Fetched all company users:', members.length);
        } else {
          // Other managers only see their direct reports
          console.log('[MyTeamPage] Regular manager detected - fetching direct reports only');
          members = await getTeamMembers(user.uid, companyId);
          console.log('[MyTeamPage] Fetched team members:', members.length);
        }

        // Transform team members to match UserListItem format
        const transformedMembers = members
          .filter(member => {
            // Skip site managers from the list
            const primaryRole = (member.primaryRole || '').toLowerCase();
            if (primaryRole === 'sitemanager') return false;
            
            // For Senior Managers, don't show themselves in the list
            if (user?.role === 'seniorManager' && member.id === user.uid) return false;
            
            return true;
          })
          .map(member => {
            const name = getUserDisplayName(member);
            const jobTitle = roleToJobTitle(member.primaryRole);
            const roleCategory = roleToCategory(member.primaryRole);

            // Determine status
            let status = 'Inactive';
            if (member.status === 'active') {
              status = 'Active';
            } else if (member.status === 'pending' || member.status === 'invited' || member.isInvited === true) {
              status = 'Pending';
            }

            return {
              id: member.id,
              name,
              email: member.email || 'No email',
              jobTitle,
              roleCategory,
              status,
              lastActive: member.lastActive || null
            };
          });

        // Update cache
        teamMembersCache.set(cacheKey, {
          data: transformedMembers,
          timestamp: Date.now()
        });

        setTeamMembers(transformedMembers);
      } catch (err) {
        console.error('[MyTeamPage] Error loading team members:', err);
        setError(err.message || 'Failed to load team members');
      } finally {
        setIsLoading(false);
      }
    };

    loadTeamMembers();
  }, [user]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50">
      <Header
        title={`${pretty(user.role)} Dashboard`}
        subtitle="Ensure compliance and manage onboarding from one place."
      />

      <div className="flex-1 overflow-y-auto p-6 scrollbar-custom">
        {/* Tab Navigation */}
        <div className="max-w-7xl mx-auto mb-6 border-b border-gray-200">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setActiveTab('my_team')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'my_team'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              My Team
            </button>
            <button
              onClick={() => setActiveTab('onboarding')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'onboarding'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Onboarding
            </button>
          </div>
        </div>

        {activeTab === 'my_team' && (
          <div className="max-w-7xl bg-white p-4 rounded-base shadow-lg mx-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">My Team</h2>

            {isLoading ? (
              <div className="flex items-center justify-center h-64">
                <Loader variant="pulse" size="md" text="Fetching employee data..." />
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800 font-medium">Error</p>
                <p className="text-red-600 text-sm mt-1">{error}</p>
              </div>
            ) : teamMembers.length === 0 ? (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
                <p className="text-gray-600 font-medium">No team members found</p>
                <p className="text-gray-500 text-sm mt-2">
                  Employees assigned to you will appear here once they are added to your team.
                </p>
              </div>
            ) : (
              <div className="space-y-4 bg-white p-4 md:p-6">
                {teamMembers.map((member) => (
                  <UserListItem
                    key={member.id}
                    user={member}
                    variant="separated"
                    userRole={user?.role}
                  />
                ))}
              </div>
            )}

          </div>
        )}

        {activeTab === 'onboarding' && (
          <OnboardingManagementPage isEmbedded={true} />
        )}
      </div>
    </div>
  );
};

export default MyTeamPage;