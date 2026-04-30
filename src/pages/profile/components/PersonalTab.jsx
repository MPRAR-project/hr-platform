import { useState, useEffect } from "react";
import { Pencil, Phone, User, Sun, Moon, Briefcase, MapPin, FileText, Upload, Edit2 } from "lucide-react";
import Button from "../../../components/ui/Button";
import Badge from "../../../components/ui/Badge";
import { useAuth } from "../../../hooks/useAuth";
import { getUserShift, updateUserShift, SHIFT_TYPES, formatShiftName } from "../../../services/shiftService";
import { toast } from "react-toastify";
import EditPersonalInformationModal from "../../../components/modals/EditPersonalInformationModal";
import EditOnboardingModal from "../../../components/modals/EditOnboardingModal";
import AddDocumentModal from "../../../components/modals/AddDocumentModal";
import Loader from "../../../components/ui/Loader";

// Personal Information Tab Component
export const PersonalTab = ({ data = { basic: {}, identification: {} }, isLoading = false, onUpdate, onboardingData, isLoadingOnboarding, onUpdateOnboarding }) => {
  const { user } = useAuth();
  const [currentShift, setCurrentShift] = useState(SHIFT_TYPES.DAY);
  const [isUpdatingShift, setIsUpdatingShift] = useState(false);
  const [isLoadingShift, setIsLoadingShift] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditOnboardingModal, setShowEditOnboardingModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  // Load user's shift preference
  useEffect(() => {
    const loadShift = async () => {
      if (!user?.uid) {
        setIsLoadingShift(false);
        return;
      }
      try {
        setIsLoadingShift(true);
        const shift = await getUserShift(user.userId);
        setCurrentShift(shift);
      } catch (error) {
        console.error('Error loading shift:', error);
        toast.error('Failed to load shift preference');
      } finally {
        setIsLoadingShift(false);
      }
    };
    loadShift();
  }, [user?.uid]);

  const handleShiftChange = async (newShift) => {
    if (!user?.uid) {
      toast.error('User not found');
      return;
    }
    if (newShift === currentShift) return;

    try {
      setIsUpdatingShift(true);
      await updateUserShift(user.userId, newShift);
      setCurrentShift(newShift);
      toast.success(`Shift updated to ${formatShiftName(newShift)}`);
    } catch (error) {
      console.error('Error updating shift:', error);
      toast.error('Failed to update shift preference');
    } finally {
      setIsUpdatingShift(false);
    }
  };

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

  const handleOnboardingSave = () => {
    if (onUpdateOnboarding) {
      onUpdateOnboarding();
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-base shadow-lg p-4 flex items-center justify-center h-40">
        <Loader variant="pulse" size="md" text="Fetching employee data..." />
      </div>
    );
  }
  return (
    <div className="bg-white rounded-base shadow-lg p-6 ">
      <div className="space-y-4xl">

        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-text-primary">Personal Information</h2>
          <Button
            icon={Pencil}
            iconFirst={true}
            variant="primary"
            onClick={() => setShowEditModal(true)}
          >
            Edit Details
          </Button>
        </div>

        <div className="bg-white grid grid-cols-1 lg:grid-cols-2 gap-4xl">
          {/* Basic Information Card */}
          <div className="border border-border-primary rounded-base p-4xl">
            <div className="flex items-center gap-md mb-3xl">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
                <User className="h-5 w-5 text-text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Basic Information</h3>
            </div>

            <div className="space-y-lg">
              {Object.entries(data.basic || {}).map(([label, value]) => (
                <div key={label} className="flex justify-between items-start">
                  <span className="text-text-secondary">{label}</span>
                  <span className="text-text-primary font-medium text-right">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Identification & Compliance Card */}
          <div className="bg-white border border-border-primary rounded-base p-4xl">
            <div className="flex items-center gap-md mb-3xl">
              <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
                <Phone className="h-5 w-5 text-text-accent-purple" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary">Identification & Compliance</h3>
            </div>

            <div className="space-y-lg">
              {Object.entries(data.identification || {}).map(([label, value]) => (
                <div key={label} className="flex justify-between items-start">
                  <span className="text-text-secondary">{label}</span>
                  <span className="text-text-primary font-medium text-right">{value || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>


        {/* Onboarding Details Section */}
        {onboardingData && (
          <>
            {/* <div className="flex justify-between items-center mt-6">
            <h2 className="text-2xl font-bold text-text-primary">Position Details</h2>
            <Button
              icon={Edit2}
              iconFirst={true}
              variant="primary"
              onClick={() => setShowEditOnboardingModal(true)}
            >
              Edit Details
            </Button>
          </div> */}

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
                    <span className="text-text-primary font-medium">{onboardingData?.stepData?.employment?.jobTitle || onboardingData?.employmentDetails?.jobTitle || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Employment Type</span>
                    <span className="text-text-primary font-medium">{onboardingData?.stepData?.employment?.employmentType || onboardingData?.employmentDetails?.employmentType || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Start Date</span>
                    <span className="text-text-primary font-medium">{formatDate(onboardingData?.stepData?.employment?.startDate || onboardingData?.employmentDetails?.startDate)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Probation Period</span>
                    <span className="text-text-primary font-medium">{onboardingData?.stepData?.employment?.probationPeriod || onboardingData?.employmentDetails?.probationPeriod || 'N/A'}</span>
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
                    <span className="text-text-primary font-medium">{onboardingData?.stepData?.employment?.primaryWorkLocation || onboardingData?.stepData?.employment?.workLocation || onboardingData?.employmentDetails?.primaryWorkLocation || onboardingData?.employmentDetails?.workLocation || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-start">
                    <span className="text-text-secondary">Office Address</span>
                    <span className="text-text-primary font-medium text-right">{onboardingData?.stepData?.employment?.officeAddress || onboardingData?.employmentDetails?.officeAddress || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Work Pattern</span>
                    <span className="text-text-primary font-medium">{onboardingData?.stepData?.employment?.workPattern || onboardingData?.employmentDetails?.workPattern || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Shift Selection Card */}
        <div className="bg-white border border-border-primary rounded-base p-4xl">
          <div className="flex items-center gap-md mb-3xl">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              {currentShift === SHIFT_TYPES.NIGHT ? (
                <Moon className="h-5 w-5 text-text-accent-purple" />
              ) : (
                <Sun className="h-5 w-5 text-text-accent-purple" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-text-primary">Shift</h3>
          </div>

          {isLoadingShift ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary mb-4">
                Select your current shift. The system will prompt you if it detects a shift change based on your clock-in time.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => handleShiftChange(SHIFT_TYPES.DAY)}
                  disabled={isUpdatingShift}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${currentShift === SHIFT_TYPES.DAY
                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-purple-400'
                    } ${isUpdatingShift ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Sun className="h-5 w-5" />
                  <span className="font-medium">Day Shift</span>
                  {currentShift === SHIFT_TYPES.DAY && (
                    <span className="ml-auto text-purple-600">✓</span>
                  )}
                </button>
                <button
                  onClick={() => handleShiftChange(SHIFT_TYPES.NIGHT)}
                  disabled={isUpdatingShift}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${currentShift === SHIFT_TYPES.NIGHT
                    ? 'border-purple-600 bg-purple-50 text-purple-700'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-purple-400'
                    } ${isUpdatingShift ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Moon className="h-5 w-5" />
                  <span className="font-medium">Night Shift</span>
                  {currentShift === SHIFT_TYPES.NIGHT && (
                    <span className="ml-auto text-purple-600">✓</span>
                  )}
                </button>
              </div>
              {isUpdatingShift && (
                <p className="text-xs text-text-secondary text-center">Updating shift...</p>
              )}
            </div>
          )}
        </div>

        {onboardingData && (
          <>
            {/* Contract Documents Section */}
            {/* <div className="bg-white border border-border-primary rounded-base p-4xl">
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

            
            <div className="space-y-3">
              {onboardingData?.documents?.length > 0 ? (
                onboardingData.documents.map((doc, index) => (
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
          </div> */}
          </>
        )}
      </div>

      <EditPersonalInformationModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        userId={user?.uid}
        currentData={data}
        onSave={(updatedData) => {
          if (onUpdate) {
            onUpdate(updatedData);
          }
        }}
      />

      {/* Edit Onboarding Modal */}
      {
        onboardingData && (
          <EditOnboardingModal
            isOpen={showEditOnboardingModal}
            onClose={() => setShowEditOnboardingModal(false)}
            userId={user?.uid || onboardingData?.userId}
            currentData={onboardingData?.employmentDetails}
            onSave={handleOnboardingSave}
          />
        )
      }

      {/* Add Document Modal */}
      {
        onboardingData && (
          <AddDocumentModal
            isOpen={showUploadModal}
            onClose={() => setShowUploadModal(false)}
            employee={{ name: data.basic?.['Full Name'] || user?.displayName || user?.email || 'Current User' }}
            onUpload={handleDocumentUpload}
          />
        )
      }
    </div >
  );
};