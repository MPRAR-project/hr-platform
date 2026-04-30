/**
 * Script to fix team assignments by assigning users to managers
 * This should be run by an admin or senior manager
 */

async function fixTeamAssignments() {
  try {
    const { user } = window.authContext || { user: null };
    
    if (!user) {
      console.error('No user found. Make sure you are logged in.');
      return;
    }

    // Import Firebase functions
    const { db } = await import('./src/firebase/client.js');
    const { doc, getDoc, collection, query, where, getDocs, writeBatch, arrayUnion } = await import('https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js');

    const companyId = user.companyId?.replace('companies/', '') || user.companyId;
    const managerId = user.uid;

    console.log('=== Fix Team Assignments ===');
    console.log('Manager:', user.email, 'ID:', managerId);
    console.log('Company:', companyId);

    // Get all users in the company who don't have a manager
    const allUsersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', `companies/${companyId}`)
    );
    const allUsersSnap = await getDocs(allUsersQuery);
    
    const usersWithoutManager = [];
    allUsersSnap.forEach(doc => {
      const userData = doc.data();
      const hasManager = userData.managerUserId || userData.reportsTo;
      if (!hasManager && doc.id !== managerId && userData.primaryRole !== 'seniorManager') {
        usersWithoutManager.push({
          id: doc.id,
          displayName: userData.displayName,
          email: userData.email,
          primaryRole: userData.primaryRole
        });
      }
    });

    console.log('Found users without manager:', usersWithoutManager.length);
    console.log('Users:', usersWithoutManager);

    if (usersWithoutManager.length === 0) {
      console.log('All users already have managers assigned!');
      return;
    }

    // Ask for confirmation before proceeding
    const confirmMessage = `Do you want to assign ${usersWithoutManager.length} users to yourself as their manager?\n\n` +
      usersWithoutManager.map(u => `- ${u.displayName} (${u.email})`).join('\n');
    
    if (!confirm(confirmMessage)) {
      console.log('Operation cancelled by user.');
      return;
    }

    // Create batch to update all users
    const batch = writeBatch(db);
    const now = new Date().toISOString();

    // Update each user to have this manager
    usersWithoutManager.forEach(userWithoutManager => {
      const userRef = doc(db, 'users', userWithoutManager.id);
      
      // Update user with manager info
      batch.update(userRef, {
        managerUserId: managerId,
        reportsTo: managerId,
        teamId: managerId,
        updatedAt: now
      });

      // Create assignment record
      const assignmentRef = doc(collection(db, 'assignments'));
      batch.set(assignmentRef, {
        employeeId: userWithoutManager.id,
        managerId: managerId,
        companyId: `companies/${companyId}`,
        createdAt: now,
        updatedAt: now
      });
    });

    // Update manager's managedEmployees array
    const managerRef = doc(db, 'users', managerId);
    batch.update(managerRef, {
      managedEmployees: arrayUnion(...usersWithoutManager.map(u => u.id)),
      updatedAt: now
    });

    // Commit the batch
    await batch.commit();
    
    console.log(`Successfully assigned ${usersWithoutManager.length} users to your team!`);
    console.log('Please refresh the page to see the updated team members.');

  } catch (error) {
    console.error('Error fixing team assignments:', error);
  }
}

// Instructions
console.log(`
=== FIX TEAM ASSIGNMENTS INSTRUCTIONS ===

1. Open your browser console (F12)
2. Make sure you're logged in as a senior manager
3. Copy and paste this entire script into the console
4. Run: fixTeamAssignments()

This will:
- Find all users in your company without a manager
- Ask for confirmation before assigning them to you
- Update their managerUserId, reportsTo, and teamId fields
- Create assignment records
- Update your managedEmployees array

WARNING: This will assign ALL users without managers to you!
Make sure this is what you want before proceeding.
`);

// Export for use
window.fixTeamAssignments = fixTeamAssignments;
