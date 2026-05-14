import hrApiClient from '../lib/hrApiClient';

const GBP_FORMATTER = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});

const PRICE_PER_SEAT = 5;

const formatCurrencyWithDecimals = (value) => {
  const formatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  });
  return formatter.format(value || 0);
};

export async function fetchCompanyDetails(companyId) {
  try {
    const { data } = await hrApiClient.get(`/hr/companies/${companyId}`);
    const { company, activeUsersCount, siteManagers, totalEmployees } = data;

    // Map to expected UI shape
    const companyInfo = {
      id: company.id,
      name: company.name,
      status: company.subscriptionStatus === 'active' ? 'active' : 'Inactive',
      industry: company.industry || 'Not specified',
      joinDate: company.createdAt?.slice(0, 10) || '—',
      contactEmail: company.ownerEmail || 'Not provided',
      billingEmail: company.billingEmail || 'Not provided',
      website: company.website || 'Not provided',
      phone: company.phone || 'Not provided',
      address: company.address || 'Not provided',
      paymentMethod: company.lastPaymentType || 'Not provided',
      seatCount: company.seatQuota || 0,
      currentUsers: activeUsersCount || 0,
      pricePerSeat: formatCurrencyWithDecimals(company.pricePerSeat || PRICE_PER_SEAT),
      createdAt: company.createdAt
    };

    const monthlyRevenue = companyInfo.seatCount * PRICE_PER_SEAT;
    const totalRevenue = (company.billingHistory || []).reduce((sum, p) => sum + (p.amount || 0), 0);

    const stats = {
      currentUsers: companyInfo.currentUsers,
      pricePerSeat: `${companyInfo.pricePerSeat}/Month`,
      monthlyRevenue: formatCurrencyWithDecimals(monthlyRevenue),
      totalRevenue: formatCurrencyWithDecimals(totalRevenue)
    };

    const paymentHistory = (company.billingHistory || []).map(entry => ({
      month: entry.month || new Date(entry.createdAt).toLocaleString('en-GB', { month: 'long', year: 'numeric' }),
      users: entry.seats || 0,
      price: formatCurrencyWithDecimals(entry.amount / entry.seats || PRICE_PER_SEAT),
      total: formatCurrencyWithDecimals(entry.amount || 0),
      date: entry.createdAt?.slice(0, 10),
      method: entry.type || 'Card',
      status: 'paid',
      rawTotalAmount: entry.amount
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Site Manager Groups
    const siteManagerGroups = siteManagers.map(sm => ({
      primary: {
        id: sm.id,
        name: `${sm.firstName} ${sm.lastName}`,
        email: sm.email,
        jobTitle: 'Site Manager',
        status: sm.status,
        isManager: true
      },
      associated: [],
      teamStats: { totalMembers: 0, activeMembers: 0 },
      managerType: 'siteManager',
      groupType: 'managed'
    }));

    return {
      company: companyInfo,
      stats,
      subscriptionHistory: paymentHistory,
      userGroups: siteManagerGroups // Note: Full user groups might need another endpoint
    };
  } catch (error) {
    console.error('[companyService] Error fetching details:', error);
    throw error;
  }
}


