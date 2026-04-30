import { db } from '../firebase/client';
import { collection, getDocs, doc, setDoc, updateDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getClients, addClient } from './clients';
import { getSites, updateSite } from './sites';
import { createAssignment } from './userAssignments';

/**
 * Migration utility to add client relationships to existing data
 * This ensures backward compatibility while enabling new client-based features
 */

/**
 * Step 1: Ensure all companies have at least one default client
 * @param {string} companyId - Company ID
 * @returns {Promise<string>} - Client ID (existing or created)
 */
export async function ensureDefaultClient(companyId) {
    try {
        console.log(`[Migration] Checking clients for company: ${companyId}`);

        // Check if company has any clients
        const existingClients = await getClients(companyId);

        if (existingClients && existingClients.length > 0) {
            console.log(`[Migration] Company ${companyId} has ${existingClients.length} existing client(s)`);
            return existingClients[0].id; // Return first client ID
        }

        // No clients exist - create default client
        console.log(`[Migration] Creating default client for company: ${companyId}`);
        const defaultClient = await addClient(companyId, {
            name: 'Default Client',
            description: 'Auto-generated default client for existing data migration',
            status: 'active',
            isDefault: true
        });

        console.log(`[Migration] Default client created: ${defaultClient.id}`);
        return defaultClient.id;
    } catch (error) {
        console.error(`[Migration] Error ensuring default client for ${companyId}:`, error);
        throw error;
    }
}

/**
 * Step 2: Assign client to all sites without clientId
 * @param {string} companyId - Company ID
 * @param {string} clientId - Client ID to assign
 * @returns {Promise<number>} - Number of sites updated
 */
export async function assignClientToSites(companyId, clientId) {
    try {
        console.log(`[Migration] Assigning client ${clientId} to sites for company ${companyId}`);

        const sites = await getSites(companyId);
        let updateCount = 0;

        for (const site of sites) {
            if (!site.clientId) {
                await updateSite(site.id, { clientId });
                updateCount++;
                console.log(`[Migration] Assigned client to site: ${site.id} (${site.name})`);
            } else {
                console.log(`[Migration] Site ${site.id} already has client: ${site.clientId}`);
            }
        }

        console.log(`[Migration] Updated ${updateCount} sites with clientId`);
        return updateCount;
    } catch (error) {
        console.error(`[Migration] Error assigning clients to sites:`, error);
        throw error;
    }
}

/**
 * Step 3: Create assignments for all existing users
 * @param {string} companyId - Company ID
 * @returns {Promise<number>} - Number of assignments created
 */
export async function createAssignmentsForExistingUsers(companyId) {
    try {
        console.log(`[Migration] Creating assignments for existing users in company: ${companyId}`);

        // Get all users for the company
        const usersRef = collection(db, 'users');
        const usersSnapshot = await getDocs(usersRef);

        const users = usersSnapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(user => {
                const userCompanyId = user.companyId?.includes('/')
                    ? user.companyId.split('/')[1]
                    : user.companyId;
                return userCompanyId === companyId;
            });

        console.log(`[Migration] Found ${users.length} users for company`);

        let assignmentCount = 0;

        for (const user of users) {
            try {
                // Get user's site
                const siteId = user.siteId?.includes('/')
                    ? user.siteId.split('/')[1]
                    : user.siteId;

                if (!siteId) {
                    console.warn(`[Migration] User ${user.id} has no siteId, skipping`);
                    continue;
                }

                // Get site to find clientId
                const sitesRef = doc(db, 'sites', siteId);
                const siteSnapshot = await getDocs(collection(db, 'sites'));
                const site = siteSnapshot.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .find(s => s.id === siteId);

                if (!site || !site.clientId) {
                    console.warn(`[Migration] Site ${siteId} not found or has no clientId, skipping user ${user.id}`);
                    continue;
                }

                // Check if user already has an active assignment
                const assignmentsRef = collection(db, 'userAssignments');
                const existingAssignments = await getDocs(assignmentsRef);
                const hasAssignment = existingAssignments.docs
                    .map(d => ({ id: d.id, ...d.data() }))
                    .some(a => a.userId === user.id && a.status === 'active');

                if (hasAssignment) {
                    console.log(`[Migration] User ${user.id} already has an assignment, skipping`);
                    continue;
                }

                // Create assignment
                await createAssignment({
                    userId: user.id,
                    clientId: site.clientId,
                    siteId: siteId,
                    companyId: companyId,
                    startDate: user.createdAt || serverTimestamp(),
                    chargeRate: user.rates?.standardChargeRate || 0,
                    overtimeChargeRate: user.rates?.overtimeChargeRate || 0
                });

                assignmentCount++;
                console.log(`[Migration] Created assignment for user: ${user.id} (${user.email})`);
            } catch (userError) {
                console.error(`[Migration] Error creating assignment for user ${user.id}:`, userError);
                // Continue with next user
            }
        }

        console.log(`[Migration] Created ${assignmentCount} assignments`);
        return assignmentCount;
    } catch (error) {
        console.error(`[Migration] Error creating user assignments:`, error);
        throw error;
    }
}

/**
 * Step 4: Link existing timesheets to assignments
 * @param {string} companyId - Company ID
 * @returns {Promise<number>} - Number of timesheets updated
 */
export async function linkTimesheetsToAssignments(companyId) {
    try {
        console.log(`[Migration] Linking timesheets to assignments for company: ${companyId}`);

        // Get all assignments first
        const assignmentsRef = collection(db, 'userAssignments');
        const assignmentsSnapshot = await getDocs(assignmentsRef);
        const assignments = assignmentsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        console.log(`[Migration] Found ${assignments.length} total assignments`);

        // Get all timesheets
        const timesheetsRef = collection(db, 'timesheets');
        const timesheetsSnapshot = await getDocs(timesheetsRef);

        let updateCount = 0;
        let entryCount = 0;

        for (const timesheetDoc of timesheetsSnapshot.docs) {
            const timesheet = { id: timesheetDoc.id, ...timesheetDoc.data() };
            const entries = timesheet.entries || [];

            if (entries.length === 0) continue;

            let modified = false;
            const updatedEntries = entries.map(entry => {
                // Skip if entry already has assignmentId
                if (entry.assignmentId) {
                    return entry;
                }

                // Find assignment for this user on this entry date
                const entryDate = new Date(entry.date);
                const assignment = assignments.find(a => {
                    if (a.userId !== timesheet.userId) return false;
                    if (a.status !== 'active' && a.status !== 'ended') return false;

                    const startDate = a.startDate?.toDate ? a.startDate.toDate() : new Date(a.startDate);
                    const endDate = a.endDate?.toDate ? a.endDate.toDate() : null;

                    if (entryDate < startDate) return false;
                    if (endDate && entryDate > endDate) return false;

                    return true;
                });

                if (assignment) {
                    modified = true;
                    entryCount++;
                    return {
                        ...entry,
                        assignmentId: assignment.id,
                        clientId: assignment.clientId
                    };
                }

                return entry;
            });

            // Update timesheet if any entries were modified
            if (modified) {
                await updateDoc(doc(db, 'timesheets', timesheet.id), {
                    entries: updatedEntries,
                    updatedAt: serverTimestamp()
                });
                updateCount++;
                console.log(`[Migration] Updated timesheet ${timesheet.id}: ${entryCount} entries linked`);
            }
        }

        console.log(`[Migration] Linked ${entryCount} timesheet entries across ${updateCount} timesheets`);
        return updateCount;
    } catch (error) {
        console.error(`[Migration] Error linking timesheets:`, error);
        throw error;
    }
}

/**
 * Run complete migration for a company
 * @param {string} companyId - Company ID
 * @returns {Promise<Object>} - Migration results
 */
export async function runCompanyMigration(companyId) {
    console.log(`\n========== Starting Migration for Company: ${companyId} ==========\n`);

    const results = {
        companyId,
        clientId: null,
        sitesUpdated: 0,
        assignmentsCreated: 0,
        timesheetsLinked: 0,
        errors: []
    };

    try {
        // Step 1: Ensure default client exists
        results.clientId = await ensureDefaultClient(companyId);

        // Step 2: Assign client to sites
        results.sitesUpdated = await assignClientToSites(companyId, results.clientId);

        // Step 3: Create assignments for users
        results.assignmentsCreated = await createAssignmentsForExistingUsers(companyId);

        // Step 4: Link timesheets to assignments
        results.timesheetsLinked = await linkTimesheetsToAssignments(companyId);

        console.log(`\n========== Migration Complete for Company: ${companyId} ==========`);
        console.log(`Results:`, results);

        return results;
    } catch (error) {
        console.error(`\n========== Migration Failed for Company: ${companyId} ==========`);
        console.error(error);
        results.errors.push(error.message);
        throw error;
    }
}

/**
 * Run migration for all companies
 * @returns {Promise<Array>} - Array of migration results
 */
export async function runFullMigration() {
    try {
        console.log('\n========== Starting Full System Migration ==========\n');

        // Get all companies
        const companiesRef = collection(db, 'companies');
        const companiesSnapshot = await getDocs(companiesRef);
        const companies = companiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`Found ${companies.length} companies to migrate`);

        const allResults = [];

        for (const company of companies) {
            try {
                const result = await runCompanyMigration(company.id);
                allResults.push(result);
            } catch (error) {
                console.error(`Migration failed for company ${company.id}:`, error);
                allResults.push({
                    companyId: company.id,
                    errors: [error.message]
                });
            }
        }

        console.log('\n========== Full Migration Complete ==========');
        console.log(`Total companies processed: ${allResults.length}`);
        console.log(`Successful: ${allResults.filter(r => r.errors.length === 0).length}`);
        console.log(`Failed: ${allResults.filter(r => r.errors.length > 0).length}`);

        return allResults;
    } catch (error) {
        console.error('Full migration failed:', error);
        throw error;
    }
}
