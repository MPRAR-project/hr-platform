import Badge from "../../../components/ui/Badge";
import { Briefcase, Calendar, CreditCard, User } from "lucide-react";
import { useAuth } from "../../../hooks/useAuth";
import ProfilePictureUpload from "../../profile/components/ProfilePictureUpload";
const EmployeeHeader = ({ employee, onPhotoUpdate, canEditPhoto = false }) => {
  const { user } = useAuth();
  
  return (
    <div className="bg-bg-accent-purple-light border-2 border-border-accent-purple rounded-base p-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-center gap-xl">
        {/* Profile Picture - Editable or Read-only based on permissions */}
        {canEditPhoto ? (
          <ProfilePictureUpload
            userId={employee?.id}
            currentPrifileImage={employee?.profileImage}
            userName={employee?.name}
            onPhotoUpdate={onPhotoUpdate}
          />
        ) : (
          <div className="flex-shrink-0">
            {employee?.profileImage ? (
              <img
                src={employee.profileImage}
                alt={employee?.name || 'Employee'}
                className="w-16 h-16 rounded-full object-cover border-2 border-border-accent-purple"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-white border-2 border-border-accent-purple flex items-center justify-center">
                <User className="h-8 w-8 text-text-accent-purple" />
              </div>
            )}
          </div>
        )}
        
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold text-text-primary">{employee?.name}</h2>
          <div className="flex flex-row flex-wrap items-center gap-4 text-sm">
            <span className="flex items-center gap-2 text-orange-500">
              <Briefcase className="h-4 w-4" />
              {employee?.department || 'N/A'}
            </span>
            <span className="flex items-center gap-2 text-blue-500">
              <Calendar className="h-4 w-4" />
              Hired: {employee?.hireDate || 'N/A'}
            </span>
            <span className="flex items-center gap-2 text-green-500">
              <CreditCard className="h-4 w-4" />
              Employee ID: {employee?.employeeId || 'N/A'}
            </span>
          </div>
        </div>
      </div>
      <div className="flex w-full items-center justify-between gap-4">
        <div className="text-left">
          <p className="text-sm text-text-secondary">Manager:</p>
          <p className="text-md font-semibold text-text-accent-purple">{employee?.manager || 'N/A'}</p>
        </div>
        <Badge variant="info">{employee?.role || 'Employee'}</Badge>
      </div>
    </div>
  );
};

export default EmployeeHeader;