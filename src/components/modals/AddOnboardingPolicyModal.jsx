import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import Button from '../ui/Button';

const CATEGORY_OPTIONS = [
  { value: 'employment', label: 'Employment Contract' },
  { value: 'policy', label: 'Policy / Handbook' },
  { value: 'safety', label: 'Health & Safety' },
  { value: 'other', label: 'Other' }
];

const AddOnboardingPolicyModal = ({ isOpen, onClose, onSubmit, isLoading }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('employment');
  const [isRequired, setIsRequired] = useState(true);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setCategory('employment');
    setIsRequired(true);
    setFile(null);
    setError(null);
  };

  const handleClose = () => {
    if (isLoading) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Please provide a title for this document.');
      return;
    }
    if (!file) {
      setError('Please attach a document file to upload.');
      return;
    }
    setError(null);
    await onSubmit({
      title: title.trim(),
      description: description.trim(),
      category,
      isRequired,
      file
    });
    if (!isLoading) {
      resetForm();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 px-4">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-2xl border border-border-primary">
        <div className="flex items-center justify-between border-b border-border-primary px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Add Onboarding Document</h2>
            <p className="text-sm text-text-secondary">
              Upload policies or contracts employees need to acknowledge in onboarding.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="text-text-secondary hover:text-text-primary"
            disabled={isLoading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">
              Document Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Employment Contract"
              className="w-full border border-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-border-accent-purple"
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="text-sm font-medium text-text-primary block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for employees..."
              rows={3}
              className="w-full border border-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-border-accent-purple resize-none"
              disabled={isLoading}
            />
          </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <div>
      <label className="text-sm font-medium text-text-primary block mb-1">Category</label>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="w-full border border-border-primary rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-border-accent-purple"
        disabled={isLoading}
      >
        {CATEGORY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
    <div>
      <label className="text-sm font-medium text-text-primary block mb-1">Required Acknowledgement</label>
      <div className="h-10 border border-border-primary rounded-lg px-4 flex items-center justify-between">
        <span className="text-sm text-text-secondary">
          {isRequired ? 'Required for completion' : 'Optional document'}
        </span>
        <button
          type="button"
          className={`w-12 h-6 rounded-full flex items-center transition ${
            isRequired ? 'bg-purple-600 justify-end' : 'bg-gray-300 justify-start'
          }`}
          onClick={() => setIsRequired((prev) => !prev)}
          disabled={isLoading}
        >
          <span className="w-5 h-5 bg-white rounded-full shadow" />
        </button>
      </div>
    </div>
  </div>

  <div>
    <label className="text-sm font-medium text-text-primary block mb-1">
      Upload Document <span className="text-red-500">*</span>
    </label>
    <label
      className="border-2 border-dashed border-border-primary rounded-lg py-6 px-4 text-center flex flex-col items-center gap-2 cursor-pointer hover:border-border-accent-purple transition"
    >
      <Upload className="h-6 w-6 text-text-secondary" />
      <span className="text-sm text-text-secondary">
        {file ? file.name : 'Drag & drop or click to browse'}
      </span>
      <input
        type="file"
        className="hidden"
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        disabled={isLoading}
      />
    </label>
  </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline-secondary" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? 'Uploading...' : 'Upload Document'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddOnboardingPolicyModal;

