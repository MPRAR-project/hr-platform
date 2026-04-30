import React, { useState } from 'react';
import Tabs from '../../../components/ui/Tabs';
import UserGroup from '../../../components/shared/UserGroup';
import SubscriptionHistory from './SubscriptionHistory';
import { useAuth } from '../../../hooks/useAuth';

const emptyGroups = [];

const UserManagementPanel = ({ groups, subscriptionHistory, onArchive, onUnarchive, onInviteDelete }) => {
  const [activeView, setActiveView] = useState('Users');
  const tabOptions = [{ label: 'Users' }, { label: 'Subscription History' }];
  const { user } = useAuth();
  const userGroups = groups || emptyGroups;

  return (
    <div className="bg-white sm:px-4xl py-4xl px-2 rounded-base shadow-lg flex flex-col gap-xl">
      <Tabs
        tabs={tabOptions}
        onTabChange={(selectedTab) => setActiveView(selectedTab)}
      />

      <div>
        {activeView === 'Users' && (
          <div className="space-y-md">
            {userGroups.length > 0 ? (
              userGroups.map((group, index) => (
                <UserGroup
                  key={index}
                  group={group}
                  userRole={user?.role}
                  onArchive={onArchive}
                  onUnarchive={onUnarchive}
                  onInviteDelete={onInviteDelete}
                />
              ))
            ) : (
              <p className="text-sm text-text-secondary">
                No users available for this company yet.
              </p>
            )}
          </div>
        )}
        {activeView === 'Subscription History' && (
          <SubscriptionHistory history={subscriptionHistory} />
        )}
      </div>
    </div>
  );
};

export default UserManagementPanel;
