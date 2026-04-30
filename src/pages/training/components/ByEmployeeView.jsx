import { User, Briefcase, Calendar } from 'lucide-react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';

const ByEmployeeView = ({ employees, onViewTraining }) => {
  return (
    <div className="space-y-4">
      {employees.map((employee) => (
        <div key={employee.id} className="bg-white border border-border-accent-purple rounded-lg p-4 md:p-6 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
            {/* Employee Info */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="w-12 h-12 bg-background-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                <User className="h-6 w-6 text-text-accent-purple" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h3 className="text-lg font-semibold text-text-primary">{employee.name}</h3>
                  <Badge variant="info">{employee.role}</Badge>
                </div>
                <p className="text-sm text-text-secondary mb-2 truncate">{employee.email}</p>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-purple-500">
                    <Briefcase className="h-3 w-3 flex-shrink-0" />
                    {employee.department}
                  </span>
                  <span className="flex items-center gap-1 text-blue-500">
                    <Calendar className="h-3 w-3 flex-shrink-0" />
                    Hired: {employee.hireDate}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats and Button */}
            <div className="flex items-center gap-4 md:gap-6 lg:gap-8 flex-wrap w-full lg:w-auto">
              <div className="text-center min-w-[60px]">
                <p className="text-2xl md:text-3xl font-bold text-blue-500">{employee.totalTrainings}</p>
                <p className="text-xs text-text-secondary mt-1">Total</p>
              </div>
              <div className="text-center min-w-[60px]">
                <p className="text-2xl md:text-3xl font-bold text-green-500">{employee.completed}</p>
                <p className="text-xs text-text-secondary mt-1">Completed</p>
              </div>
              <div className="text-center min-w-[60px]">
                <p className="text-2xl md:text-3xl font-bold text-orange-500">{employee.pending}</p>
                <p className="text-xs text-text-secondary mt-1">Pending</p>
              </div>
              <div className="text-center min-w-[60px]">
                <p className="text-2xl md:text-3xl font-bold text-red-500">{employee.expired}</p>
                <p className="text-xs text-text-secondary mt-1">Expired</p>
              </div>
              <Button 
                variant="outline-primary" 
                onClick={() => onViewTraining(employee.id)}
                className="w-full sm:w-auto"
              >
                View Training
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ByEmployeeView;