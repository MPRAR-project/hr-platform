import React from 'react';

const InvoiceTable = ({ data, dates, mode = 'pay' }) => {
    // dates is array of YYYY-MM-DD strings for the columns

    // Helper to format currency
    const formatCurrency = (val) => {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val || 0);
    };

    // Helper to format hours
    const formatHours = (val) => {
        return (val || 0).toFixed(2);
    };

    return (
        <div className="overflow-x-auto shadow-sm border border-gray-200 rounded-lg">
            <table className="min-w-full divide-y divide-gray-200 bg-white text-sm">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider w-48 sticky left-0 bg-gray-50 z-10">Employee</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-500 uppercase tracking-wider w-24">Type</th>
                        {dates.map(date => (
                            <th key={date} className="px-2 py-3 text-center font-medium text-gray-500 w-20">
                                {new Date(date).toLocaleDateString('en-GB', { weekday: 'short' })}<br />
                                <span className="text-xs font-normal">{new Date(date).getDate()}</span>
                            </th>
                        ))}
                        <th className="px-4 py-3 text-right font-medium text-gray-500 uppercase tracking-wider w-24">Rate</th>
                        <th className="px-4 py-3 text-right font-bold text-gray-700 uppercase tracking-wider w-32">Total</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {Object.values(data).map((item) => {
                        const { user, rates, days, totals } = item;

                        // Determined Rates based on mode
                        const standardRate = mode === 'pay' ? rates.standardPayRate : rates.standardChargeRate;
                        const overtimeRate = mode === 'pay' ? rates.overtimePayRate : rates.overtimeChargeRate;

                        const totalMoney = mode === 'pay' ? totals.pay : totals.charge;

                        return (
                            <React.Fragment key={user.id}>
                                {/* Basic Row */}
                                <tr className="hover:bg-gray-50">
                                    <td className="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white z-10 border-r" rowSpan={2}>
                                        {user.name}
                                    </td>
                                    <td className="px-4 py-2 text-gray-600 bg-gray-50/50">Basic</td>
                                    {dates.map(date => (
                                        <td key={date} className="px-2 py-2 text-center text-gray-600">
                                            {formatHours(days[date]?.basic)}
                                        </td>
                                    ))}
                                    <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(standardRate)}</td>
                                    {/* Total is usually sum of money for that type? Or total for user? 
                                        Request Grid: "Total Pay". Usually implies total for the row.
                                        Let's calculate Row Total.
                                    */}
                                    <td className="px-4 py-2 text-right font-medium text-gray-900 border-l">
                                        {formatCurrency(totals.basicHours * (Number(standardRate) || 0))}
                                    </td>
                                </tr>

                                {/* Overtime Row */}
                                <tr className="hover:bg-gray-50">
                                    {/* Name cell spanned */}
                                    <td className="px-4 py-2 text-blue-600 bg-blue-50/30">Overtime</td>
                                    {dates.map(date => (
                                        <td key={date} className="px-2 py-2 text-center text-blue-600">
                                            {days[date]?.overtime > 0 ? formatHours(days[date]?.overtime) : '-'}
                                        </td>
                                    ))}
                                    <td className="px-4 py-2 text-right text-blue-600">{formatCurrency(overtimeRate)}</td>
                                    <td className="px-4 py-2 text-right font-medium text-blue-700 border-l">
                                        {formatCurrency(totals.overtimeHours * (Number(overtimeRate) || 0))}
                                    </td>
                                </tr>
                                {/* Spacer/Divider row if needed, or just let border handle it */}
                            </React.Fragment>
                        );
                    })}

                    {Object.keys(data).length === 0 && (
                        <tr>
                            <td colSpan={dates.length + 4} className="px-4 py-8 text-center text-gray-500">
                                No data found for this period.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};

export default InvoiceTable;
