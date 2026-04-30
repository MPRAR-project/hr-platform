import { AlertTriangle, ArrowLeft, MapPin, Navigation } from "lucide-react";
import Button from "../../components/ui/Button";

const RestrictedAccessPage = ({ onBack, onRefresh, onGetDirection }) => {


  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-pink-50 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="h-10 w-10 text-red-500" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Access Restricted</h1>
          <p className="text-gray-600">You cannot access the clock-in system from your current location.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-2 text-green-600 mb-3">
                <MapPin className="h-5 w-5" />
                <h3 className="font-semibold">Required Location</h3>
              </div>
              <p className="text-sm text-gray-700 font-medium mb-1">Main Office</p>
              <p className="text-sm text-gray-600 mb-2">123 Business Street, New York, NY</p>
              <p className="text-sm text-green-600 font-medium">Within 100m Radius</p>
            </div>

            <div>
              <div className="flex items-center gap-2 text-red-600 mb-3">
                <Navigation className="h-5 w-5" />
                <h3 className="font-semibold">Your Location</h3>
              </div>
              <p className="text-sm text-gray-700 font-medium mb-1">Current Position</p>
              <p className="text-sm text-gray-600 mb-2">Lat: 40.758900, Lng: -73.985100</p>
              <p className="text-sm text-red-600 font-medium">5420m Away From Office</p>
            </div>
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mt-6">
            <h4 className="text-sm font-semibold text-purple-900 mb-2">What you need to do:</h4>
            <ul className="space-y-1 text-sm text-purple-800">
              <li>• Move to within 100 meters of the Main Office</li>
              <li>• Ensure your device's location services are enabled</li>
              <li>• Contact your manager if you need assistance</li>
            </ul>
          </div>

          <div className="flex flex-row md:flex-nowrap flex-wrap gap-4 mt-6">
            <Button
              onClick={onBack}
              variant="outline-secondary"
              icon={ArrowLeft}
              iconFirst={true}
              cn="h-12 w-full"
            >
              Back to Dashboard
            </Button>
            <Button
              onClick={onRefresh}
              icon={Navigation}
              variant="outline-primary"
              cn="h-12 w-full"
            >
              Refresh Location
            </Button>
            <Button
              icon={MapPin}
              iconFirst={true}
              variant="primary"
              cn="h-12 w-full"
            >

              Get Directions
            </Button>
          </div>
        </div>

        <div className="text-center space-y-2">
          <p className="text-sm text-gray-600">Need help? Contact your site manager or HR department.</p>
          <p className="text-xs text-gray-500">This location restriction is managed by your site manager.</p>
        </div>
      </div>
    </div>
  );
};
export default RestrictedAccessPage;