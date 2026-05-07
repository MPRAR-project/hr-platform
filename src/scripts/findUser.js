import { db } from './hr/src/firebase/client';
import { collection, query, where, getDocs } from 'firebase/firestore';

async function findUser() {
  const email = 'xiyisi8619@cadinr.com';
  const q = query(collection(db, 'users'), where('email', '==', email));
  const snap = await getDocs(q);
  if (snap.empty) {
    console.log('User not found');
    return;
  }
  snap.forEach(doc => {
    console.log('User ID:', doc.id);
    console.log('User Data:', doc.data());
  });
}

findUser();
