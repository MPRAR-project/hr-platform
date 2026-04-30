import { ArrowRight, Clock, Loader2, Lock, Mail, Shield, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import Input from '../../components/shared/Input';
import { useAuth } from '../../hooks/useAuth';





const LoginPage = () => {
    const [formData, setFormData] = useState({
        email: '',
        password: ''
    });
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();
    const { login, user } = useAuth();


    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleLogin = async () => {
        // Basic validation
        if (!formData.email || !formData.password) {
            toast.error('Please fill in all fields');
            return;
        }

        if (!formData.email.includes('@')) {
            toast.error('Please enter a valid email address');
            return;
        }

        setIsLoading(true);
        try {
            const loggedInUser = await login(formData.email, formData.password);
            toast.success('Login successful! Welcome back.');

            // Redirect to dashboard - OnboardingGuard will handle onboarding checks

            navigate('/');
        } catch (error) {
            // Login error:
            toast.error(error.message || 'Login failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // Handle form submission (Enter key press)
    const handleSubmit = (e) => {
        e.preventDefault();
        handleLogin();
    };

    return (
        <div className="min-h-screen bg-white relative flex flex-col justify-around items-center overflow-hidden p-8 gap-10">
            {/* Background Image */}
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-60 pointer-events-none"
                style={{ backgroundImage: "url('/Authbg.png')" }}
            ></div>
            {/* <h1 className="text-4xl z-10  font-extrabold text-text-primary text-center">
                MPraR
            </h1> */}
            <div className='block w-40 z-10'>
                <img
                    src='/LOGO-B3.png'
                    alt='MPRAR Portal'
                    className='w-full max-h-12 object-contain'
                />
            </div>
            <div className=' w-full place-items-center  lg:grid lg:grid-cols-2 flex flex-col  gap-10 lg:px-10'>

                {/* Left Side - Hero Content */}
                <div className="relative z-10 w-full max-w-[550px] flex flex-col items-center gap-10 sm:gap-20 ">
                    {/* Hero Text */}
                    <div className="flex flex-col items-center gap-7">
                        {/* Logo/Brand */}


                        {/* Main Heading */}
                        <h2 className="text-4xl font-extrabold text-text-primary text-center leading-[43px]">
                            Digital Workforce Management Made Simple
                        </h2>

                        {/* Subtitle */}
                        <p className="text-md text-text-secondary text-center">
                            Manage timesheets, onboarding, and compliance in one secure platform.
                        </p>
                    </div>

                    {/* Feature Cards */}
                    <div className="flex justify-center gap-3 flex-wrap">
                        {/* Secure & Compliant */}
                        <div className="flex items-center gap-2.5 px-5 py-4 bg-white/10 border border-text-primary rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.1)]">
                            <Shield className="h-6 w-6 text-blue-500" />
                            <span className="text-xl font-semibold text-text-primary whitespace-nowrap">
                                Secure & <br className='sm:flex hidden' />Compliant
                            </span>
                        </div>

                        {/* Role-Based Access */}
                        <div className="flex items-center gap-4 px-5 py-4 bg-white/10 border border-text-primary rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.1)]">
                            <Users className="h-6 w-6 text-yellow-500" />
                            <span className="text-xl font-semibold text-text-primary whitespace-nowrap">
                                Role-Based <br className='sm:flex hidden' />Access
                            </span>
                        </div>

                        {/* Real-Time Updates */}
                        <div className="flex items-center gap-3.5 px-5 py-4 bg-white/10 border border-text-primary rounded-2xl shadow-[0_2px_16px_rgba(0,0,0,0.1)]">
                            <Clock className="h-6 w-6 text-pink-600" />
                            <span className="text-xl font-semibold text-text-primary whitespace-nowrap">
                                Real-Time <br className='sm:flex hidden' />Updates
                            </span>
                        </div>
                    </div>
                </div>

                {/* Right Side - Login Form */}
                <div className="relative z-10 w-full max-w-[400px] bg-white rounded-[24px] shadow-lg p-6">
                    <div className="space-y-10">
                        {/* Form Header */}
                        <div className="space-y-2">
                            <h3 className="text-[32px] sm:text-left text-center font-bold text-text-primary tracking-tight">Sign In</h3>
                            <p className="text-md sm:text-left text-center font-medium text-text-secondary">Sign in with your account</p>
                        </div>

                        {/* Form Fields */}
                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div className="space-y-4">
                                <p className="text-md font-medium text-text-secondary">Continue with your e-mail address</p>

                                <Input
                                    icon={Mail}
                                    type="email"
                                    placeholder="Enter your email address"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                />

                                <div className="space-y-1">
                                    <Input
                                        icon={Lock}
                                        type="password"
                                        placeholder="Enter your password"
                                        name="password"
                                        value={formData.password}
                                        onChange={handleChange}
                                    />
                                    <div className="flex justify-end">
                                        <a href="/forgot-password" className="text-md font-medium text-red-500 hover:underline">
                                            Forgot Password?
                                        </a>
                                    </div>
                                </div>
                            </div>

                            {/* Sign In Button */}
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full h-12 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-normal text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        <span>Signing in...</span>
                                    </>
                                ) : (
                                    <>
                                        <span>Sign in</span>
                                        <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                                            <ArrowRight className="h-3 w-3 text-[#CB30E0]" />
                                        </div>
                                    </>
                                )}
                            </button>

                            {/* Sign Up Link */}
                            <p className="text-center text-md font-medium text-text-secondary">
                                Don't have an account?{' '}
                                <Link to="/signup" className="text-text-accent-purple hover:underline">
                                    Sign up
                                </Link>
                            </p>
                        </form>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default LoginPage;