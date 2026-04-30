import { ArrowRight, CheckCircle } from "lucide-react";
import Button from "../ui/Button";

const SuccessModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[7.5px]" onClick={onClose}></div>
      
      <div className="relative w-full max-w-[500px] bg-white rounded-[24px] shadow-[0_4px_20px_rgba(0,0,0,0.1)] p-8">
        <div className="text-center space-y-6">
          {/* Success Icon */}
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="h-10 w-10 text-green-600" />
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-text-primary">
            Request Sent Successfully!
          </h2>

          {/* Message */}
          <p className="text-text-secondary">
            Your seat request has been successfully submitted to the site manager for review. You will receive a notification once it's processed.
          </p>

          {/* Action Button */}
          <Button 
            variant="gradient" 
            onClick={onClose}
            icon={ArrowRight}
            cn="w-full h-12"
          >
            Got it!
          </Button>
        </div>
      </div>
    </div>
  );
};
export default SuccessModal;