import { db } from '../firebase/client';
import { collection, addDoc, getDocs, query, where, serverTimestamp, getDoc, doc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import cache from './dataCache';

const COLLECTION = 'incident_reports';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function addIncidentReport(companyId, userId, data, photos = [], role = 'employee') {
    if (!companyId || !userId) throw new Error('Company and User ID required');

    // Normalize companyId to ensure it has the correct prefix
    const normalizedCompanyId = companyId.startsWith('companies/')
        ? companyId
        : `companies/${companyId}`;

    // 1. Upload Photos first if any (in parallel for speed)
    const photoUrls = [];
    if (photos.length > 0) {
        const storage = getStorage();
        const uploadPromises = photos.map(async (file) => {
            const timestamp = Date.now();
            const path = `incident-photos/${normalizedCompanyId.split('/')[1]}/${timestamp}_${file.name}`;
            const storageRef = ref(storage, path);
            const snap = await uploadBytes(storageRef, file);
            const url = await getDownloadURL(snap.ref);
            return { url, path, name: file.name };
        });
        const results = await Promise.all(uploadPromises);
        photoUrls.push(...results);
    }

    // 2. Save Document
    const payload = {
        companyId: normalizedCompanyId,
        submittedBy: userId,
        player: data.player,
        incidentDate: data.incidentDate, // ISO string
        location: data.location,
        description: data.description,
        photos: photoUrls,
        createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, COLLECTION), payload);

    // Clear cache after adding new report
    const cleanCompanyId = normalizedCompanyId.split('/')[1];
    const normalizedRole = role?.toLowerCase()?.replace(/\s+/g, '') || '';
    const managerRoles = [
        'sitemanager', 'adminmanager', 'superuser', 'teammanager',
        'seniormanager', 'hrmanager', 'hradvisor', 'adminadvisor', 'contractmanager'
    ];
    const canViewAll = managerRoles.includes(normalizedRole);

    // Clear relevant cache entries
    cache.delete(`incident-reports-${cleanCompanyId}-all`);
    if (!canViewAll) {
        cache.delete(`incident-reports-${cleanCompanyId}-${normalizedRole}-${userId}`);
    }

    return { id: docRef.id, ...payload };
}

export async function getIncidentReports(companyId, role, userId, options = {}) {
    if (!companyId) return [];

    const { forceRefresh = false } = options;

    // Normalize companyId to ensure it has the correct prefix
    const normalizedCompanyId = companyId.startsWith('companies/')
        ? companyId
        : `companies/${companyId}`;

    const cleanCompanyId = normalizedCompanyId.split('/')[1];

    // Normalize role check (lowercase and remove spaces for robustness)
    const normalizedRole = role?.toLowerCase()?.replace(/\s+/g, '') || '';
    const managerRoles = [
        'sitemanager', 'adminmanager', 'superuser', 'teammanager',
        'seniormanager', 'hrmanager', 'hradvisor', 'adminadvisor', 'contractmanager'
    ];

    const canViewAll = managerRoles.includes(normalizedRole);

    // Create cache key based on user permissions
    const cacheKey = canViewAll
        ? `incident-reports-${cleanCompanyId}-all`
        : `incident-reports-${cleanCompanyId}-${normalizedRole}-${userId}`;

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
        const cached = cache.get(cacheKey);
        if (cached) {
            console.log(`📋 Incident Reports: Cache hit for ${cacheKey}`);
            return cached;
        }
    }

    console.log(`🌐 Incident Reports: Fetching fresh data for ${cacheKey}`);

    let q;
    // CRITICAL: We remove query-level orderBy to bypass "Missing Index" error.
    // Index propagation in Firebase can take time; sorting in memory ensures the app works immediately.
    if (canViewAll) {
        q = query(
            collection(db, COLLECTION),
            where('companyId', '==', normalizedCompanyId)
        );
    } else {
        q = query(
            collection(db, COLLECTION),
            where('companyId', '==', normalizedCompanyId),
            where('submittedBy', '==', userId)
        );
    }

    const snap = await getDocs(q);

    if (snap.empty) {
        cache.set(cacheKey, []);
        return [];
    }

    // --- PERFORMANCE FIX: Deduplicate user lookups ---
    // Collect unique submitter IDs to avoid redundant Firestore reads
    const rawReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const uniqueSubmitterIds = [...new Set(rawReports.map(r => r.submittedBy).filter(Boolean))];

    // Fetch all unique user docs in parallel (one batch, not N sequential calls)
    const userSnapshots = await Promise.all(
        uniqueSubmitterIds.map(uid => getDoc(doc(db, 'users', uid)).catch(() => null))
    );

    // Build a lookup map: userId -> displayName
    const userNameMap = {};
    uniqueSubmitterIds.forEach((uid, idx) => {
        const uSnap = userSnapshots[idx];
        if (uSnap && uSnap.exists()) {
            const u = uSnap.data();
            userNameMap[uid] = u.displayName || u.email || 'Unknown';
        } else {
            userNameMap[uid] = 'Unknown';
        }
    });

    // Enrich reports with submitter names from the map (no extra Firestore calls)
    const reports = rawReports.map(data => ({
        ...data,
        submitterName: data.submittedBy ? (userNameMap[data.submittedBy] || 'Unknown') : 'Unknown'
    }));

    // Sort in memory by createdAt descending
    reports.sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
        return timeB - timeA;
    });

    // Cache the result
    cache.set(cacheKey, reports);

    return reports;
}
