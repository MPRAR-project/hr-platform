import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

/**
 * Generate a Formal Invoice PDF
 * @param {Object} invoice - The invoice data object (including settings and totals)
 * @param {Array} lineItems - Array of user data objects { user, totals, rates }
 */
export const generateFormalInvoicePDF = (invoice, lineItems) => {
    const doc = new jsPDF();
    const { settingsSnapshot, invoiceNumber, createdAt, weekStart, siteName, description, totals, companyId } = invoice;
    const settings = settingsSnapshot || {};

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;

    // --- PAGE 1: COVER SHEET ---

    // 1. Header (Logo & Company Info)
    let yPos = 20;

    // Logo
    if (settings.logoBase64) {
        try {
            // Add Logo (Top Left or Right? User said "Company Logo" generally implies branding)
            // We'll place it at Top Left (margin, yPos) and move text down, 
            // OR align it opposite to "INVOICE".
            // Let's place it at Top Left.
            const imgProps = doc.getImageProperties(settings.logoBase64);
            const imgWidth = 40; // Fixed width
            const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

            doc.addImage(settings.logoBase64, 'PNG', margin, yPos, imgWidth, imgHeight);

            // Move text down below logo
            yPos += imgHeight + 10;
        } catch (e) {
            console.warn('Error adding logo to PDF', e);
        }
    }

    doc.setFontSize(22);
    doc.setTextColor(40, 40, 40);
    // Align "INVOICE" to the right, consistent with previous design
    // Use fixed Y if logo is present to keep header aligned, or dynamic?
    // Let's keep "INVOICE" at fixed top right, and company info below logo on left.
    doc.text('INVOICE', pageWidth - margin, 20, { align: 'right' });

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`# ${invoiceNumber}`, pageWidth - margin, 27, { align: 'right' });

    // Company Details (Left Side, below Logo if present)
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(settings.companyName || 'Company Name', margin, yPos);

    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    const addressLines = (settings.address || '').split('\n');
    let addressY = yPos + 6;
    addressLines.forEach(line => {
        doc.text(line.trim(), margin, addressY);
        addressY += 5;
    });

    if (settings.vatNumber) {
        doc.text(`VAT Reg: ${settings.vatNumber}`, margin, addressY);
        addressY += 5;
    }

    // 2. Client Details (Billing To) - Placeholder as "Site Address" isn't fully structured yet
    yPos = 80;
    doc.setFontSize(11);
    doc.setTextColor(150, 150, 150);
    doc.text('BILL TO:', margin, yPos);

    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(siteName || 'Site Client', margin, yPos + 7);
    // (Future: Add Site Address if available in Site object)

    // 3. Invoice Meta
    const metaX = pageWidth - margin - 40;
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('Invoice Date:', metaX, yPos);
    doc.text('Week Ending:', metaX, yPos + 6);

    doc.setTextColor(0, 0, 0);
    const invoiceDate = createdAt?.toDate ? format(createdAt.toDate(), 'dd MMM yyyy') : format(new Date(), 'dd MMM yyyy');
    doc.text(invoiceDate, pageWidth - margin, yPos, { align: 'right' });
    doc.text(weekStart || '-', pageWidth - margin, yPos + 6, { align: 'right' });

    // 4. Description / Main Line Item
    yPos = 110;
    doc.setFontSize(12);
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos, pageWidth - (margin * 2), 10, 'F');
    doc.text('Description', margin + 5, yPos + 7);
    doc.text('Amount', pageWidth - margin - 5, yPos + 7, { align: 'right' });

    yPos += 20;
    doc.setFontSize(11);
    doc.text(description || 'Services Rendered', margin + 5, yPos);
    doc.text(`£${totals.net.toFixed(2)}`, pageWidth - margin - 5, yPos, { align: 'right' });

    // 5. Totals Box
    yPos = 150;
    const totalsWidth = 80;
    const totalsX = pageWidth - margin - totalsWidth;

    // Line
    doc.setDrawColor(200, 200, 200);
    doc.line(totalsX, yPos, pageWidth - margin, yPos);
    yPos += 10;

    doc.text('Subtotal:', totalsX, yPos);
    doc.text(`£${totals.net.toFixed(2)}`, pageWidth - margin, yPos, { align: 'right' });
    yPos += 8;

    doc.text('VAT (20%):', totalsX, yPos);
    doc.text(`£${totals.vat.toFixed(2)}`, pageWidth - margin, yPos, { align: 'right' });
    yPos += 4; // Spacing

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL:', totalsX, yPos + 10);
    doc.text(`£${totals.grandTotal.toFixed(2)}`, pageWidth - margin, yPos + 10, { align: 'right' });

    // 6. Footer (Bank Details)
    const footerY = pageHeight - 40;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Payment Information:', margin, footerY);

    doc.setTextColor(0, 0, 0);
    const bankLines = (settings.bankDetails || '').split('\n');
    let bankY = footerY + 6;
    bankLines.forEach(line => {
        doc.text(line.trim(), margin, bankY);
        bankY += 5;
    });

    if (settings.utrNumber) {
        doc.text(`UTR: ${settings.utrNumber}`, margin + 80, footerY + 6);
    }

    // --- PAGE 2: SCHEDULE ---
    doc.addPage();
    yPos = 20;

    doc.setFontSize(16);
    doc.text('Timesheet Schedule', margin, yPos);

    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text(`Ref: ${siteName} - ${weekStart}`, margin, yPos + 6);

    // Build Table Body
    const tableBody = lineItems.map(item => {
        const name = (item.user.firstName && item.user.lastName)
            ? `${item.user.firstName} ${item.user.lastName}`
            : item.user.name || 'Unknown';
        const role = item.user.role || 'Staff';
        const hours = (item.totals?.basicHours || 0) + (item.totals?.overtimeHours || 0);
        const rate = item.rates?.standardChargeRate || 0; // Simplified for display
        const total = ((item.totals?.basicHours || 0) * (Number(item.rates?.standardChargeRate) || 0)) +
            ((item.totals?.overtimeHours || 0) * (Number(item.rates?.overtimeChargeRate) || 0));

        // Only include if value > 0
        if (total <= 0) return null;

        return [
            name,
            role,
            (item.totals?.basicHours || 0).toFixed(2),
            item.rates?.standardChargeRate,
            (item.totals?.overtimeHours || 0).toFixed(2),
            item.rates?.overtimeChargeRate,
            `£${total.toFixed(2)}`
        ];
    }).filter(Boolean); // Remove nulls

    doc.autoTable({
        startY: 40,
        head: [['Name', 'Role', 'Basic Hrs', 'Rate', 'OT Hrs', 'OT Rate', 'Total']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [66, 66, 66] },
        styles: { fontSize: 9 },
        columnStyles: {
            6: { halign: 'right' }
        }
    });

    // Save
    doc.save(`Invoice_${invoiceNumber}.pdf`);
};
