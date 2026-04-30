/**
 * Debug script to check team assignments for a manager
 * Run this in the browser console or as a Node script with proper Firebase setup
 */

// Add this to your browser console when logged in as a senior manager
async function debugTeamAssignments() {
  try {
    // Get current user info from AuthContext
    const { user } = window.authContext || { user: null };
    
    if (!user) {
      console.error('No user found. Make sure you are logged in.');
      return;
    }

    console.log('=== Team Assignment Debug ===');
    console.log('Current User:', {
      uid: user.uid,
      email: user.email,
      role: user.role,
      companyId: user.companyId
    });

    // Import Firebase functions (these should be available in the app)
    const { db } = await import('./src/firebase/client.js');
    const { doc, getDoc, collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/9.0.0/firebase-firestore.js');

    const companyId = user.companyId?.replace('companies/', '') || user.companyId;
    const managerId = user.uid;

    if (!companyId || !managerId) {
      console.error('Missing companyId or managerId');
      return;
    }

    console.log('\n=== Checking Method 1: Manager Document ===');
    const managerRef = doc(db, 'users', managerId);
    const managerSnap = await getDoc(managerRef);
    
    if (managerSnap.exists()) {
      const managerData = managerSnap.data();
      console.log('Manager Data:', {
        managedEmployees: managerData.managedEmployees || [],
        role: managerData.primaryRole
      });
    } else {
      console.log('Manager document not found');
    }

    console.log('\n=== Checking Method 2: Assignments Collection ===');
    const assignmentsQuery = query(
      collection(db, 'assignments'),
      where('managerId', '==', managerId),
      where('companyId', '==', `companies/${companyId}`)
    );
    const assignmentsSnap = await getDocs(assignmentsQuery);
    console.log('Assignments found:', assignmentsSnap.size);
    assignmentsSnap.forEach(doc => {
      console.log('Assignment:', doc.data());
    });

    console.log('\n=== Checking Method 3: Users with Direct Manager ===');
    const usersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', `companies/${companyId}`),
      where('managerUserId', '==', managerId)
    );
    const usersSnap = await getDocs(usersQuery);
    console.log('Users with direct manager:', usersSnap.size);
    usersSnap.forEach(doc => {
      const userData = doc.data();
      console.log('User:', {
        id: doc.id,
        displayName: userData.displayName,
        email: userData.email,
        primaryRole: userData.primaryRole,
        reportsTo: userData.reportsTo,
        managerUserId: userData.managerUserId
      });
    });

    console.log('\n=== Checking All Users in Company ===');
    const allUsersQuery = query(
      collection(db, 'users'),
      where('companyId', '==', `companies/${companyId}`)
    );
    const allUsersSnap = await getDocs(allUsersQuery);
    console.log('Total users in company:', allUsersSnap.size);
    
    const usersWithoutManager = [];
    allUsersSnap.forEach(doc => {
      const userData = doc.data();
      const hasManager = userData.managerUserId || userData.reportsTo;
      if (!hasManager && doc.id !== managerId) {
        usersWithoutManager.push({
          id: doc.id,
          displayName: userData.displayName,
          email: userData.email,
          primaryRole: userData.primaryRole
        });
      }
    });
    
    console.log('Users without manager assignment:', usersWithoutManager.length);
    console.log('Users without manager:', usersWithoutManager);

  } catch (error) {
    console.error('Debug script error:', error);
  }
}

// Instructions for use
console.log(`
=== TEAM ASSIGNMENT DEBUG INSTRUCTIONS ===

1. Open your browser console (F12)
2. Make sure you're logged in as a senior manager
3. Copy and paste this entire script into the console
4. Run: debugTeamAssignments()

This will check:
- Your manager document for managedEmployees array
- Assignments collection for direct assignments
- Users with managerUserId pointing to you
- All users in your company who might need manager assignment

Expected results:
- If team members are properly assigned, you should see them in the results
- If not, you'll see "Users without manager assignment" which need to be fixed
`);

// Export for use
window.debugTeamAssignments = debugTeamAssignments;
