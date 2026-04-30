import React, { useState, useEffect } from 'react';
import { Users, Minus, Plus, ArrowRight, Loader2, Calendar, Check } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { submitTeamSize } from '../../services/signup';
import { startTrial } from '../../services/billing';
import { createStripeCustomer, USE_STRIPE } from '../../services/stripe';
import { auth } from '../../firebase/client';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/client';

// Reusable Seat Option Card Component
const SeatOptionCard = ({ seats, isSelected, onClick }) => {
    return (
        <button
            onClick={onClick}
            className={`w-[75px] h-[87px] rounded-base flex flex-col items-center justify-center gap-2 transition-all ${isSelected
                ? 'bg-bg-accent-purple-light border-2 border-border-accent-purple'
                : 'border border-border-secondary hover:border-border-accent-purple'
                }`}
        >
            <div className="flex-shrink-0">
                <Users
                    className={`h-6 w-6 ${isSelected ? 'text-text-primary' : 'text-text-secondary'
                        }`}
                />
            </div>
            <span
                className={`text-md font-medium leading-tight ${isSelected ? 'text-text-primary' : 'text-text-secondary'
                    }`}
            >
                {seats} {seats === 1 ? 'Seat' : 'Seats'}
            </span>
        </button>
    );
};

// Main Team Size Selection Page
const TeamSizeSelection = () => {
    const seatOptions = [1, 5, 10, 25, 50];
    const navigate = useNavigate();
    const location = useLocation();
    const companyId = location?.state?.companyId;
    const { switchRole } = useAuth();
    const [selectedSeats, setSelectedSeats] = useState(5);
    const [schedulingEnabled, setSchedulingEnabled] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const pricePerSeat = 5.00;
    const schedulingPrice = 2.50;

    // Add debugging and cleanup
    useEffect(() => {
        console.log('TeamSizeSelectionPage mounted');
        console.log('Location state:', location?.state);
        console.log('CompanyId:', companyId);

        if (!companyId) {
            console.error('No companyId found in location state');
        }

        // Cleanup function to clear signup flag if user navigates away
        return () => {
            const currentPath = window.location.pathname;
            if (!currentPath.includes('team-size-selection')) {
                localStorage.removeItem('signupInProgress');
            }
        };
    }, [location?.state, companyId]);

    const handleSeatOptionClick = (seats) => {
        setSelectedSeats(seats);
    };

    const handleIncrement = () => {
        setSelectedSeats(prev => prev + 1);
    };

    const handleDecrement = () => {
        if (selectedSeats > 1) {
            setSelectedSeats(prev => prev - 1);
        }
    };

    const handleCustomSeatsChange = (e) => {
        const value = parseInt(e.target.value) || 1;
        setSelectedSeats(Math.max(1, value));
    };

    const seatCost = selectedSeats * pricePerSeat;
    const addonCost = schedulingEnabled ? schedulingPrice : 0;
    const totalCost = (seatCost + addonCost).toFixed(2);

    const handlePayment = async () => {
        console.log('handlePayment called with companyId:', companyId, 'selectedSeats:', selectedSeats);

        if (!companyId) {
            console.error('Missing companyId from signup step');
            alert('Missing companyId from signup step. Please redo signup.');
            navigate('/signup');
            return;
        }

        try {
            setIsSubmitting(true);
            console.log('Submitting team size...');

            const addOns = {
                scheduling: schedulingEnabled
            };

            await submitTeamSize(companyId, selectedSeats, addOns);
            console.log('Team size submitted successfully');

            try {
                console.log('Initializing billing trial state...');
                await startTrial(companyId, selectedSeats);
                console.log('Trial initialized successfully');

                // Create Stripe customer if Stripe is enabled
                if (USE_STRIPE && auth.currentUser) {
                    try {
                        console.log('Creating Stripe customer...');
                        // Get company name for Stripe customer
                        const companyRef = doc(db, 'companies', companyId);
                        const companySnap = await getDoc(companyRef);
                        const companyName = companySnap.exists() ? companySnap.data().name : 'Company';

                        const customerId = await createStripeCustomer(
                            companyId,
                            auth.currentUser.email,
                            companyName
                        );
                        console.log('Stripe customer created:', customerId);
                    } catch (stripeError) {
                        console.error('Failed to create Stripe customer:', stripeError);
                        // Don't block the flow - customer can be created later
                        console.warn('Continuing without Stripe customer - will be created on first payment');
                    }
                }
            } catch (billingError) {
                console.error('Failed to initialize billing trial:', billingError);
                alert('We created your seats but failed to prepare billing. Please contact support before proceeding.');
                setIsSubmitting(false);
                return;
            }

            // Clear the signup flag first to allow AuthContext to process the user
            console.log('Clearing signupInProgress flag to allow auth processing');
            localStorage.removeItem('signupInProgress');

            // Force a page reload to ensure AuthContext processes the authenticated user
            console.log('Reloading page to ensure proper auth state');
            window.location.href = '/';
        } catch (err) {
            console.error('Error in handlePayment:', err);
            alert('Failed to set team size. Please try again.');
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen bg-white relative overflow-hidden flex items-center justify-center p-4">
            {/* Background Image */}
            <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.5] pointer-events-none"
                style={{ backgroundImage: "url('/Authbg.png')" }}
            ></div>

            {/* Main Container */}
            <div className="w-full max-w-[520px] bg-white rounded-[24px] shadow-[0_14px_42px_rgba(8,15,52,0.06)] p-6 relative z-10">
                <div className="space-y-5">
                    {/* Title */}
                    <h2 className="text-xl font-semibold text-text-primary">Select Team Size</h2>

                    {/* Seat Options */}
                    <div className="flex  flex-wrap justify-center gap-4">
                        {seatOptions.map((seats) => (
                            <SeatOptionCard
                                key={seats}
                                seats={seats}
                                isSelected={selectedSeats === seats}
                                onClick={() => handleSeatOptionClick(seats)}
                            />
                        ))}
                    </div>

                    {/* Divider with "Or" */}
                    <div className="flex items-center gap-5">
                        <div className="flex-1 border-t border-border-secondary"></div>
                        <span className="text-md font-medium text-text-secondary">Or</span>
                        <div className="flex-1 border-t border-border-secondary"></div>
                    </div>

                    {/* Custom Seat Counter */}
                    <div className="flex items-center justify-center gap-5">
                        <button
                            onClick={handleDecrement}
                            disabled={selectedSeats <= 1}
                            className="w-[34px] h-[36px] flex items-center justify-center border border-border-secondary rounded-base hover:border-border-accent-purple disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Minus className="h-6 w-6 text-text-accent-purple" />
                        </button>

                        <input
                            type="number"
                            value={selectedSeats}
                            onChange={handleCustomSeatsChange}
                            min="1"
                            className="w-[138px] h-[45px] border border-border-secondary rounded-base text-center text-md font-semibold text-text-primary focus:outline-none focus:border-border-accent-purple [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />

                        <button
                            onClick={handleIncrement}
                            className="w-[34px] h-[36px] flex items-center justify-center border border-border-secondary rounded-base hover:border-border-accent-purple transition-colors"
                        >
                            <Plus className="h-6 w-6 text-text-accent-purple" />
                        </button>
                    </div>

                    {/* Add-ons Section */}
                    <div className="space-y-3">
                        <label className="text-[13px] font-medium text-text-secondary uppercase tracking-wider block">Recommended Add-on</label>
                        <div
                            onClick={() => setSchedulingEnabled(!schedulingEnabled)}
                            className={`relative border rounded-xl p-4 cursor-pointer transition-all ${schedulingEnabled
                                ? 'border-text-accent-purple bg-bg-accent-purple-light/30'
                                : 'border-border-secondary hover:border-gray-300'
                                }`}
                        >
                            <div className="flex items-start gap-4">
                                <div className={`p-2 rounded-lg ${schedulingEnabled ? 'bg-bg-accent-purple-light text-text-accent-purple' : 'bg-gray-100 text-text-secondary'}`}>
                                    <Calendar className="h-5 w-5" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <h4 className="font-semibold text-text-primary text-sm">Shift Scheduling & Roster</h4>
                                            <p className="text-xs text-text-secondary mt-1">Manage team shifts, availability, and time-off requests.</p>
                                        </div>
                                        <div className="text-right">
                                            <span className="block font-bold text-text-primary text-sm">£{schedulingPrice.toFixed(2)}</span>
                                            <span className="text-[10px] text-text-secondary">/month flat fee</span>
                                        </div>
                                    </div>
                                </div>
                                <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors flex-shrink-0 ${schedulingEnabled ? 'border-text-accent-purple bg-text-accent-purple' : 'border-border-secondary'
                                    }`}>
                                    {schedulingEnabled && <Check className="h-3 w-3 text-white" />}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Subscription Summary */}
                    <div className="border border-border-secondary rounded-base p-4 space-y-6">
                        <h3 className="text-xl font-semibold text-text-primary">Subscription Summary</h3>

                        <div className="space-y-3">
                            {/* Selected Seats */}
                            <div className="flex justify-between items-center">
                                <span className="text-[13px] text-text-secondary">Selected seats:</span>
                                <span className="text-md font-semibold text-text-primary">{selectedSeats} seats</span>
                            </div>

                            {/* Price per seat */}
                            <div className="flex justify-between items-center">
                                <span className="text-[13px] text-text-secondary">Price per seat per month:</span>
                                <span className="text-md font-semibold text-text-primary">£{pricePerSeat.toFixed(2)}</span>
                            </div>

                            {/* Add-on Summary Line (if enabled) */}
                            {schedulingEnabled && (
                                <div className="flex justify-between items-center text-text-accent-purple">
                                    <span className="text-[13px]">Shift Scheduling Add-on:</span>
                                    <span className="text-md font-semibold">£{schedulingPrice.toFixed(2)}</span>
                                </div>
                            )}
                        </div>

                        {/* Divider */}
                        <div className="border-t border-border-secondary"></div>

                        {/* Total Cost */}
                        <div className="flex justify-between items-center">
                            <span className="text-md font-semibold text-text-primary">Total monthly cost:</span>
                            <span className="text-md font-semibold text-text-primary">£{totalCost}</span>
                        </div>

                        {/* Trial Info Box */}
                        <div className="bg-purple-50 border border-border-accent-purple rounded-lg p-4">
                            <p className="text-md text-text-accent-purple text-center leading-5">
                                14-day free trial included! Your subscription will start after the trial period.
                                <br />
                                <br />
                                You can modify your seat count anytime during or after the trial.
                            </p>
                        </div>
                    </div>

                    {/* Payment Button */}
                    <button
                        type="submit"
                        onClick={handlePayment}
                        disabled={isSubmitting}
                        className="w-full h-12 bg-[linear-gradient(91.36deg,#AF54DD_4.75%,#7617A7_96.14%)] text-white rounded-base font-normal text-md flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-70 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="h-5 w-5 animate-spin" />
                                <span>Processing...</span>
                            </>
                        ) : (
                            <>
                                <span>Create Seats & Pay £{totalCost}</span>
                                <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center">
                                    <ArrowRight className="h-3 w-3 text-[#CB30E0]" />
                                </div>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TeamSizeSelection;