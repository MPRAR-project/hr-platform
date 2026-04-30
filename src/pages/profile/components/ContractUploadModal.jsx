import React, { useState } from 'react';
import { Upload, X, FileText, AlertCircle } from 'lucide-react';
import Button from '../../../components/ui/Button';
import { uploadContract } from '../../../services/contractService';
import { toast } from 'react-toastify';
import { useAuth } from '../../../hooks/useAuth';

const ContractUploadModal = ({ isOpen, onClose, userId, onUploadSuccess }) => {
    const { user } = useAuth();
    const [file, setFile] = useState(null);
    const [title, setTitle] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleFileChange = (e) => {
        const selectedFile = e.target.files[0];
        if (selectedFile) {
            if (selectedFile.type !== 'application/pdf') {
                setError('Only PDF files are allowed.');
                setFile(null);
                return;
            }
            if (selectedFile.size > 5 * 1024 * 1024) { // 5MB limit
                setError('File size must be less than 5MB.');
                setFile(null);
                return;
            }
            setError('');
            setFile(selectedFile);
            // Auto-set title from filename if empty
            if (!title) {
                setTitle(selectedFile.name.replace('.pdf', ''));
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file || !title) return;

        try {
            setIsUploading(true);
            const metadata = {
                title,
                type: 'Employment Contract',
                uploadedBy: user.uid,
                uploadedByName: user.displayName || user.email
            };

            await uploadContract(userId, file, metadata);

            toast.success('Contract uploaded successfully');
            onUploadSuccess();
            handleClose();
        } catch (error) {
            console.error('Upload failed:', error);
            toast.error('Failed to upload contract');
        } finally {
            setIsUploading(false);
        }
    };

    const handleClose = () => {
        setFile(null);
        setTitle('');
        setError('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 m-4">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-semibold text-gray-900">Upload Contract</h2>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contract Title
                        </label>
                        <input
                            type="text"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder="e.g., Employment Contract 2024"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Contract File (PDF)
                        </label>
                        <div
                            className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md hover:border-purple-400 transition-colors cursor-pointer"
                            onClick={() => document.getElementById("pdfInput").click()}
                        >
                            <div className="space-y-1 text-center">
                                {file ? (
                                    <div className="flex flex-col items-center">
                                        <FileText className="mx-auto h-12 w-12 text-purple-500" />
                                        <p className="text-sm text-gray-900 font-medium">{file.name}</p>
                                        <p className="text-xs text-gray-500">
                                            {(file.size / 1024 / 1024).toFixed(2)} MB
                                        </p>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation(); // prevent dialog from opening
                                                setFile(null);
                                                setError('');
                                            }}
                                            className="mt-2 text-xs text-red-600 hover:text-red-800"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <Upload className="mx-auto h-12 w-12 text-gray-400" />
                                        <div className="flex text-sm text-gray-600">
                                            <span className="bg-white rounded-md font-medium text-purple-600">
                                                Upload a file
                                            </span>
                                            <p className="pl-1">or drag and drop</p>
                                        </div>
                                        <p className="text-xs text-gray-500">PDF up to 5MB</p>
                                    </>
                                )}
                            </div>

                            <input
                                id="pdfInput"
                                type="file"
                                className="hidden"
                                accept=".pdf"
                                onChange={handleFileChange}
                            />
                        </div>

                        {error && (
                            <div className="mt-2 flex items-center text-sm text-red-600">
                                <AlertCircle className="w-4 h-4 mr-1" />
                                {error}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 mt-6">
                        <Button
                            variant="secondary"
                            onClick={handleClose}
                            disabled={isUploading}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            type="submit"
                            disabled={!file || !title || isUploading}
                            isLoading={isUploading}
                        >
                            {isUploading ? 'Uploading...' : 'Upload Contract'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ContractUploadModal;
