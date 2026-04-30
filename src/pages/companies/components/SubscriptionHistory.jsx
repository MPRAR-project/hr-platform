import { History, DollarSign, Users, BarChart } from 'lucide-react';
import Badge from '../../../components/ui/Badge';
import SummaryCard from '../../../components/shared/SummaryCard';

const defaultHistory = [];

const computeSummary = (history) => {
  if (!history.length) {
    return {
      totalRevenue: '—',
      averageUsers: '—',
      growthRate: '—'
    };
  }

  const totals = history.reduce(
    (acc, row, index) => {
      const totalValue = Number(row.rawTotalAmount) || 0;
      const users = Number(row.users) || 0;
      acc.totalRevenue += totalValue;
      acc.totalUsers += users;
      if (index === 0) acc.latestUsers = users;
      acc.earliestUsers = users;
      return acc;
    },
    { totalRevenue: 0, totalUsers: 0, latestUsers: 0, earliestUsers: 0 }
  );

  const currencyFormatter = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP'
  });

  const totalRevenueDisplay = currencyFormatter.format(totals.totalRevenue);
  const averageUsersDisplay = Math.round(totals.totalUsers / history.length) || 0;
  const growthRate =
    totals.earliestUsers > 0
      ? `${(((totals.latestUsers - totals.earliestUsers) / totals.earliestUsers) * 100).toFixed(0)}%`
      : '—';

  return {
    totalRevenue: totalRevenueDisplay,
    averageUsers: `${averageUsersDisplay}`,
    growthRate: totals.earliestUsers > 0 ? growthRate : '—'
  };
};

const SubscriptionHistory = ({ history }) => {
  const rows = history || defaultHistory;
  const summary = computeSummary(rows);

  return (
    <div className="space-y-3xl">
      <div className="space-y-xl border p-4 rounded-base shadow-sm">
        <div className="flex items-center gap-md bg-bg-overlay-light p-md rounded-base">
          <History className="h-5 w-5 text-text-secondary" />
          <div>
            <h4 className="font-bold text-text-primary">Subscription History</h4>
            <p className="text-sm text-text-secondary">
              Monthly billing history and subscription details. Price: £5 per seat per month.
            </p>
          </div>
        </div>

        {rows.length > 0 ? (
          <div className="w-full overflow-x-auto scrollbar-custom -mx-4 md:mx-0 px-4 md:px-0">
            <table className="w-full text-left min-w-[800px]">
              <thead>
                <tr className="border-b border-border-primary">
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">MONTH</th>
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">USERS</th>
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">PRICE PER SEAT</th>
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">TOTAL AMOUNT</th>
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">PAYMENT DATE</th>
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">PAYMENT METHOD</th>
                  <th className="p-lg text-xs md:text-sm font-bold text-text-secondary whitespace-nowrap">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.month}-${row.date}`} className="border-b border-border-primary">
                    <td className="p-lg text-sm md:text-base font-semibold text-text-primary whitespace-nowrap">{row.month}</td>
                    <td className="p-lg text-sm md:text-base font-semibold text-text-primary whitespace-nowrap">{row.users}</td>
                    <td className="p-lg text-sm md:text-base font-semibold text-text-primary whitespace-nowrap">{row.price}</td>
                    <td className="p-lg text-sm md:text-base font-semibold text-text-primary whitespace-nowrap">{row.total}</td>
                    <td className="p-lg text-sm md:text-base font-semibold text-text-primary whitespace-nowrap">{row.date}</td>
                    <td className="p-lg text-sm md:text-base font-semibold text-text-primary whitespace-nowrap">{row.method}</td>
                    <td className="p-lg">
                      <Badge variant={row.status?.toLowerCase() === 'paid' ? 'success' : 'warning'}>
                        {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-text-secondary px-lg py-md">
            No subscription history available yet.
          </p>
        )}

        <p className="text-xs text-text-secondary text-center mt-sm md:hidden">
          ← Scroll horizontally to view all columns →
        </p>
      </div>

      <div className="flex flex-wrap gap-2xl">
        <SummaryCard
          title="Total Revenue"
          value={summary.totalRevenue}
          subtitle="Across recorded months"
          icon={<DollarSign className="h-6 w-6 text-orange-500" />}
          iconBgColor="bg-orange-100"
        />
        <SummaryCard
          title="Average Users"
          value={summary.averageUsers}
          subtitle="Per month average"
          icon={<Users className="h-6 w-6 text-text-accent-green" />}
          iconBgColor="bg-bg-accent-green"
        />
        <SummaryCard
          title="Growth Rate"
          value={summary.growthRate}
          subtitle="From earliest to latest month"
          icon={<BarChart className="h-6 w-6 text-text-accent-purple" />}
          iconBgColor="bg-bg-accent-purple"
        />
      </div>
    </div>
  );
};

export default SubscriptionHistory;