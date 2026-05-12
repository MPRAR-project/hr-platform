import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import apiClient from "../../api/apiClient";
import { loginWithToken } from "../../services/auth";

const InviteSignupPage = () => {
    const [sp] = useSearchParams();
    const navigate = useNavigate();
    const [email] = useState(sp.get("email") || "");
    const [token] = useState(sp.get("token") || "");
    const [valid, setValid] = useState(false);
    const [invite, setInvite] = useState(null);
    const [password, setPassword] = useState("");
    const [cpass, setCpass] = useState("");
    const [err, setErr] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const verify = async () => {
            try {
                setLoading(true);
                setErr("");
                if (!email || !token) {
                    setErr("Invalid invite link");
                    return;
                }

                const response = await apiClient.get('/hr/invites/verify', {
                    params: { email, token }
                });

                if (response.data?.invite) {
                    setInvite(response.data.invite);
                    setValid(true);
                } else {
                    setErr("Invite not found or already used");
                }
            } catch (e) {
                setErr(e.response?.data?.error || "Failed to validate invite");
            } finally {
                setLoading(false);
            }
        };
        verify();
    }, [email, token]);

    const onSubmit = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            setErr("");
            
            if (!password || password !== cpass) {
                throw new Error("Passwords do not match");
            }

            const response = await apiClient.post('/hr/invites/accept', {
                email,
                token,
                password
            });

            if (response.data?.accessToken) {
                // Log in with the returned token
                await loginWithToken(response.data.accessToken);
                
                // Determine redirect path (Simplified for now, can use onboardingUtils)
                const user = response.data.user;
                if (user.isOnboardingMandatory) {
                    navigate('/emp/onboarding');
                } else {
                    navigate('/');
                }
            } else {
                throw new Error("Failed to create account");
            }

        } catch (e) {
            setErr(e.response?.data?.error || e.message || "Failed to complete signup");
        } finally {
            setLoading(false);
        }
    };

    if (loading && !valid) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <p className="animate-pulse text-gray-500">Verifying your invite...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-100 p-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-800">🎉 Complete Your Account</h1>
                    <p className="text-gray-500 text-sm mt-1">Welcome! Let's finish setting up your account.</p>
                </div>

                {!valid && err && (
                    <div className="text-center py-6 text-red-600 font-medium">{err}</div>
                )}

                {valid && (
                    <form onSubmit={onSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                            <input value={email} disabled className="w-full border border-gray-300 rounded-lg px-3 py-2 bg-gray-100 cursor-not-allowed text-gray-600" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Enter a secure password" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                            <input type="password" value={cpass} onChange={(e) => setCpass(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-purple-500 outline-none" placeholder="Re-enter your password" />
                        </div>

                        {err && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-600 text-sm text-center">{err}</div>
                        )}

                        <button type="submit" disabled={loading} className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 text-white py-2.5 rounded-lg font-semibold shadow hover:opacity-90 transition-all disabled:opacity-50">
                            {loading ? "Processing..." : "Create Account"}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default InviteSignupPage;
