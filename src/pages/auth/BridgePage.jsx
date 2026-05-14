/**
 * BridgePage.jsx — Central → HR SSO Bridge (Phase 3 — REST)
 *
 * Old flow: Central sends Firebase custom token → signInWithCustomToken()
 * New flow: Central sends Central JWT → POST /hr/auth/bridge → HR JWT
 *
 * URL: /bridge?token=<central_jwt>&central_token=<same_or_alt>
 *
 * No Firebase imports — no Firestore IndexedDB to clear.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Loader from '../../components/ui/Loader';

const CENTRAL_URL = import.meta.env.VITE_CENTRAL_URL || 'http://localhost:5173';

const BridgePage = () => {
  const [searchParams] = useSearchParams();
  const navigate        = useNavigate();
  const { loginWithToken } = useAuth();
  const [error, setError] = useState(null);

  useEffect(() => {
    // Accept ?token= (new) or ?central_token= (legacy param name)
    const token = searchParams.get('token') || searchParams.get('central_token');

    if (!token) {
      setError('Access token is missing. Please return to the Central Platform and try again.');
      return;
    }

    // Persist the central token in case other services need it
    localStorage.setItem('mprar_central_token', token);

    const performBridge = async (attempt = 0) => {
      try {
        // POST /hr/auth/bridge { token: centralJwt } → returns HR JWT
        await loginWithToken(token);
        navigate('/', { replace: true });
      } catch (err) {
        console.error(`[BridgePage] Bridge attempt ${attempt + 1} failed:`, err);

        if (attempt < 1) {
          // One retry after a short delay
          await new Promise((r) => setTimeout(r, 1000));
          return performBridge(attempt + 1);
        }

        const detail = err?.message || 'Unknown authentication error';
        setError(
          `Bridge authentication failed: ${detail}. ` +
          'Please try launching the HR platform again from the Central Platform.'
        );
      }
    };

    performBridge();
  }, [searchParams, loginWithToken, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center border border-red-100">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Bridge Access Error</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => (window.location.href = `${CENTRAL_URL}/login`)}
            className="w-full py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 transition-colors"
          >
            Back to Central Platform
          </button>
        </div>
      </div>
    );
  }

  return <Loader fullScreen text="Bridging your secure session..." />;
};

export default BridgePage;
