import React, { useState } from 'react';
import { Camera, User, Upload, X } from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { storage, db } from "../../../firebase/client"
import { toast } from 'react-toastify';
import Button from '../../../components/ui/Button';

const ProfilePictureUpload = ({ userId, currentPrifileImage, userName, onPhotoUpdate }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewURL, setPreviewURL] = useState(null);

  // Get default avatar (User icon outline)
  const defaultAvatar = null; // Will show User icon

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size must be less than 5MB');
      return;
    }

    setSelectedFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewURL(reader.result);
    };
    reader.readAsDataURL(file);
    
    setShowUploadModal(true);
  };

  const handleUpload = async () => {
    if (!selectedFile || !userId) return;

    try {
      setIsUploading(true);

      // Create a unique filename
      const timestamp = Date.now();
      const filename = `profile-pictures/${userId}/${timestamp}-${selectedFile.name}`;
      
      // Upload to Firebase Storage
      const storageRef = ref(storage, filename);
      await uploadBytes(storageRef, selectedFile);
      
      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      
      // Update user document in Firestore
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        profileImage: downloadURL,
        updatedAt: new Date()
      });

      toast.success('Profile picture updated successfully!');
      
      // Notify parent component
      if (onPhotoUpdate) {
        onPhotoUpdate(downloadURL);
      }
      
      // Close modal and reset
      setShowUploadModal(false);
      setSelectedFile(null);
      setPreviewURL(null);
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      toast.error('Failed to upload profile picture. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    try {
      setIsUploading(true);
      
      // Update user document to remove profileImage
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        profileImage: null,
        updatedAt: new Date()
      });

      toast.success('Profile picture removed successfully!');
      
      // Notify parent component
      if (onPhotoUpdate) {
        onPhotoUpdate(null);
      }
    } catch (error) {
      console.error('Error removing profile picture:', error);
      toast.error('Failed to remove profile picture. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    setShowUploadModal(false);
    setSelectedFile(null);
    setPreviewURL(null);
  };

  return (
    <>
      {/* Profile Picture Display with Upload Button */}
      <div className="relative group">
        {currentPrifileImage ? (
          <img
            src={currentPrifileImage}
            alt={userName}
            className="w-16 h-16 rounded-full object-cover border-2 border-gray-200"
          />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
            <User className="h-8 w-8 text-gray-400" />
          </div>
        )}
        
        {/* Upload Button Overlay */}
        <label
          htmlFor="profile-picture-input"
          className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          <Camera className="h-6 w-6 text-white" />
          <input
            id="profile-picture-input"
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>

        {/* Remove Photo Button (only show if photo exists) */}
        {currentPrifileImage && (
          <button
            onClick={handleRemovePhoto}
            disabled={isUploading}
            className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors opacity-0 group-hover:opacity-100"
            title="Remove photo"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Upload Confirmation Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCancel}></div>

          <div className="relative w-full max-w-md bg-white rounded-lg shadow-lg p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">Upload Profile Picture</h3>
                <button
                  onClick={handleCancel}
                  className="w-6 h-6 flex items-center justify-center bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
                >
                  <X className="h-4 w-4 text-gray-600" />
                </button>
              </div>

              {/* Preview */}
              <div className="flex justify-center">
                <div className="relative">
                  {previewURL ? (
                    <img
                      src={previewURL}
                      alt="Preview"
                      className="w-32 h-32 rounded-full object-cover border-2 border-gray-200"
                    />
                  ) : (
                    <div className="w-32 h-32 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center">
                      <User className="h-16 w-16 text-gray-400" />
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>Tips:</strong> Use a clear, professional photo. Maximum file size: 5MB
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button
                  variant="outline-secondary"
                  onClick={handleCancel}
                  disabled={isUploading}
                  cn="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="gradient"
                  onClick={handleUpload}
                  disabled={isUploading || !selectedFile}
                  cn="flex-1"
                  icon={Upload}
                  iconFirst={true}
                >
                  {isUploading ? 'Uploading...' : 'Upload'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ProfilePictureUpload;