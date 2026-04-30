// Simple script to remove autoClockOut and autoClockOutAt fields
// Run this in your project environment

const { getFirestore, collection, query, where, getDocs, writeBatch, deleteField, serverTimestamp } = require('firebase/firestore');
const { getApp } = require('firebase/app');

async function removeAutoClockOutFields() {
  try {
    console.log('Starting cleanup of autoClockOut and autoClockOutAt fields...');
    
    const db = getFirestore(getApp());
    const sessionsRef = collection(db, 'timeClockSessions');
    
    // Get all sessions that have autoClockOut field
    const q = query(sessionsRef, where('autoClockOut', '==', true));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      console.log('No sessions found with autoClockOut field');
      return;
    }
    
    console.log(`Found ${querySnapshot.size} sessions to update`);
    
    const batchSize = 500;
    let processedCount = 0;
    
    for (let i = 0; i < querySnapshot.docs.length; i += batchSize) {
      const batch = writeBatch(db);
      const endIndex = Math.min(i + batchSize, querySnapshot.docs.length);
      
      for (let j = i; j < endIndex; j++) {
        const doc = querySnapshot.docs[j];
        const sessionRef = doc.ref;
        const sessionData = doc.data();
        
        console.log(`Processing session: ${doc.id}`);
        console.log(`Current autoClockOut: ${sessionData.autoClockOut}`);
        console.log(`Current autoClockOutAt: ${sessionData.autoClockOutAt}`);
        
        // Remove both fields
        batch.update(sessionRef, {
          autoClockOut: deleteField(),
          autoClockOutAt: deleteField(),
          updatedAt: serverTimestamp()
        });
        
        processedCount++;
      }
      
      console.log(`Committing batch ${Math.floor(i / batchSize) + 1} (${endIndex - i} operations)`);
      await batch.commit();
      console.log('Batch committed successfully');
    }
    
    console.log(`Successfully removed autoClockOut fields from ${processedCount} sessions`);
    
  } catch (error) {
    console.error('Error removing autoClockOut fields:', error);
  }
}

// Run the function immediately
removeAutoClockOutFields().then(() => {
  console.log('Cleanup completed');
  process.exit(0);
}).catch((error) => {
  console.error('Cleanup failed:', error);
  process.exit(1);
});
