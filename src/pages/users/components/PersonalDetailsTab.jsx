import { useState } from "react";
import { Landmark, Pencil, Phone, User } from "lucide-react";
import Button from "../../../components/ui/Button";
import EditPersonalInformationModal from "../../../components/modals/EditPersonalInformationModal";

const PersonalInformationTab = ({ data, userId, onUpdate }) => {
  const [showEditModal, setShowEditModal] = useState(false);

  return (
    <>
      <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
        <div className="flex justify-between items-center">
          <h3 className="text-2xl font-bold text-text-primary">Personal Information</h3>
          <Button 
            icon={Pencil} 
            iconFirst={true} 
            variant="gradient"
            onClick={() => setShowEditModal(true)}
          >
            Edit Details
          </Button>
        </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border border-border-secondary rounded-base p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <User className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Basic Information</h4>
          </div>

          {Object.entries(data.basic).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center py-2 border-b border-border-secondary last:border-0">
              <span className="text-sm text-text-secondary">{key}</span>
              <span className="text-sm font-semibold text-text-primary text-right">{value}</span>
            </div>
          ))}
        </div>

        <div className="border border-border-secondary rounded-base p-6 space-y-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-bg-accent-purple-light rounded-full flex items-center justify-center">
              <Phone className="h-5 w-5 text-text-accent-purple" />
            </div>
            <h4 className="text-lg font-semibold text-text-primary">Identification & Compliance</h4>
          </div>

          {Object.entries(data.identification).map(([key, value]) => (
            <div key={key} className="flex justify-between items-center py-2 border-b border-border-secondary last:border-0">
              <span className="text-sm text-text-secondary">{key}</span>
              <span className="text-sm font-semibold text-text-primary text-right">{value}</span>
            </div>
          ))}
        </div>

      </div>
      </div>

      <EditPersonalInformationModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        userId={userId}
        currentData={data}
        onSave={() => {
          if (onUpdate) {
            onUpdate();
          }
        }}
      />
    </>
  );
};
export default PersonalInformationTab;