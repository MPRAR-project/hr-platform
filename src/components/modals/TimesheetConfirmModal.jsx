import { ArrowRight, X } from "lucide-react";
import Button from "../ui/Button";

const TimesheetConfirmModal = ({ isOpen, onClose, onSubmit }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto scrollbar-custom">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Confirm Timesheet Submission</h2>
            <p className="text-sm text-gray-600 mt-1">Please review your timesheet for the week of Sep 8 - Sep 14 before submitting for approval.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full hover:bg-gray-200 transition-colors">
            <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-purple-50 border-2 border-purple-300 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-purple-900 mb-1">30h</div>
            <div className="text-sm text-purple-700">Total Time</div>
          </div>
          <div className="bg-purple-50 border-2 border-purple-300 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-purple-900 mb-1">4</div>
            <div className="text-sm text-purple-700">Days Logged</div>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-orange-900 mb-1">Important:</p>
          <p className="text-sm text-orange-800">Once submitted, your timesheet cannot be modified unless Declined by admin. Please ensure all information is accurate.</p>
        </div>

        <div className="mb-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Daily Breakdown</h3>
          <div className="space-y-3">
            {[
              { day: 'Monday (Sep 9)', hours: 'No Entry', border: 'border-gray-200' },
              { day: 'Tuesday (Sep 10)', hours: '7h', border: 'border-purple-300 bg-purple-50' },
              { day: 'Wednesday (Sep 11)', hours: '6h', border: 'border-purple-300 bg-purple-50' },
              { day: 'Thursday (Sep 12)', hours: '8h', border: 'border-purple-300 bg-purple-50' },
              { day: 'Friday (Sep 13)', hours: 'No Entry', border: 'border-gray-200' },
              { day: 'Saturday (Sep 14)', hours: '9h', border: 'border-purple-300 bg-purple-50' },
              { day: 'Sunday (Sep 15)', hours: 'No Entry', border: 'border-gray-200' }
            ].map((entry, idx) => (
              <div key={idx} className={`flex items-center justify-between p-3 border-2 ${entry.border} rounded-lg`}>
                <span className="text-sm font-medium text-gray-900">{entry.day}</span>
                <span className={`text-sm ${entry.hours === 'No Entry' ? 'text-gray-500' : 'font-bold text-purple-600'}`}>
                  {entry.hours}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
          <p className="text-sm font-medium text-gray-900 mb-3">By clicking "Confirm Submission", you acknowledge that:</p>
          <ul className="space-y-2 text-sm text-gray-700">
            <li>• All information provided is accurate and complete</li>
            <li>• You've reviewed all daily entries and supporting documents</li>
            <li>• This timesheet will be sent to admin for approval</li>
            <li>• Changes can only be made if the timesheet is Declined</li>
          </ul>
        </div>

        <div className="grid grid-cols-3  gap-4">
          <Button
            onClick={onClose}
            cn="h-12 col-span-1"
            variant="outline-secondary"
          >
            Back
          </Button>
          <Button
            onClick={onSubmit}
            variant="gradient"
            cn="h-12 col-span-2"
            icon={ArrowRight}
          >
            <span>Submit</span>
           
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TimesheetConfirmModal;