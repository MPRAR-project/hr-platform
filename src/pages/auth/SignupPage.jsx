import React, { useState } from 'react';
import { User, Mail, Lock, Building2, BarChart3, Phone, Globe, MapPin, ArrowRight, KeyRound, Loader2, ChevronDown } from 'lucide-react';
import Input from '../../components/shared/Input';
import { Link, useNavigate } from 'react-router-dom';
import { submitSignup } from '../../services/signup';
import { toast } from 'react-toastify';


// Main Signup Page Component
const SignupPage = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    companyName: '',
    industry: '',
    phoneNumber: '',
    website: '',
    address: '',
    weekStartDay: 'monday',
    termsAccepted: false
  });

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    // Restrict First Name & Last Name to text only (no numbers or special characters for names usually)
    if ((name === 'firstName' || name === 'lastName') && /[^a-zA-Z\s-]/.test(value)) {
      return;
    }

    // Restrict Phone Number to numbers/symbols only (no alphabets)
    if (name === 'phoneNumber' && /[a-zA-Z]/.test(value)) {
      return;
    }

    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value
    });
  };

  const validateForm = () => {
    // Required fields validation
    const requiredFields = ['firstName', 'lastName', 'email', 'password', 'confirmPassword', 'companyName', 'weekStartDay'];
    const missingFields = requiredFields.filter(field => !formData[field]?.trim());

    if (missingFields.length > 0) {
      toast.error('Please fill in all required fields');
      return false;
    }

    // Email validation
    if (!formData.email.includes('@') || !formData.email.includes('.')) {
      toast.error('Please enter a valid email address');
      return false;
    }

    // Password validation
    const password = formData.password;
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return false;
    }

    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /\d/.test(password);
    const hasSpecialChar = /[\W_]/.test(password);

    if (!(hasUpperCase && hasLowerCase && hasNumber && hasSpecialChar)) {
      toast.error('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.');
      return false;
    }

    // Password confirmation
    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return false;
    }

    // Terms acceptance validation
    if (!formData.termsAccepted) {
      toast.error('You must agree to the Terms of Service and Privacy Policy');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    try {
      console.log('Starting signup process...');

      // Set flag to prevent AuthContext from interfering with navigation
      localStorage.setItem('signupInProgress', 'true');

      const res = await submitSignup({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        password: formData.password,
        companyName: formData.companyName,
        industry: formData.industry,
        phone: formData.phoneNumber,
        website: formData.website,
        addressRaw: formData.address,
        weekStartDay: formData.weekStartDay,
      });

      console.log('Signup successful:', res);
      toast.success('Account created successfully! Welcome to MPraR Portal.');

      // Add a small delay to ensure the toast is visible and auth state stabilizes
      setTimeout(() => {
        console.log('Navigating to team-size-selection with companyId:', res.companyId);
        navigate('/team-size-selection', { state: { companyId: res.companyId } });
      }, 1000);
    } catch (error) {
      console.error('Signup error:', error);

      // Clear the signup flag on error
      localStorage.removeItem('signupInProgress');

      // Show more specific error messages
      let errorMessage = 'Signup failed. Please try again.';

      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An account with this email already exists. Please use a different email or try logging in.';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Please enter a valid email address.';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters long.';
      } else if (error.code === 'auth/network-request-failed') {
        errorMessage = 'Network error. Please check your connection and try again.';
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white relative overflow-hidden flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.5] pointer-events-none"
        style={{ backgroundImage: "url('/Authbg.png')" }}
      ></div>



      {/* Main Form Container */}
      <div className="w-full max-w-[520px] bg-white rounded-[24px] shadow-[0_14px_42px_rgba(8,15,52,0.06)] p-6 relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-[32px] font-bold text-text-primary mb-1">Create Your Account</h1>
          <p className="text-md text-text-secondary">Get started with MPraR Portal</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Sign Up Title */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-text-primary">Sign Up as Site Manager</h2>
            <p className="text-sm text-text-secondary mt-1">Create your company account and start managing your workforce</p>
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-700">
                <strong>Note:</strong> Only Site Managers can create new accounts. Other users must be invited by their Site Manager.
              </p>
            </div>
          </div>

          {/* Personal Information Section */}
          <div className="space-y-4">
            <h3 className="text-md font-medium text-text-primary">Personal Information</h3>

            <div className="grid grid-cols-2 gap-4">
              <Input
                icon={User}
                placeholder="First Name"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
              />
              <Input
                icon={User}
                placeholder="Last Name"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
              />
            </div>

            <Input
              icon={Mail}
              type="email"
              placeholder="Email"
              name="email"
              value={formData.email}
              onChange={handleChange}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                icon={KeyRound}
                type="password"
                placeholder="Password"
                name="password"
                value={formData.password}
                onChange={handleChange}
              />
              <Input
                icon={KeyRound}
                type="password"
                placeholder="Confirm Password"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border-secondary"></div>

          {/* Company Information Section */}
          <div className="space-y-4">
            <h3 className="text-md font-medium text-text-primary">Company Information</h3>

            <Input
              icon={Building2}
              placeholder="Company Name"
              name="companyName"
              value={formData.companyName}
              onChange={handleChange}
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <Input
                icon={BarChart3}
                placeholder="Industry"
                name="industry"
                value={formData.industry}
                onChange={handleChange}
              />
              <Input
                icon={Phone}
                type="tel"
                placeholder="Phone Number"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
              />
            </div>
            <div>
              <div className="relative">
                <select
                  name="weekStartDay"
                  value={formData.weekStartDay}
                  onChange={handleChange}
                  className="w-full h-12 px-4 pr-10 border border-border-secondary rounded-md text-md text-text-secondary appearance-none focus:outline-none focus:border-border-accent-purple"
                  required
                >
                  <option value="sunday">Sunday</option>
                  <option value="monday">Monday</option>
                  <option value="tuesday">Tuesday</option>
                  <option value="wednesday">Wednesday</option>
                  <option value="thursday">Thursday</option>
                  <option value="friday">Friday</option>
                  <option value="saturday">Saturday</option>
                </select>
                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary pointer-events-none" />
              </div>
              <p className="text-xs text-text-secondary mt-2">
                Select the first day of your work week (default: Monday)
              </p>
            </div>

            <Input
              icon={Globe}
              placeholder="Website"
              name="website"
              value={formData.website}
              onChange={handleChange}
            />

            <Input
              icon={MapPin}
              placeholder="Address"
              name="address"
              value={formData.address}
              onChange={handleChange}
            />
          </div>

          {/* Terms and Conditions Checkbox */}
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="termsAccepted"
              name="termsAccepted"
              checked={formData.termsAccepted}
              onChange={handleChange}
              className="mt-1 h-4 w-4 rounded border-border-secondary text-text-accent-purple focus:ring-text-accent-purple"
              required
            />
            <label htmlFor="termsAccepted" className="text-[13px] leading-5 text-text-secondary">
              By creating an account, you agree to our{' '}
              <a href="#" className="text-text-accent-purple hover:underline">Terms of Service</a> and{' '}
              <a href="#" className="text-text-accent-purple hover:underline">Privacy Policy</a>. Your subscription will start after you select your team size and complete payment.
            </label>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-12 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-normal text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Creating Account...</span>
              </>
            ) : (
              <>
                <span>Create Account</span>
                <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                  <ArrowRight className="h-3 w-3 text-[#CB30E0]" />
                </div>
              </>
            )}
          </button>

          {/* Sign In Link */}
          <p className="text-center text-md font-medium text-text-secondary">
            Already have an account?{' '}
            <Link to="/login" className="text-text-accent-purple hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>


    </div>
  );
};

export default SignupPage;