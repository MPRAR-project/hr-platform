import { useState, useEffect, useRef } from 'react';
import { doc, collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase/client';
import { getUserDisplayName, validateRequiredIds } from '../utils/dataParser';
import { getRoleName } from '../utils/getRoleName';
import { fetchCompanyDashboardData, getCachedCompanyDashboard } from '../services/dataCache';

const formatDisplayDate = (value) => {
    if (!value) return '—';
    try {
        let dateValue = value;
        if (dateValue.toDate) {
            dateValue = dateValue.toDate();
        }
        const dateObj = dateValue instanceof Date ? dateValue : new Date(dateValue);
        if (Number.isNaN(dateObj.getTime())) {
            return '—';
        }
        return dateObj.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    } catch (error) {
        return '—';
    }
};

const formatLabel = (value) => {
    if (!value) return '—';
    try {
        return value
            .toString()
            .replace(/[_-]/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    } catch (error) {
        return value;
    }
};

export function useCompanyDashboard(companyId) {
    const [data, setData] = useState({
        teamMembers: [],
        totalUsers: 0,
        totalSeats: 0,
        monthlyBill: 0,
        pricePerSeat: 5,
        seatDeficit: 0,
        lastPaymentStatus: '—',
        lastPaymentDate: '—',
        nextBilling: '—',
        hasData: false,
        lastUpdated: null,
        seatUsageCount: 0,
        pendingInvites: 0,
        paymentMethod: '—',
        joinDate: '—'
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const lastDataRef = useRef(null);
    const debounceTimerRef = useRef(null);

    useEffect(() => {
        if (!companyId) {
            setLoading(false);
            return;
        }

        const idsValidation = validateRequiredIds({ companyId });
        if (!idsValidation.isValid) {
            setError(new Error(`Invalid company ID: ${idsValidation.errors.join(', ')}`));
            setLoading(false);
            return;
        }

        // Instant first paint from sync cache
        const cachedSync = getCachedCompanyDashboard(companyId);
        if (cachedSync) {
            setData({
                ...cachedSync,
                lastUpdated: cachedSync.lastUpdated || null,
            });
            setLoading(false);
        } else {
            setLoading(true);
        }

        // 1. SCALABILITY: Define limits for listeners
        const DASHBOARD_LISTENER_MAX_USERS = 2000;
        const DASHBOARD_LISTENER_MAX_PROFILES = 2000;
        const DASHBOARD_LISTENER_MAX_INVITES = 100;

        const companyRef = doc(db, 'companies', companyId);
        const usersQuery = query(
            collection(db, 'users'),
            where('companyId', '==', `companies/${companyId}`),
            limit(DASHBOARD_LISTENER_MAX_USERS)
        );
        const profilesQuery = query(
            collection(db, 'userCompanyProfiles'),
            where('companyId', '==', `companies/${companyId}`),
            limit(DASHBOARD_LISTENER_MAX_PROFILES)
        );
        const invitesQuery = query(
            collection(db, 'invites'),
            where('companyId', '==', companyId),
            where('status', '==', 'pending'),
            limit(DASHBOARD_LISTENER_MAX_INVITES)
        );

        const paymentsQuery = query(
            collection(db, 'payments'),
            where('companyId', '==', `companies/${companyId}`),
            orderBy('createdAt', 'desc'),
            limit(1)
        );

        const subsQuery = query(
            collection(db, 'subscriptions'),
            where('companyId', '==', `companies/${companyId}`),
            where('status', '==', 'active'),
            limit(1)
        );

        let companyUnsub, usersUnsub, profilesUnsub, invitesUnsub, paymentsUnsub, subsUnsub;

        // State holders for each part to recombine
        let companyDocData = null;
        let usersData = [];
        let profilesData = [];
        let invitesData = [];
        let paymentData = { status: '—', date: '—' };
        let subData = { nextBilling: '—' };

        const updateState = () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

            debounceTimerRef.current = setTimeout(() => {
                if (!companyDocData) return;

                try {
                    // 1. Create lookup map for global users
                    const userMap = new Map(usersData.map(u => [u.id, u]));
                    const processedUserIds = new Set();

                    // 2. Process profiles first
                    const profileMembers = profilesData.map(p => {
                        const uid = (p.userId || p.uid || p.id || '').trim();
                        if (!uid) return null;

                        const u = userMap.get(uid);
                        processedUserIds.add(uid);

                        const rawStatus = (u && u.status) || p.status || '';
                        let displayStatus = 'Inactive';
                        const normalizedStatus = rawStatus.toLowerCase();
                        if (normalizedStatus === 'active') displayStatus = 'Active';
                        else if (normalizedStatus === 'archived') displayStatus = 'Archived';
                        else if (normalizedStatus === 'inactive') displayStatus = 'Inactive';

                        const rawRole = p.primaryRole || (u && u.primaryRole) || 'Employee';
                        if (rawRole.toLowerCase() === 'sitemanager') return null;

                        const name = u ? getUserDisplayName(u) : (p.displayName || p.email || 'Unknown');

                        return {
                            id: uid,
                            name,
                            email: (u && u.email) || p.email || 'No email',
                            photoURL: (u && u.photoURL) || p.photoURL || null,
                            role: getRoleName(rawRole) || 'Employee',
                            jobTitle: (u && u.jobTitle) || getRoleName(rawRole) || 'Employee',
                            roleCategory: ['teamManager', 'adminManager', 'hrManager'].includes(rawRole) ? 'Manager' : 'Employee',
                            status: displayStatus,
                            joinDate: u ? formatDisplayDate(u.createdAt) : '',
                            isInvited: false
                        };
                    }).filter(Boolean);

                    // 3. Add orphan users
                    const orphanMembers = usersData
                        .filter(u => !processedUserIds.has(u.id))
                        .filter(u => (u.primaryRole || '').toLowerCase() !== 'sitemanager')
                        .map(u => {
                            const rawStatus = u.status || '';
                            const normalizedStatus = rawStatus.toLowerCase();
                            let displayStatus = 'Inactive';
                            if (normalizedStatus === 'active') displayStatus = 'Active';
                            else if (normalizedStatus === 'archived') displayStatus = 'Archived';
                            else if (normalizedStatus === 'inactive') displayStatus = 'Inactive';

                            return {
                                id: u.id,
                                name: getUserDisplayName(u),
                                email: u.email || 'No email',
                                photoURL: u.photoURL || null,
                                role: getRoleName(u.primaryRole) || 'Employee',
                                jobTitle: u.jobTitle || getRoleName(u.primaryRole) || 'Employee',
                                roleCategory: ['teamManager', 'adminManager', 'hrManager'].includes(u.primaryRole) ? 'Manager' : 'Employee',
                                status: displayStatus,
                                joinDate: formatDisplayDate(u.createdAt),
                                isInvited: false
                            };
                        });

                    const teamMembers = [...profileMembers, ...orphanMembers]
                        .reduce((acc, member) => {
                            const isDuplicate = acc.find(m =>
                                m.id === member.id ||
                                (m.email && member.email && m.email.toLowerCase() === member.email.toLowerCase())
                            );
                            if (!isDuplicate) {
                                acc.push(member);
                            }
                            return acc;
                        }, [])
                        .sort((a, b) => a.id.localeCompare(b.id));

                    const inviteMembers = invitesData.map(inv => ({
                        id: `invite-${inv.id}`,
                        name: inv.displayName || inv.email || 'Invited User',
                        email: inv.email || 'No email',
                        role: getRoleName(inv.primaryRole) || 'Employee',
                        status: 'Invited',
                        joinDate: formatDisplayDate(inv.createdAt) || 'Pending',
                        isInvited: true,
                        inviteId: inv.id
                    })).sort((a, b) => a.id.localeCompare(b.id));

                    const combinedMembers = [...teamMembers, ...inviteMembers];
                    const activeUsersCount = teamMembers.filter(m => m.status === 'Active').length;
                    const pendingInvitesCount = inviteMembers.length;

                    const seatCount = Number.isFinite(companyDocData.billingSeatQuota)
                        ? companyDocData.billingSeatQuota
                        : (companyDocData.seatCount || 0);

                    const pricePerSeat = Number.isFinite(companyDocData.billingPricePerSeat)
                        ? companyDocData.billingPricePerSeat
                        : Number.isFinite(companyDocData.pricePerSeat)
                            ? companyDocData.pricePerSeat
                            : 5;

                    let addonsCost = 0;
                    if (companyDocData.plugins?.scheduling) {
                        addonsCost += 2.50;
                    }
                    let monthlyBill = (seatCount * pricePerSeat) + addonsCost;

                    // Trial check - monthly bill is 0 during active trial
                    const baseStatus = companyDocData.billingSubscriptionStatus || companyDocData.subscriptionTier || 'trial';
                    const rawTrialEndsAt = companyDocData.billingTrialEndsAt || companyDocData.trialEndsAt;
                    let trialEndsAtDate = null;
                    if (rawTrialEndsAt) {
                        try {
                            trialEndsAtDate = rawTrialEndsAt.toDate ? rawTrialEndsAt.toDate() : new Date(rawTrialEndsAt);
                        } catch (e) {
                            // ignore parsing error
                        }
                    }
                    const now = new Date();
                    if (baseStatus === 'trial' && trialEndsAtDate && now <= trialEndsAtDate) {
                        monthlyBill = 0;
                    }
                    const seatUsageCount = activeUsersCount + pendingInvitesCount;
                    const seatDeficit = Math.max(0, seatUsageCount - seatCount);

                    const formattedNextBilling = companyDocData.billingRenewalDate
                        ? formatDisplayDate(companyDocData.billingRenewalDate)
                        : (subData.nextBilling || '—');

                    const formattedLastPaymentStatus = formatLabel(
                        companyDocData.billingLastPaymentType || paymentData.status || '—'
                    );

                    const formattedLastPaymentDate = companyDocData.billingLastPaymentAt
                        ? formatDisplayDate(companyDocData.billingLastPaymentAt)
                        : (paymentData.date || '—');

                    const paymentMethod = formatLabel(
                        companyDocData.defaultPaymentMethod || companyDocData.paymentMethod || '—'
                    );

                    const newData = {
                        teamMembers: combinedMembers,
                        totalUsers: activeUsersCount,
                        seatUsageCount,
                        pendingInvites: pendingInvitesCount,
                        totalSeats: seatCount,
                        monthlyBill,
                        pricePerSeat,
                        seatDeficit,
                        lastPaymentStatus: formattedLastPaymentStatus,
                        lastPaymentDate: formattedLastPaymentDate,
                        nextBilling: formattedNextBilling,
                        paymentMethod,
                        joinDate: formatDisplayDate(companyDocData.createdAt),
                        lastUpdated: new Date().toISOString(),
                        hasData: true
                    };

                    const { lastUpdated: _newTs, ...newProps } = newData;
                    const { lastUpdated: _oldTs, ...oldProps } = lastDataRef.current || {};

                    const deepEqual = (obj1, obj2) => {
                        if (obj1 === obj2) return true;
                        if (obj1 == null || obj2 == null) return false;
                        if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return obj1 === obj2;
                        const keys1 = Object.keys(obj1);
                        const keys2 = Object.keys(obj2);
                        if (keys1.length !== keys2.length) return false;
                        for (const key of keys1) {
                            if (!keys2.includes(key) || !deepEqual(obj1[key], obj2[key])) return false;
                        }
                        return true;
                    };

                    if (lastDataRef.current && deepEqual(newProps, oldProps)) return;

                    lastDataRef.current = newData;
                    setData(newData);
                    setLoading(false);

                    // PERSISTENCE: Save the new real-time state back to cache
                    // This ensures the NEXT visit gets the most up-to-date real-time data immediately
                    if (newData.hasData && companyId) {
                        import('../services/dataCache').then(m => {
                            m.default.set(`company-dashboard-${companyId}`, newData);
                        }).catch(err => console.warn('Failed to update cache from listener', err));
                    }
                } catch (err) {
                    console.error('Error processing dashboard data', err);
                    setError(err);
                    setLoading(false);
                }
            }, 100);
        };

        try {
            companyUnsub = onSnapshot(companyRef, (snap) => {
                if (snap.exists()) {
                    companyDocData = snap.data();
                    updateState();
                } else {
                    console.warn('Company doc not found');
                    setError(new Error("Company profile could not be found. Please contact support."));
                    setLoading(false);
                }
            }, (err) => {
                console.error('Company snapshot error', err);
                setError(err);
                setLoading(false);
            });

            usersUnsub = onSnapshot(usersQuery, (snap) => {
                usersData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                updateState();
            });

            profilesUnsub = onSnapshot(profilesQuery, (snap) => {
                profilesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                updateState();
            });

            invitesUnsub = onSnapshot(invitesQuery, (snap) => {
                invitesData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                updateState();
            });

            try {
                paymentsUnsub = onSnapshot(paymentsQuery, (snap) => {
                    if (!snap.empty) {
                        const p = snap.docs[0].data();
                        paymentData = {
                            status: p.status || '—',
                            date: p.createdAt?.toDate ? p.createdAt.toDate().toISOString().slice(0, 10) : '—'
                        };
                        updateState();
                    }
                });
            } catch (e) { console.warn('Payments setup failed', e); }

            try {
                subsUnsub = onSnapshot(subsQuery, (snap) => {
                    if (!snap.empty) {
                        const s = snap.docs[0].data();
                        subData = {
                            nextBilling: s.periodEnd?.toDate ? s.periodEnd.toDate().toISOString().slice(0, 10) : '—'
                        };
                        updateState();
                    }
                });
            } catch (e) { console.warn('Subs setup failed', e); }

        } catch (err) {
            console.error('Error setting up listeners', err);
            setError(err);
            setLoading(false);
        }

        return () => {
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
            if (companyUnsub) companyUnsub();
            if (usersUnsub) usersUnsub();
            if (profilesUnsub) profilesUnsub();
            if (invitesUnsub) invitesUnsub();
            if (paymentsUnsub) paymentsUnsub();
            if (subsUnsub) subsUnsub();
        };
    }, [companyId]);

    return { data, loading, error };
}
