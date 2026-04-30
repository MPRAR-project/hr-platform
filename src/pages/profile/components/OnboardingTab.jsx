import { useState } from "react";
import { Calendar, FileText, Upload, Briefcase, MapPin, Clock, Users, Edit2 } from "lucide-react";
import Badge from "../../../components/ui/Badge";
import Button from "../../../components/ui/Button";
import AddDocumentModal from "../../../components/modals/AddDocumentModal";
import EditOnboardingModal from "../../../components/modals/EditOnboardingModal";
import Loader from "../../../components/ui/Loader";
import { useAuth } from "../../../hooks/useAuth";

export const OnboardingTab = ({ onboardingData, isLoading, onUpdate }) => {
  const { user } = useAuth();
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const handleDocumentUpload = (docData) => {
    console.log('Document uploaded:', docData);
    // Handle document upload logic here
  };

  // Format date for display
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch {
      return dateString;
    }
  };

  // Extract data from onboardingData
  const employmentDetails = onboardingData?.employmentDetails || {};
  const documents = onboardingData?.documents || [];

  const displayData = {
    jobTitle: employmentDetails.jobTitle || 'N/A',
    employmentType: employmentDetails.employmentType || 'N/A',
    startDate: formatDate(employmentDetails.startDate),
    workLocation: employmentDetails.primaryWorkLocation || employmentDetails.workLocation || 'N/A',
    officeAddress: employmentDetails.officeAddress || 'N/A',
    workPattern: employmentDetails.workPattern || 'N/A',
    probationPeriod: employmentDetails.probationPeriod || 'N/A'
  };

  const handleSave = () => {
    if (onUpdate) {
      onUpdate();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader variant="pulse" size="md" text="Fetching onboarding data..." />
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-base shadow-lg p-4 space-y-4xl">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-text-primary">Onboarding Details</h2>
          <Button 
            icon={Edit2} 
            iconFirst={true} 
            variant="primary"
            onClick={() => setShowEditModal(true)}
          >
            Edit Details
          </Button>
        </div>

        <div className="bg-white grid grid-cols-1 lg:grid-cols-2 gap-4xl">
          {/* Position Details Card */}
          <div className="border border-border-primary rounded-base p-4xl">
            <div className="flex items-center gap-md mb-3xl">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
                <Briefcase className="h-5 w-5 text-text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Position Details</h3>
            </div>

            <div className="space-y-lg">
              <div className="flex justify-between">
                <span className="text-text-secondary">Job Title</span>
                <span className="text-text-primary font-medium">{displayData.jobTitle}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Employment Type</span>
                <span className="text-text-primary font-medium">{displayData.employmentType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Start Date</span>
                <span className="text-text-primary font-medium">{displayData.startDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Probation Period</span>
                <span className="text-text-primary font-medium">{displayData.probationPeriod}</span>
              </div>
            </div>
          </div>

          {/* Work Location Card */}
          <div className="border border-border-primary rounded-base p-4xl">
            <div className="flex items-center gap-md mb-3xl">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
                <MapPin className="h-5 w-5 text-text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Work Location</h3>
            </div>

            <div className="space-y-lg">
              <div className="flex justify-between">
                <span className="text-text-secondary">Primary Location</span>
                <span className="text-text-primary font-medium">{displayData.workLocation}</span>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-text-secondary">Office Address</span>
                <span className="text-text-primary font-medium text-right">{displayData.officeAddress}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Work Pattern</span>
                <span className="text-text-primary font-medium">{displayData.workPattern}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Contract Documents Section */}
        <div className="bg-white border border-border-primary rounded-base p-4xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-md">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
                <FileText className="h-5 w-5 text-text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Contract Documents</h3>
            </div>
            <Button 
              variant="outline-primary" 
              icon={Upload}
              onClick={() => setShowUploadModal(true)}
            >
              Upload Document
            </Button>
          </div>

          {/* Documents List */}
          <div className="space-y-3">
            {documents.length > 0 ? (
              documents.map((doc, index) => (
                <div key={doc.id || index} className="p-4 border border-border-secondary rounded-lg hover:bg-bg-secondary transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-text-primary">{doc.name || doc.title || 'Document'}</p>
                        <p className="text-sm text-text-secondary">{doc.description || doc.type || ''}</p>
                        {doc.uploadDate && (
                          <p className="text-xs text-text-secondary mt-1">Uploaded: {formatDate(doc.uploadDate)}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      {doc.category && <Badge variant="success">{doc.category}</Badge>}
                      <Button variant="outline-primary" cn="text-sm">
                        View
                      </Button>
                      <Button variant="outline-danger" cn="text-sm">
                        Remove
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-text-secondary text-center py-4">No documents uploaded yet</p>
            )}
          </div>
        </div>
      </div>

      {/* Add Document Modal */}
      <AddDocumentModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        employee={{ name: 'Current User' }}
        onUpload={handleDocumentUpload}
      />

      {/* Edit Onboarding Modal */}
      <EditOnboardingModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        userId={user?.uid || onboardingData?.userId}
        currentData={employmentDetails}
        onSave={handleSave}
      />
    </>
  );
};