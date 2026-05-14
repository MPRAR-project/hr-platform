import hrApiClient from '../lib/hrApiClient';

/**
 * Invoice Service (Phase 4 — REST Migration)
 * 
 * Fetches invoice aggregation data via the HR REST API.
 * The heavy aggregation logic is now handled by the backend (PostgreSQL/Prisma).
 */

/**
 * Fetch invoice data for a company for a specific week or date range.
 */
export async function getCompanyInvoiceData(companyId, weekStartDate, weekEndDate, currentUser) {
    try {
        const { data } = await hrApiClient.get('/hr/billing/invoice-report', {
            params: {
                startDate: weekStartDate.toISOString ? weekStartDate.toISOString() : weekStartDate,
                endDate: weekEndDate.toISOString ? weekEndDate.toISOString() : weekEndDate
            }
        });

        // Normalize results to match the legacy frontend structure
        return data.map(item => ({
            userId: item.employeeId,
            name: item.name,
            email: item.email,
            rates: item.rates,
            totalHours: item.totalHours,
            financials: item.financials,
            // Daily hours might be missing from the summary report, 
            // but we can add them to the backend if the UI strictly needs them.
            dailyHours: item.dailyHours || {
                Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0, Sun: 0
            }
        }));
    } catch (error) {
        console.error('[invoiceService] Error fetching invoice data:', error);
        throw error;
    }
}
