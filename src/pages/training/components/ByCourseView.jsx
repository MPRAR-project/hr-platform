import { User, CheckCircle } from 'lucide-react';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';

const ByCourseView = ({ courses, onSendReminder }) => {
  const getStatusVariant = (status) => {
    switch(status) {
      case 'Valid': return 'success';
      case 'Expired': return 'danger';
      case 'Missing': return 'danger';
      case 'Pending': return 'warning';
      default: return 'info';
    }
  };

  return (
    <div className="space-y-6">
      {courses.map((course) => (
        <div key={course.id} className="bg-white border border-border-accent-purple rounded-lg shadow-sm">
          {/* Course Header */}
          <div className="p-4 md:p-6 border-b border-border-accent-purple">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-xl font-bold text-text-primary mb-2">{course.name}</h3>
                <p className="text-sm text-text-secondary">
                  {course.employeesCount} Employees • {course.complianceRate}% Compliance Rate
                </p>
              </div>
              <p className="text-sm text-text-secondary">
                Expires: {course.expiryDate}
              </p>
            </div>
          </div>

          {/* Employee List */}
          <div className="divide-y divide-border-secondary">
            {course.employees.map((employee) => (
              <div key={employee.id} className="p-4 md:p-6 hover:bg-background-secondary transition-colors last:rounded-b-lg">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  {/* Employee Info */}
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-background-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                      <User className="h-5 w-5 text-text-accent-purple" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 mb-1 flex-wrap">
                        <h4 className="font-semibold text-text-primary">{employee.name}</h4>
                        <Badge variant={employee.role === 'Team Manager' ? 'role' : 'info'}>
                          {employee.role}
                        </Badge>
                      </div>
                      <p className="text-sm text-text-secondary">
                        Completed: {employee.completedDate} | Expires: {employee.expiryDate}
                      </p>
                    </div>
                  </div>

                  {/* Status and Action */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant={getStatusVariant(employee.status)}>
                      {employee.status}
                    </Badge>
                    <Button 
                      variant="outline-primary"
                      onClick={() => onSendReminder(employee.id, course.id)}
                    >
                      Send Reminder
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ByCourseView;