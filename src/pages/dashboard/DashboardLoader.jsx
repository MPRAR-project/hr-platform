import SuperUserDashboard from './SuperUserDashboard.jsx';
import { useAuth } from '../../hooks/useAuth.js';
import { Navigate } from 'react-router-dom';
import SiteManagerDashboard from './SiteManagerDashboard.jsx';
import Header from '../../components/layout/Header.jsx';
import ComingSoon from '../ComingSoon.jsx';
import EmployeeDashboard from './EmployeeDashboard.jsx';
import Loader from '../../components/ui/Loader';

const dashboards = {
  superUser: <SuperUserDashboard />,
  siteManager: <SiteManagerDashboard />,
  teamManager: <EmployeeDashboard />,
  hrManager: <EmployeeDashboard />,
  seniorManager: <EmployeeDashboard />,
  adminManager: <EmployeeDashboard />,
  hrAdvisor: <EmployeeDashboard />,
  adminAdvisor: <EmployeeDashboard />,
  contractManager: <EmployeeDashboard />,
  employee: <EmployeeDashboard />
};

const DashboardLoader = () => {
  const { user, isLoading } = useAuth();

  // Show loading state while user data is being fetched
  if (isLoading) {
    return (
      <Loader
        variant="spinner"
        size="lg"
        text="Loading page..."
        fullScreen={true}
      />
    );
  }

  // Redirect to login if no user is authenticated
  if (!user) return <Navigate to="/login" replace />;

  return dashboards[user.role] || <div className='w-full '>
    <Header title={"Coming Soon"} subtitle={"Work in progress.."} />
    <ComingSoon /></div>;
};

export default DashboardLoader;