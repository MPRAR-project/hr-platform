import { db } from '../firebase/client';
import { collection, doc, setDoc, updateDoc, serverTimestamp, query, where, getDocs, writeBatch } from 'firebase/firestore';
import { createUserWithEmail } from './auth';

const BILLING_DEFAULTS = {
    billingSeatQuota: 0,
    billingActiveSeatCount: 0,
    billingSubscriptionStatus: 'pending_trial',
    billingTrialEndsAt: null,
    billingRenewalDate: null,
    billingLastPaymentAt: null,
    billingLastPaymentType: null,
    billingHistory: [],
};

export async function submitSignup(form) {
    try {
        console.log('Starting signup process for:', form.email);
        const now = serverTimestamp();
        const website = form.website && !/^https?:\/\//i.test(form.website)
            ? `https://${form.website}`
            : (form.website || null);

        // 1) Create Firebase Auth user first
        console.log('Creating Firebase Auth user...');
        const firebaseUser = await createUserWithEmail(form.email, form.password);
        console.log('Firebase Auth user created:', firebaseUser.uid);

        // 2) Use batch write for better performance and atomicity
        console.log('Preparing batch write...');
        const batch = writeBatch(db);

        // Create company document
        const companyRef = doc(collection(db, 'companies'));
        batch.set(companyRef, {
            name: form.companyName,
            industry: form.industry ?? null,
            phone: form.phone ?? null,
            website,
            address: { line1: form.addressRaw ?? null, raw: form.addressRaw ?? null },
            weekStartDay: form.weekStartDay || 'monday',
            status: 'active',
            subscriptionTier: 'trial',
            seatCount: 0,
            currentEmployeeCount: 0,
            ownerUserId: firebaseUser.uid,
            isOnboardingMandatory: true,
            createdAt: now,
            updatedAt: now,
            ...BILLING_DEFAULTS,
        });
        console.log('Company document prepared for batch write');

        // Create site document
        const siteRef = doc(collection(db, 'sites'));
        batch.set(siteRef, {
            companyId: companyRef.path,
            name: 'Headquarters',
            address: { line1: form.addressRaw ?? null, raw: form.addressRaw ?? null },
            managerUserId: firebaseUser.uid,
            status: 'active',
            createdAt: now,
            updatedAt: now,
        });
        console.log('Site document prepared for batch write');

        // Create user document
        const userRef = doc(db, 'users', firebaseUser.uid);
        batch.set(userRef, {
            userId: firebaseUser.uid,     // ← Use userId consistently
            email: form.email,
            firstName: form.firstName,
            lastName: form.lastName,
            displayName: `${form.firstName} ${form.lastName}`,
            primaryRole: 'siteManager',
            roles: ['siteManager'],
            companyId: companyRef.path,
            siteId: siteRef.path,
            teamId: null,
            status: 'active',
            weekStartDay: form.weekStartDay || 'monday', // Set week start day from form or default
            createdAt: now,
            updatedAt: now,
            shift: 'day', // Default shift
            shiftUpdatedAt: now,
        });
        console.log('User document prepared for batch write');

        // Create subscription document
        const subRef = doc(collection(db, 'subscriptions'));
        batch.set(subRef, {
            companyId: companyRef.path,
            plan: 'trial',
            status: 'active',
            periodStart: now,
            periodEnd: null,
            latestInvoiceId: null,
            createdAt: now,
            updatedAt: now,
        });
        console.log('Subscription document prepared for batch write');

        // Create registration audit record
        const regRef = doc(collection(db, 'registrations'));
        batch.set(regRef, {
            email: form.email,
            firstName: form.firstName,
            lastName: form.lastName,
            roleRequested: 'siteManager',
            companyName: form.companyName,
            industry: form.industry ?? null,
            phone: form.phone ?? null,
            website,
            address: { line1: form.addressRaw ?? null, raw: form.addressRaw ?? null },
            status: 'submitted',
            createdAt: now,
            updatedAt: now,
        });
        console.log('Registration audit record prepared for batch write');

        // Execute batch write with timeout
        console.log('Executing batch write...');
        const batchPromise = batch.commit();
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Batch write timeout after 15 seconds')), 15000)
        );

        try {
            await Promise.race([batchPromise, timeoutPromise]);
            console.log('Batch write completed successfully');
        } catch (batchError) {
            console.error('Batch write failed, trying individual writes as fallback:', batchError);

            // Fallback: try individual writes
            console.log('Attempting individual document creation...');
            await setDoc(companyRef, {
                name: form.companyName,
                industry: form.industry ?? null,
                phone: form.phone ?? null,
                website,
                address: { line1: form.addressRaw ?? null, raw: form.addressRaw ?? null },
                weekStartDay: form.weekStartDay || 'monday',
                status: 'active',
                subscriptionTier: 'trial',
                seatCount: 0,
                currentEmployeeCount: 0,
                ownerUserId: firebaseUser.uid,
                isOnboardingMandatory: true,
                createdAt: now,
                updatedAt: now,
                ...BILLING_DEFAULTS,
            });
            console.log('Company document created individually');

            await setDoc(siteRef, {
                companyId: companyRef.path,
                name: 'Headquarters',
                address: { line1: form.addressRaw ?? null, raw: form.addressRaw ?? null },
                managerUserId: firebaseUser.uid,
                status: 'active',
                isOnboardingMandatory: true,
                createdAt: now,
                updatedAt: now,
            });
            console.log('Site document created individually');

            await setDoc(userRef, {
                userId: firebaseUser.uid,     // ← Use userId consistently
                email: form.email,
                firstName: form.firstName,
                lastName: form.lastName,
                displayName: `${form.firstName} ${form.lastName}`,
                primaryRole: 'siteManager',
                roles: ['siteManager'],
                companyId: companyRef.path,
                siteId: siteRef.path,
                teamId: null,
                status: 'active',
                weekStartDay: form.weekStartDay || 'monday', // Set week start day from form or default
                createdAt: now,
                updatedAt: now,
                shift: 'day', // Default shift
                shiftUpdatedAt: now,
            });
            console.log('User document created individually');

            await setDoc(subRef, {
                companyId: companyRef.path,
                plan: 'trial',
                status: 'active',
                periodStart: now,
                periodEnd: null,
                latestInvoiceId: null,
                createdAt: now,
                updatedAt: now,
            });
            console.log('Subscription document created individually');

            await setDoc(regRef, {
                email: form.email,
                firstName: form.firstName,
                lastName: form.lastName,
                roleRequested: 'siteManager',
                companyName: form.companyName,
                industry: form.industry ?? null,
                phone: form.phone ?? null,
                website,
                address: { line1: form.addressRaw ?? null, raw: form.addressRaw ?? null },
                status: 'submitted',
                createdAt: now,
                updatedAt: now,
            });
            console.log('Registration document created individually');
        }

        console.log('Signup process completed successfully');
        return {
            companyId: companyRef.id,
            siteId: siteRef.id,
            userId: userRef.id,     // ← Use userId consistently
            subscriptionId: subRef.id,
            firebaseUid: firebaseUser.uid
        };
    } catch (error) {
        console.error('Signup error details:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);

        // Provide more specific error messages
        if (error.message.includes('timeout')) {
            throw new Error('Signup is taking longer than expected. Please try again.');
        } else if (error.code === 'auth/email-already-in-use') {
            throw new Error('An account with this email already exists. Please use a different email or try logging in.');
        } else if (error.code === 'auth/weak-password') {
            throw new Error('Password should be at least 6 characters long.');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email address format.');
        } else if (error.code === 'permission-denied') {
            throw new Error('Permission denied. Please check your account permissions.');
        } else if (error.code === 'unavailable') {
            throw new Error('Service temporarily unavailable. Please try again in a few moments.');
        }

        throw error;
    }
}

export async function submitTeamSize(companyId, seatCount, addOns = {}) {
    try {
        console.log('submitTeamSize called with companyId:', companyId, 'seatCount:', seatCount, 'addOns:', addOns);
        const now = serverTimestamp();
        const companyRef = doc(db, 'companies', companyId);

        console.log('Updating company document...');

        // Prepare company updates
        const companyUpdates = {
            seatCount,
            billingSeatQuota: seatCount,
            updatedAt: now
        };

        // If addons are provided, merge them into the plugins map
        if (Object.keys(addOns).length > 0) {
            // We use dot notation for nested field updates to avoid overwriting other plugins if any existed (though unlikely at this stage)
            // But since this is signup, creating the object structure is safer/cleaner.
            // Let's assume we want to set the plugins field. 
            // To be safe with existing data, we can construct the update.
            companyUpdates.plugins = addOns;
        }

        await updateDoc(companyRef, companyUpdates);
        console.log('Company document updated successfully');

        console.log('Finding subscription document...');
        const subs = query(collection(db, 'subscriptions'), where('companyId', '==', companyRef.path));
        const snap = await getDocs(subs);

        if (!snap.empty) {
            console.log('Updating subscription document...');
            await updateDoc(snap.docs[0].ref, { seatCount, updatedAt: now });
            console.log('Subscription document updated successfully');
        } else {
            console.log('No subscription document found');
        }

        console.log('submitTeamSize completed successfully');
        return { ok: true };
    } catch (error) {
        console.error('Error in submitTeamSize:', error);
        throw error;
    }
}


