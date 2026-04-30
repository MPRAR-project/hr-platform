/**
 * Timesheet PDF Export Service
 * Generates professional PDF documents for approved timesheets
 * Used for client billing and documentation purposes
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';

/**
 * Helper function to draw rounded rectangle
 */
function roundRect(doc, x, y, w, h, radius = 3) {
  const r = Math.min(radius, w / 2, h / 2);
  doc.path([
    ['m', x + r, y],
    ['l', x + w - r, y],
    ['q', x + w, y, x + w, y + r],
    ['l', x + w, y + h - r],
    ['q', x + w, y + h, x + w - r, y + h],
    ['l', x + r, y + h],
    ['q', x, y + h, x, y + h - r],
    ['l', x, y + r],
    ['q', x, y, x + r, y]
  ]).stroke();
}

/**
 * Generate a PDF for an approved timesheet
 * @param {Object} timesheet - Timesheet data with approval information
 * @param {Object} weekData - Week data containing daily entries
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Returns { success: true, filename: string }
 */
export async function generateTimesheetPDF(timesheet, weekData, options = {}) {
  try {
    // Validate inputs
    if (!timesheet || typeof timesheet !== 'object') {
      throw new Error('Invalid timesheet data provided');
    }

    // Validation: Ensure we have entries (Allowing 0 for blank approved sheets)
    const entries = options?.dailyRows || weekData?.entries || timesheet?.entries || [];

    const {
      employeeName = timesheet?.name || 'Employee',
      weekStart = options?.weekStart || timesheet?.start?.toDate?.() || (timesheet?.period ? new Date(timesheet.period) : new Date()),
      weekEnd = options?.weekEnd || timesheet?.end?.toDate?.() || (timesheet?.period ? new Date(new Date(timesheet.period).getTime() + 6 * 24 * 60 * 60 * 1000) : new Date()),
      dailyRows = options?.dailyRows || weekData?.entries || [], // Use weekData.entries if available
      headerTotals = options?.headerTotals || {},
      approvedByName = timesheet?.approvedByName || timesheet?.approverName || '',
      siteManager = timesheet?.siteManager || '',
      approvalDate = timesheet?.approvedAt,
      submissionDate = timesheet?.submittedDate || timesheet?.createdAt,
      approverRole = timesheet?.approverRole, // No default here, handle in logic
      companyName = timesheet?.companyName || '',
      customer = timesheet?.customer || '',
      location = timesheet?.location || '',
      projectDetails = timesheet?.workDetails || timesheet?.projectDetails || '',
      clockNumber = timesheet?.clockNumber || '',
      contractNumber = timesheet?.contractNumber || '',
      timesheetId = timesheet?.id || ''
    } = options;

    // Initialize PDF document
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPosition = 10;

    // Color scheme
    const borderColor = [0, 0, 0]; // Black borders
    const headerBgColor = [245, 245, 245]; // Very light gray
    const textColor = [0, 0, 0]; // Black text
    const accentColor = [41, 128, 185]; // Blue

    // Helper function to safely ensure string content
    const safeString = (val) => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'string') return val;
      if (val.toDate && typeof val.toDate === 'function') {
        return val.toDate().toLocaleDateString('en-GB');
      }
      if (typeof val === 'object') {
        return val.name || val.label || val.displayName || val.address || '';
      }
      return String(val);
    };

    // Helper function to format date
    const formatDate = (date) => {
      if (!date) return '';
      if (date.toDate && typeof date.toDate === 'function') return date.toDate().toLocaleDateString('en-GB');
      const d = new Date(date);
      if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB');
      return safeString(date);
    };

    // Helper to format date with time
    const formatDateWithTime = (date) => {
      if (!date) return '';
      if (date.toDate && typeof date.toDate === 'function') {
        const d = date.toDate();
        return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString('en-GB') + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      }
      return ''; // Don't return the object itself
    };

    // ==================== HEADER BOX SECTION ====================
    // Title with Timesheet ID
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...accentColor);
    doc.text('TIMESHEET', 15, yPosition);
    doc.setFontSize(10);
    doc.setTextColor(...textColor);
    doc.text(`ID# ${safeString(timesheetId)}`, pageWidth - 25, yPosition, { align: 'right' });

    yPosition += 10;

    // Draw rounded header info box with background
    const headerBoxX = 15;
    const headerBoxY = yPosition;
    const headerBoxWidth = pageWidth - 30;
    const headerBoxHeight = 35;

    // Light background
    doc.setFillColor(...headerBgColor);
    doc.rect(headerBoxX, headerBoxY, headerBoxWidth, headerBoxHeight, 'F');

    // Rounded border
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.8);
    roundRect(doc, headerBoxX, headerBoxY, headerBoxWidth, headerBoxHeight, 3);

    // Column dividers in header
    const col1 = headerBoxX + 5;
    const col2 = headerBoxX + headerBoxWidth / 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(col2, headerBoxY + 2, col2, headerBoxY + headerBoxHeight - 2);

    doc.setTextColor(...textColor);
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    let headerY = headerBoxY + 5;
    const lineHeight = 6.5;

    // Left column
    doc.text('Week Ending:', col1, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(`${formatDate(weekEnd)} - Day Shift`, col1 + 20, headerY);

    headerY += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Customer:', col1, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(safeString(customer), col1 + 20, headerY);

    headerY += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Location:', col1, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(safeString(location), col1 + 20, headerY);

    headerY += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Work Details:', col1, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(safeString(projectDetails), col1 + 20, headerY);

    // Right column
    headerY = headerBoxY + 5;
    doc.setFont(undefined, 'bold');
    doc.text('Operator Name:', col2 + 5, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(safeString(employeeName), col2 + 28, headerY);

    headerY += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Clock No:', col2 + 5, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(safeString(clockNumber), col2 + 28, headerY);

    headerY += lineHeight;
    doc.setFont(undefined, 'bold');
    doc.text('Contract No:', col2 + 5, headerY);
    doc.setFont(undefined, 'normal');
    doc.text(safeString(contractNumber), col2 + 28, headerY);

    yPosition = headerBoxY + headerBoxHeight + 6;

    yPosition += 5;

    // ==================== TIMESHEET TABLE ====================
    // Always render a 7-day table, even when there are no entries.
    const safeDailyRows = Array.isArray(dailyRows) ? dailyRows : [];
    console.log('📄 PDF Daily Rows:', safeDailyRows); // Debug: see what data is being passed

      // Helper function to format seconds to HH:MM format
      const formatSecToTime = (seconds) => {
        if (!seconds || seconds === 0) return '0h 00m';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${String(minutes).padStart(2, '0')}m`;
      };

      // Helper function to extract time from ISO string or timestamp
      const extractTime = (dateTimeStr) => {
        if (!dateTimeStr) return '';

        // Handle HH:MM strings (simple format)
        if (typeof dateTimeStr === 'string' && dateTimeStr.match(/^\d{1,2}:\d{2}$/)) {
          const [h, m] = dateTimeStr.split(':').map(Number);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const displayH = h % 12 || 12;
          return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
        }

        // Handle HH:MM AM/PM strings (e.g. "04:45 PM")
        const amPmMatch = typeof dateTimeStr === 'string' ? dateTimeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i) : null;
        if (amPmMatch) {
          return dateTimeStr;
        }

        // Handle HH:MM:SS strings
        if (typeof dateTimeStr === 'string' && dateTimeStr.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
          const [h, m] = dateTimeStr.split(':').map(Number);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const displayH = h % 12 || 12;
          return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
        }

        // Handle Firebase Timestamp objects
        if (dateTimeStr.toDate && typeof dateTimeStr.toDate === 'function') {
          const date = dateTimeStr.toDate();
          const hours = date.getHours();
          const minutes = String(date.getMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayHours = hours % 12 || 12;
          return `${String(displayHours).padStart(2, '0')}:${minutes} ${ampm}`;
        }

        // Handle ISO string format (which might contain timezone information like Z or +05:30)
        // Convert to local time instead of doing string-split which ignores timezones.
        if (typeof dateTimeStr === 'string' && dateTimeStr.includes('T')) {
          const dateObj = new Date(dateTimeStr);
          if (!isNaN(dateObj.getTime())) {
            const hours = dateObj.getHours();
            const minutes = String(dateObj.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const displayHours = hours % 12 || 12;
            return `${String(displayHours).padStart(2, '0')}:${minutes} ${ampm}`;
          }
        }

        // Handle JavaScript Date objects
        if (dateTimeStr instanceof Date) {
          const hours = dateTimeStr.getHours();
          const minutes = String(dateTimeStr.getMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayHours = hours % 12 || 12;
          return `${String(displayHours).padStart(2, '0')}:${minutes} ${ampm}`;
        }

        return '';
      };

      // ==================== TIMESHEET TABLE ====================
      // 1. Construct a dense 7-day array from weekStart to weekEnd
      const fullWeekRows = [];
      const startDate = new Date(weekStart);

      // Iterate 7 days
      for (let d = 0; d < 7; d++) {
        const currDate = new Date(startDate);
        currDate.setDate(startDate.getDate() + d);

        // Correctly format YYYY-MM-DD in local time, not UTC (which causes off-by-one errors)
        const yyyy = currDate.getFullYear();
        const mm = String(currDate.getMonth() + 1).padStart(2, '0');
        const dd = String(currDate.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        const dayName = currDate.toLocaleDateString('en-US', { weekday: 'long' });

        // Find ALL matching entries for this date
        const dayEntries = safeDailyRows.filter(r => {
          if (r.date === dateStr) return true;
          // Robust check: compare if dates match regardless of format
          if (r.date && new Date(r.date).toDateString() === currDate.toDateString()) return true;
          if (r.startTime && new Date(r.startTime).toDateString() === currDate.toDateString()) return true;
          // Legacy support: check start date string
          if (r.start && new Date(r.start).toDateString() === currDate.toDateString()) return true;
          return false;
        });

        if (dayEntries.length > 0) {
          // Aggregate data from all entries for this day

          // 1. Sort entries by time
          dayEntries.sort((a, b) => {
            const tA = a.rawStart || a.clockIn || '';
            const tB = b.rawStart || b.clockIn || '';
            // Ensure both values are strings before calling localeCompare
            const strA = String(tA || '');
            const strB = String(tB || '');
            return strA.localeCompare(strB);
          });

          // 2. Synthesize Clock In/Out Pairs
          // Check if the entry already has aggregated pairs (from ViewTimesheetModal)
          let pairs = [];

          const hasPreExistingPairs = dayEntries.length === 1 &&
            dayEntries[0].clockInOutPairs &&
            Array.isArray(dayEntries[0].clockInOutPairs) &&
            dayEntries[0].clockInOutPairs.length > 0;

          if (hasPreExistingPairs) {
            // ✅ FIX: The clockInOutPairs from ViewTimesheetModal already have
            // correctly UTC→Local-converted AM/PM strings in clockIn/clockOut.
            // We MUST use those directly, NOT re-process clockInTime (the raw
            // Firebase Timestamp), which bypasses detectAndConvertToLocal and
            // causes the wrong (UTC-based) time to appear in the PDF.
            pairs = dayEntries[0].clockInOutPairs.map(p => ({
              // Prefer the pre-converted AM/PM string; fallback to raw only if absent
              clockInTime: p.clockIn || p.clockInTime,
              clockOutTime: p.clockOut || p.clockOutTime
            }));
          } else {
            // Otherwise aggregate data from multiple raw entries
            pairs = dayEntries.map(e => ({
              clockInTime: e.rawStart || e.clockIn,
              clockOutTime: e.rawEnd || e.clockOut
            }));
          }

          // 3. Sum Totals from all entries
          const totalBreak = dayEntries.reduce((sum, e) => sum + (e.breakSec || e.breakSeconds || 0), 0);
          // Fix: Defensively calculate normalSec if missing (to avoid double counting fallback)
          const totalNormal = dayEntries.reduce((sum, e) => {
            if (Number.isFinite(e.normalSec)) return sum + e.normalSec;
            // Fallback: Effective - Overtime (Robust calculation)
            const eff = e.effectiveSec || 0;
            const over = e.overtimeSec || e.overtimeSeconds || 0;
            return sum + Math.max(0, eff - over);
          }, 0);
          const totalOvertime = dayEntries.reduce((sum, e) => sum + (e.overtimeSec || e.overtimeSeconds || 0), 0);
          const totalGross = dayEntries.reduce((sum, e) => sum + (e.grossSec || e.totalSec || 0), 0);

          // Use the first entry for static data like Project/Location if needed
          const first = dayEntries[0];

          // Compute joined strings for PDF cells
          // extractTime handles HH:MM or ISO
          const clockInStr = pairs.map(p => extractTime(p.clockInTime)).filter(x => x).join('\n');
          const clockOutStr = pairs.map(p => { const t = extractTime(p.clockOutTime); return t || ''; }).join('\n');

          fullWeekRows.push({
            day: dayName, // Explicitly set day name
            date: dateStr,
            workDetails: first.workDetails || first.project || '',
            workOrder: first.workOrder || '',
            clockInOutPairs: pairs,
            clockIn: clockInStr, // Pre-calculated string
            clockOut: clockOutStr, // Pre-calculated string
            breakSec: totalBreak,
            normalSec: totalNormal,
            overtimeSec: totalOvertime,
            totalSec: totalNormal + totalOvertime
          });
        } else {
          // Check if this day has an approved absence
          const dayWithAbsence = safeDailyRows.find(r => {
            if (r.date === dateStr && r.hasAbsence) return true;
            if (r.date && new Date(r.date).toDateString() === currDate.toDateString() && r.hasAbsence) return true;
            return false;
          });

          if (dayWithAbsence && dayWithAbsence.hasAbsence) {
            // Create row with absence information
            fullWeekRows.push({
              day: dayName,
              date: dateStr,
              manual: false,
              clockIn: dayWithAbsence.absenceLabel || 'Leave', // Show leave type
              clockOut: '',
              breakSec: 0,
              normalSec: dayWithAbsence.effectiveSec || dayWithAbsence.totalSec || 0, // Use effective hours from absence
              overtimeSec: 0,
              totalSec: dayWithAbsence.effectiveSec || dayWithAbsence.totalSec || 0
            });
          } else {
            // Create blank placeholder text for the day
            fullWeekRows.push({
              day: dayName,
              date: dateStr,
              manual: true,
              clockIn: '',
              clockOut: '',
              breakSec: 0,
              normalSec: 0,
              overtimeSec: 0,
              totalSec: 0
            });
          }
        }
      }

      console.log('📄 PDF Full Week Rows:', fullWeekRows);

      // Prepare table data from the dense array
      const tableData = fullWeekRows.map(row => {
        return [
          row.day || '', // Column 1: Description/Day Name
          row.workOrder || '',
          row.day || '', // Column 3: Day
          row.date || '', // Column 4: Date
          row.clockIn,    // Column 5: Clock In
          row.clockOut,   // Column 6: Clock Out
          formatSecToTime(row.breakSec),
          formatSecToTime(row.normalSec),
          formatSecToTime(row.overtimeSec),
          formatSecToTime(row.totalSec)
        ];
      });

      // Calculate totals from all daily rows
      // Calculate totals: Prioritize headerTotals (authoritative) over re-summing dailyRows
      let breakTotal, normalTotal, overtimeTotal, effectiveTotal;

      if (headerTotals && typeof headerTotals.effectiveSec === 'number') {
        console.log('📄 PDF Using Header Totals:', headerTotals);
        breakTotal = formatSecToTime(headerTotals.breakSec || 0);
        normalTotal = formatSecToTime(headerTotals.normalSec || 0);
        overtimeTotal = formatSecToTime(headerTotals.overtimeSec || 0);
        effectiveTotal = formatSecToTime(headerTotals.effectiveSec || 0);
      } else {
        console.warn('⚠️ PDF Header Totals missing, falling back to row summation');
        let totalBreakSec = 0;
        let totalNormalSec = 0;
        let totalOvertimeSec = 0;
        let totalEffectiveSec = 0;

        safeDailyRows.forEach(r => {
          totalBreakSec += (r.breakSec || r.breakSeconds || 0);
          // Fix: Logic duplicated from loop above - prioritize normalSec if defined (even if 0)
          totalNormalSec += (Number.isFinite(r.normalSec) ? r.normalSec : (r.effectiveSec || 0));
          totalOvertimeSec += (r.overtimeSec || r.overtimeSeconds || 0);
          totalEffectiveSec += (r.totalSec || r.grossSec || r.effectiveSec || 0);
        });

        breakTotal = formatSecToTime(totalBreakSec);
        normalTotal = formatSecToTime(totalNormalSec);
        overtimeTotal = formatSecToTime(totalOvertimeSec);
        effectiveTotal = formatSecToTime(totalEffectiveSec);
      }

      doc.autoTable({
        startY: yPosition,
        head: [['Description', 'Work Order', 'Day', 'Date', 'Clock In', 'Clock Out', 'Break', 'Normal', 'Overtime', 'Total']],
        body: tableData,
        foot: [['TOTAL', '', '', '', '', '', breakTotal, normalTotal, overtimeTotal, effectiveTotal]],
        theme: 'grid',
        headStyles: {
          fillColor: [0, 0, 0],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 9,
          halign: 'center',
          valign: 'middle',
          lineColor: [0, 0, 0],
          lineWidth: 0.5
        },
        bodyStyles: {
          textColor: [0, 0, 0],
          fontSize: 8,
          halign: 'center',
          valign: 'middle',
          lineColor: [0, 0, 0],
          lineWidth: 0.2
        },
        footStyles: {
          fillColor: [240, 240, 240],
          textColor: [0, 0, 0],
          fontStyle: 'bold',
          fontSize: 8,
          lineColor: [0, 0, 0],
          lineWidth: 0.5,
          valign: 'middle',
          halign: 'center'
        },
        columnStyles: {
          0: { halign: 'left', cellWidth: 30 }
        },
        margin: { left: 15, right: 15 }
      });

      // Get the final Y position from the table
      if (doc.lastAutoTable && doc.lastAutoTable.finalY) {
        yPosition = doc.lastAutoTable.finalY + 12;
      } else {
        yPosition += 80;
      }
    

    // ==================== APPROVAL SECTION ====================

    // ==================== APPROVAL SECTION ====================

    // Calculate box dimensions for 2 columns
    const approvalBoxWidth = (pageWidth - 45) / 2; // Two boxes with 15mm margins and 15mm gap
    const approvalBoxHeight = 28;
    const approvalBoxY = yPosition;
    const boxRadius = 3;

    // Helper to draw approval box
    const drawApprovalBox = (xPos, label, name, dateTime) => {
      // Background
      if (name) {
        doc.setFillColor(245, 245, 245); // Very light gray background if filled
        doc.rect(xPos, approvalBoxY, approvalBoxWidth, approvalBoxHeight, 'F');
      }

      // Border
      doc.setDrawColor(...borderColor);
      doc.setLineWidth(0.6);
      roundRect(doc, xPos, approvalBoxY, approvalBoxWidth, approvalBoxHeight, boxRadius);

      const boxCenterX = xPos + (approvalBoxWidth / 2);
      const labelY = approvalBoxY + 5;
      const nameY = approvalBoxY + 16;
      const dateTimeY = approvalBoxY + 23;

      // Label
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text(label, boxCenterX, labelY, { align: 'center' });

      // Name
      if (name) {
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...textColor);
        doc.text(safeString(name), boxCenterX, nameY, { align: 'center' });
      }

      // Date and Time
      if (dateTime) {
        doc.setFontSize(7);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(50, 50, 50);
        doc.text(dateTime, boxCenterX, dateTimeY, { align: 'center' });
      }
    };

    // 1. Submitted By Box
    drawApprovalBox(
      15, // Left margin
      'Submitted By',
      employeeName,
      submissionDate ? formatDateWithTime(submissionDate) : ''
    );

    // 2. Approved By Box
    // Determine dynamic label
    let approverLabel = 'Approved By';

    if (approverRole) {
      // Format role: HR_MANAGER -> HR Manager, siteManager -> Site Manager
      approverLabel = approverRole
        .replace(/_/g, ' ')
        // Insert space before capital letters if camelCase (e.g. siteManager -> site Manager)
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .replace(/\b\w/g, c => c.toUpperCase());
    } else if (siteManager && approvedByName && siteManager === approvedByName) {
      // Legacy/Fallback: If approver matches the site manager field, assume Site Manager
      approverLabel = 'Site Manager';
    } else if (approvedByName) {
      // Fallback if specific role unknown but approved
      approverLabel = 'Manager';
    }

    drawApprovalBox(
      15 + approvalBoxWidth + 15, // Left margin + box width + gap
      approverLabel,
      approvedByName || '',
      approvalDate ? formatDateWithTime(approvalDate) : ''
    );

    // Final download/save command
    const filename = `Timesheet_${timesheetId || 'export'}_${new Date().getTime()}.pdf`;

    if (options.returnBlob) {
      return {
        success: true,
        blob: doc.output('blob'),
        filename: filename
      };
    }

    doc.save(filename);

    return {
      success: true,
      filename: filename
    };

  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error(`Failed to generate PDF: ${error.message}`);
  }
}

/**
 * Check if jsPDF library is available
 * @returns {boolean} True if jsPDF is installed
 */
export function isJsPdfAvailable() {
  try {
    return typeof jsPDF !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Get PDF installation instructions
 * @returns {string} Installation command
 */
export function getJsPdfInstallCommand() {
  return 'npm install jspdf jspdf-autotable';
}
