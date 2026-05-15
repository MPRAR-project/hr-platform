import hrApiClient from '../lib/hrApiClient';

export async function submitSignup(form) {
    try {
        console.log('Starting signup process for:', form.email);
        
        // The backend /hr/auth/register now handles everything:
        // 1. Creating user in Central
        // 2. Creating company in HR PostgreSQL
        // 3. Creating employee in HR PostgreSQL
        // 4. Returning tokens
        const { data } = await hrApiClient.post('/hr/auth/register', {
            email: form.email,
            password: form.password,
            firstName: form.firstName,
            lastName: form.lastName,
            companyName: form.companyName,
            industry: form.industry,
            phoneNumber: form.phone,
            website: form.website,
            address: form.addressRaw,
            weekStart: form.weekStartDay || 'monday'
        });

        console.log('Signup process completed successfully via REST');
        
        return {
            companyId: data.employee.companyId,
            userId: data.employee.id,
            accessToken: data.accessToken,
            employee: data.employee
        };
    } catch (error) {
        console.error('Signup error details:', error);
        const msg = error.response?.data?.error || error.message;
        throw new Error(msg);
    }
}

export async function submitTeamSize(companyId, seatCount, addOns = {}) {
    try {
        console.log('submitTeamSize called with companyId:', companyId, 'seatCount:', seatCount, 'addOns:', addOns);
        
        // Use the billing summary update or a specific team-size endpoint
        // Let's use the startTrial endpoint if they are just starting, 
        // or a generic update endpoint.
        const { data } = await hrApiClient.post('/hr/billing/trial', {
            seatCount
        });

        // Also update plugins
        if (Object.keys(addOns).length > 0) {
            await Promise.all(Object.entries(addOns).map(([type, enabled]) => 
                hrApiClient.put('/hr/billing/plugins', { type, enabled })
            ));
        }

        console.log('submitTeamSize completed successfully via REST');
        return { ok: true };
    } catch (error) {
        console.error('Error in submitTeamSize:', error);
        throw error;
    }
}


