/**
 * Debugging utility for timesheet data consistency issues
 */
import { getWeekRange, formatISODate } from '../services/timesheets';

export const debugTimesheetWeekRange = (inputDate, context = '') => {
  console.group(`🔍 Timesheet Week Range Debug - ${context}`);
  
  try {
    const date = new Date(inputDate);
    console.log('Input date:', inputDate, 'Parsed:', date, 'Valid:', !isNaN(date.getTime()));
    
    if (!isNaN(date.getTime())) {
      const weekRange = getWeekRange(date);
      const startStr = formatISODate(weekRange.start);
      const endStr = formatISODate(weekRange.end);
      
      console.log('Week range:', {
        start: startStr,
        end: endStr,
        startDay: weekRange.start.toLocaleDateString('en-US', { weekday: 'long' }),
        endDay: weekRange.end.toLocaleDateString('en-US', { weekday: 'long' })
      });
      
      // Generate the 7 days of the week
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekRange.start);
        d.setDate(weekRange.start.getDate() + i);
        days.push(formatISODate(d));
      }
      
      console.log('Week days:', days);
      
      return {
        isValid: true,
        weekRange,
        startStr,
        endStr,
        days
      };
    } else {
      console.error('Invalid date provided');
      return { isValid: false };
    }
  } catch (error) {
    console.error('Error in week range calculation:', error);
    return { isValid: false, error };
  } finally {
    console.groupEnd();
  }
};

export const debugTimesheetData = (timesheet, raw, context = '') => {
  console.group(`📊 Timesheet Data Debug - ${context}`);
  
  console.log('Timesheet object:', {
    id: timesheet?.id,
    weekStart: timesheet?.weekStart,
    weekEnd: timesheet?.weekEnd,
    period: timesheet?.period
  });
  
  console.log('Raw object:', {
    start: raw?.start,
    end: raw?.end,
    userId: raw?.userId,
    entriesCount: raw?.entries?.length || 0
  });
  
  // Debug week ranges for different date sources
  if (timesheet?.weekStart) {
    debugTimesheetWeekRange(timesheet.weekStart, 'timesheet.weekStart');
  }
  
  if (raw?.start) {
    debugTimesheetWeekRange(raw.start, 'raw.start');
  }
  
  if (timesheet?.id && timesheet.id.includes('_')) {
    const [startFromId] = timesheet.id.split('_');
    debugTimesheetWeekRange(startFromId, 'timesheet.id start');
  }
  
  console.groupEnd();
};