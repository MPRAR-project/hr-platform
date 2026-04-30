import React, { useState } from 'react';
import { Mail, ArrowRight, Loader2, ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Input from '../../components/shared/Input';
import { sendPasswordResetLink } from '../../services/auth';

const ForgotPasswordPage = () => {
    const [email, setEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isSent, setIsSent] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!email) {
            toast.error('Please enter your email address');
            return;
        }

        if (!email.includes('@')) {
            toast.error('Please enter a valid email address');
            return;
        }

        setIsLoading(true);
        try {
            await sendPasswordResetLink(email);
            setIsSent(true);
            toast.success('Password reset email sent!');
        } catch (error) {
            console.error('Reset error:', error);
            toast.error(error.message || 'Failed to send reset email. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white relative flex flex-col justify-center items-center overflow-hidden p-8">
            {/* Background Image */}
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-60 pointer-events-none"
                style={{ backgroundImage: "url('/Authbg.png')" }}
            ></div>

            <div className="relative z-10 w-full max-w-[450px] bg-white rounded-[24px] shadow-lg p-8">
                <div className="space-y-8">
                    {/* Header */}
                    <div className="space-y-2 text-center">
                        <h3 className="text-[32px] font-bold text-text-primary tracking-tight">Reset Password</h3>
                        <p className="text-md font-medium text-text-secondary">
                            {!isSent
                                ? "Enter your email for a reset link"
                                : "Check your email for instructions"}
                        </p>
                    </div>

                    {!isSent ? (
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-4">
                                <Input
                                    icon={Mail}
                                    type="email"
                                    placeholder="Enter your email address"
                                    name="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full h-12 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-normal text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>Sending...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Send Reset Link</span>
                                        <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                                            <ArrowRight className="h-3 w-3 text-[#CB30E0]" />
                                        </div>
                                    </>
                                )}
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-6">
                            <div className="bg-purple-50 rounded-xl p-6 text-center space-y-4">
                                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
                                    <Mail className="h-8 w-8 text-purple-600" />
                                </div>
                                <p className="text-text-secondary text-sm">
                                    We have sent a password reset link to <strong>{email}</strong>.
                                    Please check your inbox and spam folder.
                                </p>
                            </div>

                            <button
                                onClick={() => setIsSent(false)}
                                className="w-full h-12 border border-gray-200 text-text-secondary rounded-base font-medium hover:bg-gray-50 transition-colors"
                            >
                                Try another email
                            </button>
                        </div>
                    )}

                    {/* Back to Login */}
                    <div className="flex justify-center">
                        <Link
                            to="/login"
                            className="flex items-center gap-2 text-md font-medium text-text-secondary hover:text-text-primary transition-colors"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to Sign In
                        </Link>
                    </div>
                </div>
            </div>

            <div className="absolute bottom-8 text-center">
                <p className="text-sm text-text-secondary opacity-60">
                    &copy; {new Date().getFullYear()} MPraR Portal. All rights reserved.
                </p>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
