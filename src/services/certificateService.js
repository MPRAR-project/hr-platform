import hrApiClient from '../lib/hrApiClient';

/**
 * Certificate Service (Phase 4 — REST Migration)
 * 
 * Handles training certificate uploads and management via the HR REST API.
 * Replaces Firebase Storage with the centralized REST upload endpoint.
 */
class CertificateService {
  constructor() {
    this.allowedFileTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
  }

  /**
   * Upload certificate file to REST API
   */
  async uploadCertificateFile(file) {
    try {
      // Validate file
      if (!this.allowedFileTypes.includes(file.type)) {
        throw new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.');
      }
      if (file.size > this.maxFileSize) {
        throw new Error('File size too large. Maximum size is 10MB.');
      }

      const formData = new FormData();
      formData.append('file', file);

      const { data } = await hrApiClient.post('/hr/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      return {
        success: true,
        data: {
          fileName: data.fileName,
          storagePath: data.fileKey,
          downloadURL: data.url,
          fileSize: data.size,
          fileType: data.mimeType
        }
      };
    } catch (error) {
      console.error('[CertificateService] Upload failed:', error);
      throw error;
    }
  }

  /**
   * Submit certificate for training assignment
   */
  async submitCertificate(assignmentId, file, userId, companyId, notes = null, title = null) {
    try {
      // 1. Upload file first
      const uploadResult = await this.uploadCertificateFile(file);
      
      // 2. Submit record to backend
      const { data } = await hrApiClient.post(`/hr/training/${assignmentId}/certificate`, {
        title: title || uploadResult.data.fileName,
        fileName: uploadResult.data.fileName,
        fileUrl: uploadResult.data.downloadURL,
        fileSize: uploadResult.data.fileSize,
        fileType: uploadResult.data.fileType,
        notes
      });

      return { success: true, data };
    } catch (error) {
      console.error('[CertificateService] Submit failed:', error);
      throw error;
    }
  }

  /**
   * Get certificates for an assignment
   */
  async getCertificatesForAssignment(assignmentId) {
    try {
      const { data } = await hrApiClient.get('/hr/training/assignments', {
        params: { id: assignmentId }
      });
      // Assignments typically include certificates in the new model or we fetch them separately
      // For now, let's assume we fetch assignments and extract the certificate info
      const assignment = data[0] || data.assignments?.[0];
      return { success: true, data: assignment?.certificate ? [assignment.certificate] : [] };
    } catch (error) {
      console.error('[CertificateService] Fetch failed:', error);
      throw error;
    }
  }

  /**
   * Approve certificate
   */
  async approveCertificate(certificateId, approvedBy, userRole, companyId, notes = null) {
    try {
      const { data } = await hrApiClient.post(`/hr/training/certificates/${certificateId}/approve`, { notes });
      return { success: true, data };
    } catch (error) {
      console.error('[CertificateService] Approval failed:', error);
      throw error;
    }
  }

  /**
   * Decline certificate
   */
  async declineCertificate(certificateId, declinedBy, userRole, companyId, reason) {
    try {
      const { data } = await hrApiClient.post(`/hr/training/certificates/${certificateId}/decline`, { reason });
      return { success: true, data };
    } catch (error) {
      console.error('[CertificateService] Decline failed:', error);
      throw error;
    }
  }

  /**
   * Get pending certificates for approval (managers only)
   */
  async getPendingCertificates() {
    try {
      const { data } = await hrApiClient.get('/hr/training/assignments', {
        params: { status: 'pending_approval' }
      });
      return { success: true, data: data.map(a => a.certificate).filter(Boolean) };
    } catch (error) {
      console.error('[CertificateService] Fetch pending failed:', error);
      throw error;
    }
  }

  async getCertificateById(id) {
    try {
      const { data } = await hrApiClient.get(`/hr/certificates/${id}`);
      return { success: true, data };
    } catch (error) {
      console.error('[CertificateService] Fetch certificate failed:', error);
      throw error;
    }
  }
}

export const certificateService = new CertificateService();
export default certificateService;