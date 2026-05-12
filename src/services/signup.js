const CENTRAL_API_URL = import.meta.env.VITE_CENTRAL_API_URL || 'http://localhost:5000';

export async function submitSignup(form) {
    try {
        console.log('Starting signup process for:', form.email);

        const payload = {
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            password: form.password,
            companyName: form.companyName,
            industry: form.industry || '',
            phoneNumber: form.phone || null,
            website: form.website || null,
            address: form.addressRaw || null,
            weekStart: form.weekStartDay || 'monday',
            selectedPlatforms: ['hr'],
            teamSize: form.teamSize || 5,
            shiftRosterAddon: false,
        };

        const response = await fetch(`${CENTRAL_API_URL}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Registration failed. Please try again.');
        }

        return await response.json();
    } catch (error) {
        console.error('Signup error details:', error);
        throw error;
    }
}

export async function submitTeamSize(companyId, seatCount, addOns = {}) {
    const centralToken = localStorage.getItem('mprar_central_token');
    if (!centralToken) {
        throw new Error('Missing central authentication token. Please sign in through the HR portal bridge.');
    }

    const response = await fetch(`${CENTRAL_API_URL}/companies/${companyId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${centralToken}`,
        },
        body: JSON.stringify({
            seatCount,
            billingSeatQuota: seatCount,
            plugins: addOns,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update team size.');
    }

    return { ok: true };
}


