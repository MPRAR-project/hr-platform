import EditAllowanceModal from "../../../components/modals/EditAllowanceModal";
import CreateAllowanceModal from "../../../components/modals/CreateAllowanceModal";
import Button from "../../../components/ui/Button";
import { useState, useEffect } from "react";
import { Briefcase, Calendar, Heart, Users, Plus } from "lucide-react";
import { allowanceService } from "../../../services/allowanceService";
import { useAuth } from "../../../hooks/useAuth";
import { toast } from 'react-toastify';

const AllowancesTab = ({ allowances = [], year: initialYear, employee, onAllowanceUpdate }) => {
    const { user } = useAuth();
    const [EditAllowanceModalOpen, setEditAllowanceModalOpen] = useState(false);
    const [CreateAllowanceModalOpen, setCreateAllowanceModalOpen] = useState(false);
    const [selectedAllowance, setSelectedAllowance] = useState(null);
    const [loading, setLoading] = useState(false);
    const [selectedYear, setSelectedYear] = useState(initialYear || new Date().getFullYear());

    // Define roles that can add allowances without approval
    const ALLOWANCE_CREATION_ROLES = [
        'siteManager',
        'seniorManager',
        'hrManager',
        'adminManager',
        'hrAdvisor',
        'adminAdvisor',
        'teamManager'
    ];

    // Check if current user can create allowances
    const canCreateAllowance = user && ALLOWANCE_CREATION_ROLES.includes(user.role);

    // Sync selectedYear when initialYear prop changes
    useEffect(() => {
        if (initialYear && initialYear !== selectedYear) {
            setSelectedYear(initialYear);
        }
    }, [initialYear]);

    const handleEdit = (allowance) => {
        setSelectedAllowance(allowance);
        setEditAllowanceModalOpen(true);
    }

    const handleSaveAllowance = async (allowanceId, updateData) => {
        try {
            setLoading(true);

            // If the allowance ID starts with 'virtual-', it means the document doesn't exist yet
            // in Firestore (it's generated on-the-fly from absence data).
            // In this case, we need to create a new allowance document.
            if (allowanceId && String(allowanceId).startsWith('virtual-')) {
                const employeeId = employee?.id || employee?.uid;

                // Map the virtual allowance to the format expected by createAllowances
                const newAllowance = {
                    type: selectedAllowance?.leaveType || selectedAllowance?.name,
                    totalDays: updateData.totalDays,
                    year: selectedYear,
                    validFrom: selectedAllowance?.validFrom,
                    validUntil: selectedAllowance?.validUntil
                };

                await allowanceService.createAllowances(employeeId, [newAllowance], user);
                toast.success('Allowance created and updated successfully');
            } else {
                // Update the existing allowance using the service
                await allowanceService.updateAllowance(allowanceId, updateData, user);
                toast.success('Allowance updated successfully');
            }

            // Close modal
            setEditAllowanceModalOpen(false);
            setSelectedAllowance(null);

            // Trigger parent component to refresh data
            if (onAllowanceUpdate) {
                onAllowanceUpdate();
            }
        } catch (error) {
            console.error('Error updating allowance:', error);
            toast.error(error.message || 'Failed to update allowance');
        } finally {
            setLoading(false);
        }
    }

    // Handle creating new allowance
    const handleCreateAllowance = async (newAllowances) => {
        try {
            setLoading(true);

            // Validate allowances
            const invalidAllowances = newAllowances.filter(
                allowance => !allowance.type || !allowance.totalDays
            );

            if (invalidAllowances.length > 0) {
                toast.error('Please fill in all required fields (Type and Total Days)');
                setLoading(false);
                return;
            }

            // Use the existing createAllowances method (plural)
            const employeeId = employee?.id || employee?.uid;

            await allowanceService.createAllowances(employeeId, newAllowances, user);

            toast.success('Allowance(s) added successfully');

            // Close modal
            setCreateAllowanceModalOpen(false);

            // Trigger parent component to refresh data
            if (onAllowanceUpdate) {
                onAllowanceUpdate();
            }
        } catch (error) {
            console.error('Error creating allowance:', error);
            toast.error(error.message || 'Failed to create allowance. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    // Get icon for leave type
    const getLeaveTypeIcon = (leaveType) => {
        switch (leaveType?.toLowerCase()) {
            case 'annual leave':
            case 'holiday':
                return <Calendar className="h-5 w-5 text-blue-600" />;
            case 'maternity leave':
            case 'paternity leave':
            case 'maternity/paternity':
                return <Heart className="h-5 w-5 text-pink-600" />;
            case 'sick leave':
                return <Users className="h-5 w-5 text-green-600" />;
            default:
                return <Briefcase className="h-5 w-5 text-purple-600" />;
        }
    };

    // Calculate usage percentage
    const getUsagePercentage = (used, total) => {
        if (total === 0) return 0;
        return Math.round((used / total) * 100);
    };

    // Check if allowance is overused
    const isOverused = (used, total) => {
        return used > total;
    };

    // Get overuse amount
    const getOveruseAmount = (used, total) => {
        return used > total ? used - total : 0;
    };

    // Transform allowance data for display
    // HIDE SICK LEAVE from admin view as well
    const transformedAllowances = allowances
        .filter(allowance => {
            const normalizedType = allowanceService.getLeaveTypeDisplayName(allowance.leaveType).toLowerCase();
            return !normalizedType.includes('sick') && !normalizedType.includes('sick leave');
        })
        .map(allowance => {
            const overused = isOverused(allowance.usedDays, allowance.totalDays);
            const overuseAmount = getOveruseAmount(allowance.usedDays, allowance.totalDays);

            return {
                id: allowance.id,
                name: allowance.leaveType,
                icon: getLeaveTypeIcon(allowance.leaveType),
                total: allowance.totalDays,
                used: allowance.usedDays,
                remaining: allowance.remainingDays,
                progress: getUsagePercentage(allowance.usedDays, allowance.totalDays),
                isOverused: overused,
                overuseAmount: overuseAmount,
                rawData: allowance // Keep original data for editing
            };
        });

    // Default allowances if none exist
    const defaultAllowances = [
        {
            id: 'default-annual',
            name: 'Annual Leave',
            icon: <Calendar className="h-5 w-5 text-blue-600" />,
            total: 25,
            used: 0,
            remaining: 25,
            progress: 0,
            isOverused: false,
            overuseAmount: 0
        },
        {
            id: 'default-maternity',
            name: 'Maternity/Paternity',
            icon: <Heart className="h-5 w-5 text-pink-600" />,
            total: 52,
            used: 0,
            remaining: 52,
            progress: 0,
            isOverused: false,
            overuseAmount: 0
        }
    ];

    const displayAllowances = transformedAllowances.length > 0 ? transformedAllowances : defaultAllowances;

    return (
        <>
            <div className="space-y-6 bg-white p-6 rounded-base shadow-lg">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <h3 className="text-2xl font-bold text-text-primary">Employee Allowances</h3>
                    <div className="flex items-center gap-3">
                        {/* Add Allowance Button - Only visible to authorized roles */}
                        {canCreateAllowance && (
                            <Button
                                variant="gradient"
                                icon={Plus}
                                iconFirst={false}
                                onClick={() => setCreateAllowanceModalOpen(true)}
                                cn="h-12"
                            >
                                Add Allowance
                            </Button>
                        )}

                        <label htmlFor="year-filter-select" className="text-sm text-text-secondary">Filtered by:</label>
                        <select
                            id="year-filter-select"
                            name="year"
                            value={selectedYear}
                            onChange={async (e) => {
                                const newYear = parseInt(e.target.value);
                                setSelectedYear(newYear);
                                setLoading(true);
                                try {
                                    // Fetch allowances for the selected year
                                    if (employee?.id && onAllowanceUpdate) {
                                        // Trigger parent to reload with new year
                                        await onAllowanceUpdate(newYear);
                                    }
                                } catch (error) {
                                    console.error('Error loading allowances for year:', error);
                                    toast.error('Failed to load allowances for selected year');
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            className="px-4 py-2 border border-border-secondary rounded-lg text-sm focus:outline-none focus:border-border-accent-purple"
                        >
                            {Array.from({ length: 5 }, (_, i) => {
                                const yearOption = new Date().getFullYear() - i;
                                return (
                                    <option key={yearOption} value={yearOption}>
                                        {yearOption}
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-12">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading allowances...</p>
                    </div>
                ) : displayAllowances.length === 0 ? (
                    <div className="text-center py-12">
                        <Briefcase className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">No allowances configured</h3>
                        <p className="text-gray-600 mb-4">
                            {canCreateAllowance
                                ? `Click 'Add Allowance' to create the first allowance for ${selectedYear}.`
                                : `Employee allowances will appear here once they are set up for ${selectedYear}.`}
                        </p>
                        {canCreateAllowance && (
                            <Button
                                variant="solid-primary"
                                icon={Plus}
                                iconFirst={true}
                                onClick={() => setCreateAllowanceModalOpen(true)}
                                cn="mx-auto"
                            >
                                Add First Allowance
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {displayAllowances.map((allowance, index) => (
                            <div key={index} className={`border rounded-base p-6 space-y-4 ${allowance.isOverused
                                ? 'border-red-300 bg-red-50/30'
                                : 'border-border-secondary'
                                }`}>
                                <div className="flex justify-between items-start">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${allowance.isOverused
                                            ? 'bg-red-100'
                                            : 'bg-pink-50'
                                            }`}>
                                            {allowance.icon}
                                        </div>
                                        <div>
                                            <h4 className="text-lg font-semibold text-text-primary">
                                                {allowanceService.getLeaveTypeDisplayName(allowance.name)}
                                            </h4>
                                            {allowance.isOverused && (
                                                <p className="text-sm text-red-600 font-medium">
                                                    Overused by {allowance.overuseAmount} days
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {/* Only show Edit button for real allowances (not default ones) and if user has permission */}
                                    {allowance.rawData && canCreateAllowance && (
                                        <Button variant="outline-primary" onClick={() => handleEdit(allowance.rawData)}>
                                            Edit
                                        </Button>
                                    )}
                                </div>

                                <div className="grid grid-cols-3 gap-4 text-center">
                                    <div>
                                        <p className="text-xs text-text-secondary mb-1">Total Allowance</p>
                                        <p className="text-2xl font-bold text-text-primary">{allowance.total}</p>
                                        <p className="text-xs text-text-secondary">Days</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-text-secondary mb-1">Used</p>
                                        <p className={`text-2xl font-bold ${allowance.isOverused ? 'text-red-600' : 'text-red-500'
                                            }`}>{allowance.used}</p>
                                        <p className="text-xs text-text-secondary">Days</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-text-secondary mb-1">
                                            {allowance.isOverused ? 'Overused' : 'Remaining'}
                                        </p>
                                        <p className={`text-2xl font-bold ${allowance.isOverused
                                            ? 'text-red-600'
                                            : 'text-green-500'
                                            }`}>
                                            {allowance.isOverused
                                                ? allowance.overuseAmount
                                                : allowance.remaining
                                            }
                                        </p>
                                        <p className="text-xs text-text-secondary">Days</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-text-secondary">
                                            {allowance.isOverused ? 'Overuse Progress' : 'Usage Progress'}
                                        </span>
                                        <span className={`font-semibold ${allowance.isOverused ? 'text-red-600' : 'text-text-primary'
                                            }`}>
                                            {allowance.progress}%
                                        </span>
                                    </div>
                                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-300 ${allowance.isOverused
                                                ? 'bg-red-500 animate-pulse'
                                                : allowance.progress > 80
                                                    ? 'bg-red-500'
                                                    : allowance.progress > 60
                                                        ? 'bg-yellow-500'
                                                        : 'bg-green-500'
                                                }`}
                                            style={{ width: `${Math.min(allowance.progress, 100)}%` }}
                                        ></div>
                                    </div>
                                    {allowance.isOverused && (
                                        <div className="text-xs text-red-600 mt-1 text-center font-medium">
                                            Exceeded allowance limit
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

            </div>

            {/* Edit Allowance Modal */}
            <EditAllowanceModal
                isOpen={EditAllowanceModalOpen}
                onClose={() => {
                    setEditAllowanceModalOpen(false);
                    setSelectedAllowance(null);
                }}
                onSave={handleSaveAllowance}
                allowance={selectedAllowance}
                employee={employee || { name: "Employee", role: "", hireDate: "", employeeId: "" }}
            />

            {/* Create Allowance Modal - Only for authorized users */}
            {canCreateAllowance && (
                <CreateAllowanceModal
                    isOpen={CreateAllowanceModalOpen}
                    onClose={() => setCreateAllowanceModalOpen(false)}
                    onSave={handleCreateAllowance}
                    employee={employee || { name: "Employee", role: "", hireDate: "", employeeId: "" }}
                    existingAllowances={[]}
                />
            )}
        </>
    );
};

export default AllowancesTab;