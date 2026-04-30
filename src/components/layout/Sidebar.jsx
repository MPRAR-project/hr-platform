
import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getCompanyPlugins } from '../../services/companyManagementService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/client';
import {
  LayoutDashboard,
  CreditCard,
  X,
  Users,
  FileText,
  GraduationCap,
  UserPlus,
  Receipt,
  PoundSterling,
  Settings,
  LogOutIcon,
  RepeatIcon,
  Calendar,
  CalendarDays,
  UserCircle,
  PlusCircle,
  CalendarCheck,
  Database,
  Clock,
  MapPin,
  // using BarChart or FileText as fallback in case Receipt is taken
  AlertTriangle,
  Activity,
  ChevronDown,
  ChevronRight,
  DollarSign
} from 'lucide-react';
import { useUI } from '../../hooks/useUI';

const NavItem = ({ to, icon: Icon, label, onClick, className }) => {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        `flex items-center gap-lg p-lg rounded-sm w-full transition-all ${className || ''} ${isActive
          ? 'bg-bg-accent-purple border border-border-accent-purple text-text-accent-purple font-bold'
          : 'text-text-secondary opacity-80 hover:opacity-100 hover:bg-bg-secondary'
        }`
      }
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
};

const NavGroup = ({ label, icon: Icon, children, basePath, onLinkClick }) => {
  const location = window.location.pathname;
  // Auto-open if current path matches any child
  const [isOpen, setIsOpen] = useState(
    children.some(child => child.to === location || location.startsWith(child.to))
  );

  return (
    <div className="w-full">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-label={`Toggle ${label} menu`}
        className={`flex items-center justify-between gap-lg p-lg rounded-sm w-full transition-all text-text-secondary opacity-80 hover:opacity-100 hover:bg-bg-secondary ${isOpen ? 'bg-bg-secondary opacity-100' : ''}`}
      >
        <div className="flex items-center gap-lg flex-1 min-w-0">
          <Icon className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
        </div>
        {isOpen ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
      </button>

      {isOpen && (
        <div className="ml-4 mt-1 space-y-1 border-l-2 border-border-secondary pl-2">
          {children.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              onClick={onLinkClick}
              className={({ isActive }) =>
                `flex items-center gap-lg p-lg rounded-sm w-full transition-all text-sm py-2 ${isActive
                  ? 'bg-bg-accent-purple border border-border-accent-purple text-text-accent-purple font-bold'
                  : 'text-text-secondary opacity-80 hover:opacity-100 hover:bg-bg-secondary'
                }`
              }
            >
              <span>{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
};

const Sidebar = () => {
  const { user, isLoading, logout } = useAuth();
  const { isSidebarOpen, closeSidebar } = useUI();
  const navigate = useNavigate();
  const [hasInvoicePlugin, setHasInvoicePlugin] = useState(false);
  const [hasSchedulingPlugin, setHasSchedulingPlugin] = useState(false);
  const [hasAbsencePlugin, setHasAbsencePlugin] = useState(true);
  const [companyLogo, setCompanyLogo] = useState(null);
  const [companyName, setCompanyName] = useState(null);

  useEffect(() => {
    const checkPluginAndLogo = async () => {
      // Prioritize company context if available (even for super users)
      if (user?.companyId) {
        const companyId = user.companyId.includes('/') ? user.companyId.split('/').pop() : user.companyId;
        const plugins = await getCompanyPlugins(user.companyId);
        setHasInvoicePlugin(Boolean(plugins.payslipAndInvoice));
        setHasSchedulingPlugin(Boolean(plugins.scheduling));
        setHasAbsencePlugin(plugins.absence !== false); // Default to true if undefined

        // Fetch Company Logo
        try {
          const companyRef = doc(db, 'companies', companyId);
          const companySnap = await getDoc(companyRef);
          if (companySnap.exists()) {
            const data = companySnap.data();
            setCompanyLogo(data.logoURL || data.logoUrl || data.logo || null);
            setCompanyName(data.name || data.companyName || null);
          }
        } catch (err) {
          console.error("Error fetching company logo:", err);
        }

        return;
      }

      // Fallback for super users without a specific company context
      if (user?.role === 'superUser') {
        setHasInvoicePlugin(true);
        setHasSchedulingPlugin(true);
        // Super User sees MPRAR logo by default (null)
        return;
      }

      // Default for others without company context
      setHasInvoicePlugin(false);
      setHasSchedulingPlugin(false);

    };
    checkPluginAndLogo();
  }, [user]);


  const HandleLogout = async (e) => {
    try {
      e.preventDefault();
      // Call logout service which handles Firebase signOut and cache clearing
      await logout();
      // Ensure we clean up any local flags that might interfere
      localStorage.removeItem('isCreatingUsers');
      localStorage.removeItem('signupInProgress');
      // Force navigation to login page to ensure clean state
      navigate('/login', { replace: true });
    } catch (error) {
      console.log("Error logging out:", error);
      // Fallback: hard reload to login page if logout fails
      window.location.href = '/login';
    } finally {
      closeSidebar();
    }
  };
  // Navigation links with role-based access control
  const navLinks = [
    {
      to: '/',
      label: 'Dashboard',
      icon: LayoutDashboard,
      roles: ['superUser', 'siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee']
    },
    {
      to: '/payments',
      label: 'Payments',
      icon: CreditCard,
      roles: ['superUser']
    },
    // Grouped Invoice & Payslip
    {
      label: 'Invoice & Payslip',
      icon: Receipt,
      children: [
        {
          to: '/invoice-summary',
          label: 'Invoice Summary',
          icon: Receipt,
          roles: ['siteManager', 'seniorManager'],
          condition: hasInvoicePlugin
        },
        {
          to: '/financials/invoice-generator',
          label: 'Invoice Generator',
          icon: FileText,
          roles: ['siteManager', 'seniorManager'],
          condition: hasInvoicePlugin
        },
        {
          to: '/financials/payslip-generator',
          label: 'Payslip Generator',
          icon: Receipt,
          roles: ['siteManager', 'seniorManager'],
          condition: hasInvoicePlugin
        },
        {
          to: '/financials/allowances',
          label: 'Rate Settings',
          icon: PoundSterling,
          roles: ['siteManager', 'seniorManager'], // Financials restricted
          condition: hasInvoicePlugin
        },
        {
          to: '/admin/invoice-settings',
          label: 'Invoice Settings',
          icon: Settings,
          roles: ['siteManager', 'seniorManager'],
          condition: hasInvoicePlugin
        },
      ]
    },
    {
      to: '/timesheets',
      label: 'Timesheet',
      icon: CalendarCheck,
      roles: ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee']
    },
    // {
    //   to: '/timesheet-archives',
    //   label: 'Timesheet Browser',
    //   icon: Archive,
    //   roles: ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee']
    // },
    {
      to: '/time-entries',
      label: 'Time Entries',
      icon: Clock,
      roles: ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee']
    },
    {
      to: '/absences',
      label: 'Absences',
      icon: Calendar,
      roles: ['siteManager', 'seniorManager', 'employee', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'],
      condition: hasAbsencePlugin
    },
    // {
    //   to: '/Calendar',
    //   label: 'Calendar',
    //   icon: CalendarDays,
    //   roles: ['employee', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'siteManager', 'seniorManager'],
    //   condition: hasSchedulingPlugin
    // },
    // Grouped Scheduling (for Site Manager and Senior Manager only)
    {
      label: 'Scheduling',
      icon: CalendarDays,
      to: '/schedule',
      roles: ['siteManager', 'adminManager', 'employee'],
      condition: hasSchedulingPlugin,
      children: [
        {
          label: 'Schedule',
          to: '/schedule',
          roles: ['siteManager', 'adminManager', 'employee'],
          condition: hasSchedulingPlugin,
        },
        {
          to: '/locations',
          label: 'Locations',
          icon: MapPin,
          roles: ['siteManager', 'seniorManager'],
          condition: hasSchedulingPlugin,
        },
        {
          to: '/activity-oversight',
          label: 'Activity Oversight',
          icon: Activity,
          roles: ['siteManager', 'seniorManager'],
          condition: hasSchedulingPlugin
        },
        {
          to: '/incidents',
          label: 'Incidents',
          icon: AlertTriangle,
          roles: ['siteManager', 'seniorManager'],
          condition: hasSchedulingPlugin
        }
      ]
    },
    {
      to: '/training',
      label: 'Training',
      icon: GraduationCap,
      roles: ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee']
    },
    {
      to: '/documents',
      label: 'Documents',
      icon: FileText,
      roles: ['siteManager', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee']
    },
    {
      to: '/incidents',
      label: 'Incidents',
      icon: AlertTriangle,
      roles: ['teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'employee'],
      condition: hasSchedulingPlugin
    },
    // {
    //   to: '/hr-onboarding',
    //   label: 'HR Onboarding',
    //   icon: UserPlus,
    //   roles: ['siteManager', 'seniorManager', 'hrManager', 'adminManager']
    // },

    {
      to: '/users',
      label: 'Users',
      icon: Users,
      roles: ['siteManager', 'seniorManager', 'adminManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor', 'contractManager'
      ]
    },
    {
      to: '/allowance',
      label: 'Allowance',
      icon: DollarSign,
      roles: ['siteManager', 'seniorManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor'],
      condition: hasAbsencePlugin
    },
    {
      to: '/payment-reports',
      label: 'Payment Reports',
      icon: Receipt,
      roles: ['']
    },
    {
      to: '/myteam',
      label: 'My Team',
      icon: Users,
      roles: ['teamManager', 'seniorManager']
    },
    {
      to: '/seat-management',
      label: 'Seat Request',
      icon: PlusCircle,
      roles: ['hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor']
    },
    // {
    //   to: '/myabsences',
    //   label: 'My Absences',
    //   icon: Calendar,
    //   roles: ['employee', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor']
    // },

    {
      to: '/settings',
      label: 'Settings',
      icon: Settings,
      roles: ['siteManager', 'seniorManager']
    },
    // {
    //   to: '/admin/migration',
    //   roles: ['siteManager', 'adminManager']
    // },
    {
      to: '/admin/plugin-manager',
      label: 'Plugin Manager',
      icon: Database, // Note: You might want to use a different icon if Database is used for both
      roles: ['superUser']
    },
    {
      to: '/admin/global-users',
      label: 'User Database',
      icon: Database,
      roles: ['superUser']
    },

    {
      to: '/myprofile',
      label: 'Profile',
      icon: UserCircle,
      roles: ['employee', 'seniorManager', 'teamManager', 'hrManager', 'hrAdvisor', 'adminManager', 'adminAdvisor']
    },
    {
      to: '/emp/onboarding',
      label: 'Onboarding-Screens',
      icon: RepeatIcon,
      roles: ['']
    },
    {
      to: '/login',
      label: 'Logout',
      icon: LogOutIcon,
      roles: ['all'],
      action: HandleLogout
    }
  ];
  // Filter navigation links based on the current user's role and optional condition
  const accessibleLinks = navLinks.reduce((acc, link) => {
    // Helper to check access for a single item
    const hasAccess = (item) => {
      if (!item.roles) return true; // Groups might not have roles, rely on children
      const userRole = user?.role || '';
      const roleMatch = item.roles.includes(userRole) || item.roles.includes('all');
      const conditionMatch = item.condition !== undefined ? item.condition : true;
      return roleMatch && conditionMatch;
    };

    if (link.children) {
      // If it's a group, filter its children
      const filteredChildren = link.children.filter(child => hasAccess(child));

      // Only include the group if it has accessible children
      if (filteredChildren.length > 0) {
        acc.push({ ...link, children: filteredChildren });
      }
    } else {
      // Normal item
      if (hasAccess(link)) {
        acc.push(link);
      }
    }

    return acc;
  }, []);

  const pretty = (role) =>
    role ? role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()) : '';

  return (
    <>
      {/* Overlay for mobile */}
      <div
        className={`fixed inset-0 bg-black bg-opacity-50 z-10 lg:hidden ${isSidebarOpen ? 'block' : 'hidden'
          }`}
        onClick={closeSidebar}
      ></div>

      {/* Sidebar */}
      <aside
        className={`fixed bg-white top-0 left-0 h-full sm:w-[260px] bg-bg-primary border-r border-border-primary flex flex-col z-[40] w-screen
lg:relative lg:translate-x-0 transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* Logo/Header */}
        <div className="h-[80px] flex items-center px-8 border-b border-border-primary w-full md:justify-center justify-between flex-shrink-0">

          {/* Desktop: Company Logo or Placeholder */}
          <div className="hidden lg:flex items-center justify-center min-w-[120px] max-w-[180px] h-[50px]">
            {companyLogo ? (
              <img
                src={companyLogo}
                alt={companyName || 'Company Logo'}
                width="160"
                height="50"
                className="max-h-[50px] max-w-[160px] object-contain"
              />
            ) : (
              <div className="w-[140px] h-[45px] bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center">
                <span className="text-[9px] text-gray-400 font-medium uppercase tracking-wider text-center px-2">Your Company Logo</span>
              </div>
            )}
          </div>

          {/* Mobile: User Role */}
          <div className="lg:hidden flex items-center">
            <span className="text-xl font-bold text-text-primary tracking-tight">
              {user?.role ? pretty(user.role) : 'Portal'}
            </span>
          </div>

          <button onClick={closeSidebar} aria-label="Close sidebar" className="lg:hidden">
            <X className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>


        {/* Navigation */}

        <nav className="p-2xl flex flex-col gap-sm overflow-y-auto flex-1">
          {accessibleLinks.map((link) => (
            link.children ? (
              <NavGroup
                key={link.label}
                label={link.label}
                icon={link.icon}
                children={link.children}
                onLinkClick={closeSidebar}
              />
            ) : (
              <NavItem
                key={link.to}
                to={link.to}
                icon={link.icon}
                label={link.label}
                onClick={link.action || closeSidebar}
              />
            )
          ))}
        </nav>

        {/* Mobile Footer Logo */}
        <div className="lg:hidden p-4 border-t border-border-primary flex justify-center flex-shrink-0">
          <img src='/LOGO-B3.png' alt='MPRAR Portal' width="128" height="48" loading="lazy" className="w-32 object-contain" />
        </div>
      </aside >
    </>
  );
};

export default Sidebar;