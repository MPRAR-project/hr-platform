import { doc, getDoc } from 'firebase/firestore';
import { ChevronDown, Menu, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { db } from '../../firebase/client';
import { useAuth } from '../../hooks/useAuth';
import { useUI } from '../../hooks/useUI';
import NotificationBell from '../common/NotificationBell';



const Header = ({ title, subtitle, action, backButton, onBack }) => {
  const { user } = useAuth();
  const { openSidebar, closeSidebar } = useUI();
  const [userPhotoURL, setUserPhotoURL] = useState(null);
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(true);
  const [companyLogo, setCompanyLogo] = useState(null);

  const pretty = (role) =>
    role.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

  // Load company logo from Firestore
  useEffect(() => {
    const loadCompanyLogo = async () => {
      if (!user?.companyId) {
        return;
      }

      try {
        const companyId = user.companyId.includes('/') ? user.companyId.split('/').pop() : user.companyId;
        const companyRef = doc(db, 'companies', companyId);
        const companySnap = await getDoc(companyRef);

        if (companySnap.exists()) {
          const data = companySnap.data();
          setCompanyLogo(data.logoURL || data.logoUrl || data.logo || null);
        }
      } catch (error) {
        console.error('Error loading company logo:', error);
      }
    };

    loadCompanyLogo();
  }, [user?.companyId]);

  // Load user's profile photo from Firestore
  useEffect(() => {
    const loadUserPhoto = async () => {
      if (!user?.uid) {
        setIsLoadingPhoto(false);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          setUserPhotoURL(userData.photoURL || null);
        }
      } catch (error) {
        console.error('Error loading user photo:', error);
      } finally {
        setIsLoadingPhoto(false);
      }
    };

    loadUserPhoto();
  }, [user?.uid]);

  return (
    <header className="h-[80px] sticky top-0 bg-white flex-shrink-0 bg-bg-primary border-b border-border-primary flex items-center justify-between px-4 sm:px-4xl z-30">
      <div className="flex items-center gap-md">
        <div className="flex items-center gap-sm">
          <button type="button" onClick={openSidebar} className="lg:hidden" aria-label="Open sidebar">
            <Menu className="h-6 w-6" />
          </button>
          {backButton && (
            <button
              type="button"
              onClick={onBack || backButton}
              className="flex items-center gap-1 text-sm font-semibold text-text-primary bg-white border border-border-primary rounded-full px-3 py-1.5 hover:bg-gray-50 transition"
            >
              <ChevronDown className="h-4 w-4 rotate-90" />
              <span>Back</span>
            </button>
          )}
        </div>

        <div>
          <h2 className="sm:text-[20px] font-semibold text-text-primary text-lg leading-5xl">{title}</h2>
          <p className="hidden sm:block text-sm text-text-secondary">{subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-md md:gap-4xl relative">
        {/* Logged-in User Name */}
        <div className="hidden md:flex items-center">
          <span className="
    px-3 py-1
    rounded-full
    border border-2 border-purple-300
    bg-purple-50
    text-purple-600
    text-sm
    font-normal
  ">
            {user?.displayName ||
              `${user?.firstName || ''} ${user?.lastName || ''}`.trim() ||
              user?.email?.split('@')[0] ||
              'User'}
          </span>
        </div>


        {/* Company Logo - Mobile only (shows company logo if available, otherwise MPRAR) */}
        <div className='w-24 md:hidden'>
          <img
            src={companyLogo || '/LOGO-B3.png'}
            alt={companyLogo ? 'Company Logo' : 'MPRAR Portal'}
            width="96"
            height="48"
            className='w-full max-h-12 object-contain'
          />
        </div>

        {/* MPRAR Logo - Desktop only (md and above) */}
        <div className='hidden md:block w-24'>
          <img
            src='/LOGO-B3.png'
            alt='MPRAR Portal'
            width="96"
            height="48"
            className='w-full max-h-12 object-contain'
          />
        </div>

        {/* Notification Bell (Right - Replaces Avatar) */}
        <NotificationBell />
      </div>

    </header >
  );
};

export default Header;