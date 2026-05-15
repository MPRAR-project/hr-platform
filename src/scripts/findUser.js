import hrApiClient from '../lib/hrApiClient';

async function findUser() {
  const email = 'xiyisi8619@cadinr.com';
  try {
    const { data } = await hrApiClient.get('/hr/users', { params: { email } });
    const users = data.users || data || [];
    if (users.length === 0) {
      console.log('User not found');
      return;
    }
    users.forEach(user => {
      console.log('User ID:', user.id || user.uid);
      console.log('User Data:', user);
    });
  } catch (err) {
    console.error('Error finding user:', err.message);
  }
}

findUser();
