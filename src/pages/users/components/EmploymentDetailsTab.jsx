import { Briefcase, Calendar, DollarSign, FileText, Landmark, Pencil, PoundSterling, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import Button from "../../../components/ui/Button";
import EditOnboardingModal from "../../../components/modals/EditOnboardingModal";
import { useState } from "react";

const EmploymentDetails = ({ data, loading = false, error = null, onRetry = null, userId, currentEmploymentData, onUpdate }) => {
  const [showEditModal, setShowEditModal] = useState(false);
  // Show loading state
  if (loading) {
    return (
      <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
        <div className="flex justify-between items-center">
          <h3 className="text-2xl font-bold text-text-primary">Employment Details</h3>
          <Button icon={Pencil} iconFirst={true} variant="gradient" disabled onClick={() => setShowEditModal(true)}>Edit Details</Button>
        </div>

        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="h-12 w-12 text-purple-500 mb-4 animate-spin" />
          <h4 className="text-lg font-semibold text-gray-600 mb-2">Loading Employment Details</h4>
          <p className="text-sm text-gray-500">Please wait while we fetch the employment information...</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
        <div className="flex justify-between items-center">
          <h3 className="text-2xl font-bold text-text-primary">Employment Details</h3>
          <Button icon={Pencil} iconFirst={true} variant="gradient" onClick={() => setShowEditModal(true)}>Edit Details</Button>
        </div>

        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
          <h4 className="text-lg font-semibold text-red-600 mb-2">Failed to Load Employment Details</h4>
          <p className="text-sm text-gray-500 max-w-md mb-4">{error}</p>
          {onRetry && (
            <Button
              onClick={onRetry}
              icon={RefreshCw}
              iconFirst={true}
              variant="outline-secondary"
              className="mt-2"
            >
              Try Again
            </Button>
          )}
        </div>
        {editModal}
      </div>
    );
  }

  // Check if employment data is available
  const hasEmploymentData = data && (
    Object.values(data.position || {}).some(value => value && value !== 'Not specified') ||
    Object.values(data.terms || {}).some(value => value && value !== 'Not specified') ||
    Object.values(data.compensation || {}).some(value => value && value !== 'Not specified')
  );

  const editModal = userId && (
    <EditOnboardingModal
      isOpen={showEditModal}
      onClose={() => setShowEditModal(false)}
      userId={userId}
      currentData={currentEmploymentData}
      onSave={() => {
        if (onUpdate) {
          onUpdate();
        }
        setShowEditModal(false);
      }}
    />
  );

  // Show message if no employment data is available
  if (!hasEmploymentData) {
    return (
      <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
        <div className="flex justify-between items-center">
          <h3 className="text-2xl font-bold text-text-primary">Employment Details</h3>
          <Button icon={Pencil} iconFirst={true} variant="gradient" onClick={() => setShowEditModal(true)}>Edit Details</Button>
        </div>

        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle className="h-12 w-12 text-gray-400 mb-4" />
          <h4 className="text-lg font-semibold text-gray-600 mb-2">Employment Information Not Available</h4>
          <p className="text-sm text-gray-500 max-w-md">
            Employment details have not been configured for this employee.
            Complete the onboarding process or contact HR to add employment information.
          </p>
        </div>
        {editModal}
      </div>
    );
  }

  return (
    <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
      <div className="flex justify-between items-center">
        <h3 className="text-2xl font-bold text-text-primary">Employment Details</h3>
        <Button icon={Pencil} iconFirst={true} variant="gradient" onClick={() => setShowEditModal(true)}>Edit Details</Button>
      </div>

      {editModal}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border-secondary rounded-base p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <Briefcase className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Position Details</h4>
          </div>

          <div className="space-y-3">
            {Object.entries(data.position || {}).map(([key, value]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-2 border-b border-border-secondary last:border-0">
                <span className="text-sm text-text-secondary mb-1 sm:mb-0">{key}</span>
                <span className="text-sm font-semibold text-text-primary sm:text-right">
                  {value || 'Not specified'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border-secondary rounded-base p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <Calendar className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Employment Terms</h4>
          </div>

          <div className="space-y-3">
            {Object.entries(data.terms || {}).map(([key, value]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-2 border-b border-border-secondary last:border-0">
                <span className="text-sm text-text-secondary mb-1 sm:mb-0">{key}</span>
                <span className="text-sm font-semibold text-text-primary sm:text-right">
                  {value || 'Not specified'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border-secondary rounded-base p-4 sm:p-6 space-y-4 lg:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <Landmark className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Bank Details</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            {Object.entries(data?.bank || {}).map(([key, value]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:justify-between sm:items-center py-2 border-b border-border-secondary last:border-0">
                <span className="text-sm text-text-secondary mb-1 sm:mb-0">{key}</span>
                <span className="text-sm font-semibold text-text-primary sm:text-right">
                  {value || 'Not specified'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border-secondary rounded-base p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <PoundSterling className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Compensation</h4>
          </div>

          <div className="space-y-3">
            {Object.entries(data.compensation || {}).map(([key, value]) => (
              <div key={key} className="flex flex-col sm:flex-row sm:justify-between sm:items-start py-2 border-b border-border-secondary last:border-0">
                <span className="text-sm text-text-secondary mb-1 sm:mb-0">
                  {key === 'hourlyRate' ? 'Hourly Rate' : key === 'chargeRate' ? 'Charge Rate' : key}
                </span>
                <span className="text-sm font-semibold text-text-primary sm:text-right">
                  {key === 'hourlyRate' || key === 'chargeRate'
                    ? `£${parseFloat(value || 0).toFixed(2)}`
                    : value || 'Not specified'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-border-secondary rounded-base p-4 sm:p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <FileText className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Additional Notes</h4>
          </div>

          <div className="py-2">
            <span className="text-sm text-text-secondary mb-2 block">Notes</span>
            <p className="text-sm font-semibold text-text-primary">
              {data.notes || 'No additional notes available'}
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};
export default EmploymentDetails;