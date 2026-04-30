
import React, { useEffect } from 'react';

export const InvoiceDebug = ({ invoiceData, selectedSiteId, sites, weekStart }) => {
    useEffect(() => {
        console.group("=== INVOICE DEBUGGER ===");
        console.log("Week Start:", weekStart);
        console.log("Selected Site ID:", selectedSiteId);

        const selectedSite = sites.find(s => s.id === selectedSiteId);
        console.log("Selected Site Object:", selectedSite);

        if (!invoiceData) {
            console.log("No invoice data loaded.");
            console.groupEnd();
            return;
        }

        console.log("Raw Invoice Data Keys:", Object.keys(invoiceData));

        let matchCount = 0;
        Object.values(invoiceData).forEach(item => {
            const user = item.user;
            const userSiteRaw = user.siteId;
            const normalizedUserSite = userSiteRaw ? (userSiteRaw.includes('/') ? userSiteRaw.split('/').pop() : userSiteRaw) : '';

            const isMatch = normalizedUserSite === selectedSiteId;
            if (isMatch) matchCount++;

            console.log(`User: ${user.name} (${user.id})`, {
                rawSiteId: userSiteRaw,
                normalizedSiteId: normalizedUserSite,
                targetSiteId: selectedSiteId,
                MATCH: isMatch,
                rates: item.rates,
                totals: item.totals
            });
        });

        console.log(`Total Matches Found: ${matchCount}`);
        console.groupEnd();
    }, [invoiceData, selectedSiteId, sites, weekStart]);

    return null;
};
