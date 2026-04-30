import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

/**
 * Helper function to get user display name with fallback
 * @param {Object} user - User object
 * @returns {string} Display name
 */
const getUserDisplayName = (user) => {
    if (user.firstName && user.lastName) {
        return `${user.firstName} ${user.lastName}`;
    }
    if (user.name) {
        return user.name;
    }
    return user.role || 'Unknown User';
};

/**
 * Generate a Payslip / Self-Billing Invoice PDF
 * @param {Object} data - Format: { user, period, company, settings, calculations }
 */
export const generatePayslipPDF = (data) => {
    const { user, period, company, settings, calculations } = data;
    const doc = new jsPDF();

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let yPos = 20;

    // --- HEADER ---

    // Logo (Placeholder Box or Text if URL issues)
    // Ideally we would load the image from settings.logoUrl
    // Logo
    if (data.logoBase64) {
        try {
            // Auto-detect format from base64 string (pass null for format)
            doc.addImage(data.logoBase64, null, margin, yPos, 40, 20);
        } catch (e) {
            console.error("Error adding logo to PDF:", e);
            doc.text("LOGO (Error)", margin + 5, yPos + 12);
        }
    } else {
        // Fallback Placeholder
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, yPos, 40, 20, 'F');
        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.text("LOGO", margin + 12, yPos + 12);
    }

    // Header Text
    doc.setTextColor(200, 50, 50); // Red-ish for "Self billing"
    doc.setFontSize(10);
    doc.text("This is a self billing invoice", pageWidth / 2, yPos + 8, { align: 'center' });

    doc.setTextColor(0, 0, 0);
    doc.text(`Tel: ${settings.phone || ''}`, pageWidth - margin, yPos + 5, { align: 'right' });
    // Phone not in settings yet, using empty string for now
    doc.text(`Email: ${settings.email || ''}`, pageWidth - margin, yPos + 10, { align: 'right' });
    // Email not in settings, generic fallback or empty

    yPos += 30;

    // --- BLUE BAR HEADER ---
    doc.setFillColor(0, 51, 102); // Dark Blue
    doc.rect(margin, yPos, pageWidth - (margin * 2), 10, 'F');
    yPos += 10; // Move below the bar

    // --- INVOICE DETAILS ---
    yPos += 5;

    // Left: "Invoice From" (User)
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Invoice From:", margin, yPos);
    doc.setFont("helvetica", "bold");
    const userName = getUserDisplayName(user);
    doc.text(userName, margin, yPos + 5);

    // Right: "Invoice To" (Company)
    doc.text("Invoice to:", pageWidth - margin - 80, yPos);
    doc.text(settings.companyName || "Company Name", pageWidth - margin - 80, yPos + 5);

    yPos += 15;

    // Invoice Meta Table (Manual Grid)
    const midX = pageWidth / 2;
    doc.setFont("helvetica", "normal");

    // Row 1
    doc.text("Invoice Date:", margin, yPos);
    doc.text(format(new Date(), 'dd/MM/yyyy'), midX - 20, yPos);

    // box for totals
    const totalsBoxX = pageWidth - margin - 50;
    doc.rect(totalsBoxX, yPos - 4, 50, 15);
    doc.text("Net", totalsBoxX + 2, yPos);
    doc.text(`£${calculations.netPay.toFixed(2)}`, pageWidth - margin - 2, yPos, { align: 'right' });

    yPos += 5;
    doc.text("Invoice Number:", margin, yPos);
    doc.text(data.invoiceNumber || "DRAFT", midX - 20, yPos);

    doc.text("VAT", totalsBoxX + 2, yPos);
    doc.text("0", pageWidth - margin - 2, yPos, { align: 'right' });

    yPos += 5;
    doc.text("Contract work undertaken week ending:", margin, yPos);
    const formattedEndDate = period.end ? format(new Date(period.end), 'dd/MM/yyyy') : '-';
    doc.text(formattedEndDate, midX - 20, yPos);

    doc.text("Total", totalsBoxX + 2, yPos);
    doc.setFont("helvetica", "bold");
    doc.text(`£${calculations.netPay.toFixed(2)}`, pageWidth - margin - 2, yPos, { align: 'right' });

    yPos += 15;

    // --- REMITTANCE SECTION ---
    doc.setFillColor(0, 51, 102); // Dark Blue
    doc.rect(margin, yPos, pageWidth - (margin * 2), 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text("Remittance Payment & Deduction Sheet", margin + 2, yPos + 5.5);

    yPos += 15;
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.text(`Charges to ${settings.companyName || 'Company'}:`, margin, yPos);
    yPos += 5;

    doc.text("Subcontractor", margin, yPos);
    doc.text(userName, margin + 50, yPos);
    yPos += 5;

    doc.text("UTR Number", margin, yPos);
    doc.text(calculations.utr || "N/A", margin + 50, yPos);

    yPos += 10;

    // --- MAIN CALCULATIONS TABLE ---
    const tableData = [
        [
            "Basic Hours",
            calculations.basicHours.toFixed(2),
            `Rate £${calculations.rates.basic.toFixed(2)}`,
            `£${calculations.grossBasic.toFixed(2)}`
        ],
        [
            "OT Hours",
            calculations.overtimeHours.toFixed(2),
            `Rate £${calculations.rates.overtime.toFixed(2)}`,
            `£${calculations.grossOvertime.toFixed(2)}`
        ]
    ];

    // Deductions
    if (calculations.cisDeduction > 0) {
        tableData.push([
            `CIS Deduction @ ${user.cisDeduction || '20%'}`,
            "", // no hours
            "", // no rate
            `-£${calculations.cisDeduction.toFixed(2)}`
        ]);
        // Highlight CIS in red
    }

    if (calculations.adminDeduction > 0) {
        tableData.push([
            "Admin Deduction",
            "",
            "",
            `-£${calculations.adminDeduction.toFixed(2)}`
        ]);
    }

    doc.autoTable({
        startY: yPos,
        head: [['Reference', 'Units', 'Rate', 'Total']],
        body: tableData,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 1 },
        columnStyles: {
            0: { fontStyle: 'bold', width: 80 },
            3: { halign: 'right', fontStyle: 'bold' }
        },
        didParseCell: function (data) {
            // Example: Color deduction rows red
            if (data.section === 'body' && (data.row.raw[0].includes('Deduction'))) {
                data.cell.styles.textColor = [200, 0, 0];
            }
        }
    });

    // Final output logic
    const periodStr = period.end ? format(new Date(period.end), 'yyyyMMdd') : 'period';
    const filename = `Payslip_${user.firstName}_${user.lastName}_${periodStr}.pdf`;

    if (data.returnBase64) {
        // Return object with base64 content and filename
        const dataUri = doc.output('datauristring');
        // Remove "data:application/pdf;base64," prefix
        const base64 = dataUri.split(',')[1];
        return { base64, filename };
    } else {
        doc.save(filename);
    }
};
