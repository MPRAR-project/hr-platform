import React, { useState } from 'react';
import { Search, User, Briefcase, Calendar, FileText, CheckCircle, AlertTriangle } from 'lucide-react';
import Header from '../../components/layout/Header';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

const DocumentsListPage = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [filterDepartment, setFilterDepartment] = useState('All Departments');
    const navigate = useNavigate();
    const {user} = useAuth();

    const employees = [
        {
            id: 1,
            name: 'Sarah Johnson',
            email: 'Sarah@Company.Com',
            role: 'Employee',
            department: 'Development',
            hireDate: '2022-03-15',
            totalDocuments: 8,
            approvedReviews: 6,
            pendingReviews: 2
        },
        {
            id: 2,
            name: 'Sarah Johnson',
            email: 'Sarah@Company.Com',
            role: 'Manager',
            department: 'Development',
            hireDate: '2022-03-15',
            totalDocuments: 8,
            approvedReviews: 6,
            pendingReviews: 2
        },
        {
            id: 3,
            name: 'Sarah Johnson',
            email: 'Sarah@Company.Com',
            role: 'Employee',
            department: 'Development',
            hireDate: '2022-03-15',
            totalDocuments: 8,
            approvedReviews: 6,
            pendingReviews: 2
        },
        {
            id: 4,
            name: 'Sarah Johnson',
            email: 'Sarah@Company.Com',
            role: 'Employee',
            department: 'Development',
            hireDate: '2022-03-15',
            totalDocuments: 8,
            approvedReviews: 6,
            pendingReviews: 2
        },
        {
            id: 5,
            name: 'Sarah Johnson',
            email: 'Sarah@Company.Com',
            role: 'Employee',
            department: 'Development',
            hireDate: '2022-03-15',
            totalDocuments: 8,
            approvedReviews: 6,
            pendingReviews: 2
        },
        {
            id: 6,
            name: 'Sarah Johnson',
            email: 'Sarah@Company.Com',
            role: 'Employee',
            department: 'Development',
            hireDate: '2022-03-15',
            totalDocuments: 8,
            approvedReviews: 6,
            pendingReviews: 2
        }
    ];

    const handleViewDocuments = (employeeId) => {
        navigate(`/documents/${employeeId}`);
        // Or with React Router: navigate(`/documents/${employeeId}`);
    };
    const pretty = (role) =>
        role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

    return (
        <div className="h-screen flex flex-col overflow-hidden">
            <Header
                title={`${pretty(user.role)} Dashboard`}

                subtitle="Grow your digital workplace and manage your team seamlessly"
            />

            <div className="flex-1 overflow-y-auto p-4 md:p-3xl scrollbar-custom">
                <div className="max-w-7xl mx-auto space-y-6">
                    {/* Search and Filter */}
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="relative w-full sm:w-96">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-text-secondary" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="search by name or phone or email..."
                                className="w-full h-12 pl-12 pr-4 border border-border-secondary rounded-full text-sm placeholder:text-text-secondary focus:outline-none focus:border-border-accent-purple"
                            />
                        </div>

                        <div className="flex items-center gap-3">
                            <span className="text-sm text-text-secondary">Filtered by:</span>
                            <select
                                value={filterDepartment}
                                onChange={(e) => setFilterDepartment(e.target.value)}
                                className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                            >
                                <option>All Departments</option>
                                <option>Development</option>
                                <option>HR</option>
                                <option>Sales</option>
                            </select>
                        </div>
                    </div>

                    {/* Employee Cards */}
                    <div className="space-y-4">
                        {employees.map((employee) => (
                            <div key={employee.id} className="bg-white border border-border-accent-purple-alt rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex flex-col lg:flex-row justify-between items-start lg:items-start gap-6">
                                    {/* Employee Info */}
                                    <div className="flex items-center gap-4 w-full">
                                        <div className="w-12 h-12 bg-bg-accent-purple-light rounded-full flex items-center justify-center flex-shrink-0">
                                            <User className="h-6 w-6 text-text-accent-purple" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h3 className="text-lg font-semibold text-text-primary">{employee.name}</h3>
                                                <Badge variant={employee.role === 'Manager' ? 'role' : 'info'}>
                                                    {employee.role}
                                                </Badge>
                                            </div>
                                            <p className="text-sm text-text-secondary mb-2">{employee.email}</p>
                                            <div className="flex flex-wrap items-center gap-4 text-sm">
                                                <span className="flex items-center gap-1 text-purple-500">
                                                    <Briefcase className="h-3 w-3" />
                                                    {employee.department}
                                                </span>
                                                <span className="flex items-center gap-1 text-blue-500">
                                                    <Calendar className="h-3 w-3" />
                                                    Hired: {employee.hireDate}
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="flex sm:flex-row flex-wrap sm:justify-end justify-center w-full items-center gap-8">
                                        <div className="text-center">
                                            <div className="flex items-center justify-center gap-2 mb-1">
                                                <FileText className="h-5 w-5 text-blue-500" />
                                                <p className="text-3xl font-bold text-blue-500">{employee.totalDocuments}</p>
                                            </div>
                                            <p className="text-xs text-text-secondary">Total<br />Documents</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="flex items-center justify-center gap-2 mb-1">
                                                <CheckCircle className="h-5 w-5 text-green-500" />
                                                <p className="text-3xl font-bold text-green-500">{employee.approvedReviews}</p>
                                            </div>
                                            <p className="text-xs text-text-secondary">Approved<br />review</p>
                                        </div>
                                        <div className="text-center">
                                            <div className="flex items-center justify-center gap-2 mb-1">
                                                <AlertTriangle className="h-5 w-5 text-orange-500" />
                                                <p className="text-3xl font-bold text-orange-500">{employee.pendingReviews}</p>
                                            </div>
                                            <p className="text-xs text-text-secondary">Pending<br />Review</p>
                                        </div>
                                        <Button
                                            variant="outline-primary"
                                            onClick={() => handleViewDocuments(employee.id)}
                                            cn='sm:max-w-36 w-full'
                                        >
                                            View Documents
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DocumentsListPage;