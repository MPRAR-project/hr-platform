import jsPDF from 'jspdf';
import 'jspdf-autotable';

export const generateInvoicePDF = (data, dates, mode, dateRange, visibleColumns) => {
    const doc = new jsPDF('landscape');

    // Header
    const title = mode === 'pay' ? 'Invoice Summary - Paid Rates' : 'Invoice Summary - Charge Back';
    const period = `${dateRange.start.toLocaleDateString()} - ${dateRange.end.toLocaleDateString()}`;

    doc.setFontSize(18);
    doc.text(title, 14, 22);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Period: ${period}`, 14, 30);
    doc.setTextColor(0);

    // 1. Determine Visible Columns in Order
    const allKeys = ['employee', 'type', ...dates, 'rate', 'total'];
    // Default to all true if visibleColumns is missing (safety)
    const effectiveVisible = visibleColumns || allKeys.reduce((acc, k) => ({ ...acc, [k]: true }), {});
    
    // Filter keys based on current visibility state
    const activeKeys = allKeys.filter(key => effectiveVisible[key]);

    // 2. Build Header Row
    const getLabel = (key) => {
        if (key === 'employee') return 'Employee';
        if (key === 'type') return 'Type';
        if (key === 'rate') return 'Rate';
        if (key === 'total') return 'Total';
        // Date
        const d = new Date(key);
        // Fallback for invalid dates
        if (isNaN(d.getTime())) return key;
        return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()}`;
    };

    const headers = activeKeys.map(getLabel);

    // 3. Build Table Body
    const tableBody = [];
    Object.values(data).forEach(item => {
        const { user, rates, days, totals } = item;
        const standardRate = mode === 'pay' ? rates.standardPayRate : rates.standardChargeRate;
        const overtimeRate = mode === 'pay' ? rates.overtimePayRate : rates.overtimeChargeRate;

        // Helper to get value for a key
        const getValue = (key, isOvertime) => {
            if (key === 'employee') return isOvertime ? '' : user.name;
            if (key === 'type') return isOvertime ? 'Overtime' : 'Basic';
            if (key === 'rate') {
                const r = isOvertime ? overtimeRate : standardRate;
                return (Number(r) || 0).toFixed(2);
            }
            if (key === 'total') {
                const h = isOvertime ? totals.overtimeHours : totals.basicHours;
                const r = isOvertime ? overtimeRate : standardRate;
                return (h * (Number(r) || 0)).toFixed(2);
            }
            // Date key
            if (days[key]) {
                const val = isOvertime ? days[key].overtime : days[key].basic;
                return (val || 0).toFixed(2);
            }
            // If date exists in dates array but no data for this user, return 0.00
            if (dates.includes(key)) return '0.00';
            
            return '';
        };

        // Basic Row
        const basicRow = activeKeys.map(k => getValue(k, false));
        // Overtime Row
        const overtimeRow = activeKeys.map(k => getValue(k, true));

        tableBody.push(basicRow, overtimeRow);
    });

    // 4. Dynamic Styles
    const columnStyles = {};
    activeKeys.forEach((key, index) => {
        if (key === 'employee') columnStyles[index] = { fontStyle: 'bold' };
        if (key === 'rate' || key === 'total') columnStyles[index] = { halign: 'right' };
        if (key === 'total') columnStyles[index] = { ...columnStyles[index], fontStyle: 'bold' };
    });

    doc.autoTable({
        startY: 40,
        head: [headers],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [66, 133, 244] },
        columnStyles: columnStyles,
        didParseCell: function (data) {
            // Style Overtime rows differently?
            // Need to identify overtime row. Since we push pairs, index % 2 !== 0 is reliable.
            if (data.row.index % 2 !== 0) {
                // Find index of 'type' column to color it blue
                const typeIdx = activeKeys.indexOf('type');
                if (typeIdx > -1 && data.column.index === typeIdx) {
                    data.cell.styles.textColor = [59, 130, 246];
                }
            }
        }
    });

    doc.save(`Invoice_Summary_${mode}_${dates[0]}.pdf`);
};
