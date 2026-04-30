/**
 * Certificate Service - Handles training certificate uploads and management
 * Manages file uploads, certificate validation, and approval workflows
 */

import { db } from '../firebase/client';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
  serverTimestamp
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'firebase/storage';
import { getManagedEmployeeIdsForManager } from './teams';

/**
 * Certificate Service Class
 */
class CertificateService {
  constructor() {
    this.collection = 'trainingCertificates';
    this.assignmentsCollection = 'trainingAssignments';
    this.storage = getStorage();
    this.allowedFileTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
  }

  /**
   * Upload certificate file to Firebase Storage
   */
  async uploadCertificateFile(file, assignmentId, userId) {
    try {
      // Validate file
      if (!this.allowedFileTypes.includes(file.type)) {
        throw new Error('Invalid file type. Only JPEG, PNG, and PDF files are allowed.');
      }

      if (file.size > this.maxFileSize) {
        throw new Error('File size too large. Maximum size is 10MB.');
      }

      // Create unique filename
      const timestamp = Date.now();
      const fileExtension = file.name.split('.').pop();
      const fileName = `certificates/${userId}/${assignmentId}_${timestamp}.${fileExtension}`;

      // Upload to Firebase Storage
      const storageRef = ref(this.storage, fileName);
      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      console.log('Certificate file uploaded successfully:', fileName);
      return {
        success: true,
        data: {
          fileName: file.name,
          storagePath: fileName,
          downloadURL,
          fileSize: file.size,
          fileType: file.type
        }
      };
    } catch (error) {
      console.error('Error uploading certificate file:', error);
      throw new Error(`Failed to upload certificate: ${error.message}`);
    }
  }

  /**
   * Submit certificate for training assignment
   */
  async submitCertificate(assignmentId, file, userId, companyId, notes = null, title = null, userRole = 'employee') {
    try {
      // Verify assignment exists
      const assignmentRef = doc(db, this.assignmentsCollection, assignmentId);
      const assignmentSnap = await getDoc(assignmentRef);

      if (!assignmentSnap.exists()) {
        throw new Error('Training assignment not found');
      }

      const assignment = assignmentSnap.data();

      // Permission check:
      // 1. User is the owner of the assignment
      // 2. User is an admin/manager in the same company
      // 3. User is a team manager for the assignment owner
      const isOwner = assignment.userId === userId;
      const isElevatedRole = ['siteManager', 'adminManager', 'hrManager', 'adminAdvisor', 'hrAdvisor', 'superUser'].includes(userRole);

      let hasAccess = isOwner || (isElevatedRole && assignment.companyId === companyId);

      if (!hasAccess && userRole === 'teamManager' && assignment.companyId === companyId) {
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
        if (managedEmployeeIds.has(assignment.userId)) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        throw new Error('Access denied: You do not have permission to upload certificates for this user');
      }

      // Check if assignment is in valid state for certificate submission
      const validStatuses = ['assigned', 'in_progress', 'declined', 'pending_approval'];
      if (!validStatuses.includes(assignment.status)) {
        throw new Error(`Cannot submit certificate. Assignment status: ${assignment.status}`);
      }

      // Upload file
      const uploadResult = await this.uploadCertificateFile(file, assignmentId, assignment.userId);
      if (!uploadResult.success) {
        throw new Error('Failed to upload certificate file');
      }

      // Reuse existing certificate record if it exists, otherwise create new one
      let certificateRef;
      if (assignment.certificateId) {
        certificateRef = doc(db, this.collection, assignment.certificateId);
        console.log('Reusing existing certificate record:', assignment.certificateId);
      } else {
        certificateRef = doc(collection(db, this.collection));
      }
      
      const now = serverTimestamp();

      const certificate = {
        id: certificateRef.id,
        assignmentId,
        userId: assignment.userId,
        companyId,
        fileName: uploadResult.data.fileName,
        title: title || uploadResult.data.fileName,
        storagePath: uploadResult.data.storagePath,
        fileUrl: uploadResult.data.downloadURL,
        fileSize: uploadResult.data.fileSize,
        fileType: uploadResult.data.fileType,
        status: 'pending_approval',
        notes: notes || null,
        uploadedBy: userId,
        uploadedAt: now,
        createdAt: now,
        updatedAt: now
      };

      await setDoc(certificateRef, certificate);

      // Update assignment status to pending approval
      await updateDoc(assignmentRef, {
        status: 'pending_approval',
        certificateId: certificateRef.id,
        certificateUploadedBy: userId,
        updatedAt: now
      });

      console.log('Certificate submitted successfully:', certificate.id);
      return { success: true, data: certificate };
    } catch (error) {
      console.error('Error submitting certificate:', error);
      throw new Error(`Failed to submit certificate: ${error.message}`);
    }
  }

  /**
   * Get certificates for an assignment
   */
  async getCertificatesForAssignment(assignmentId, userId, userRole, companyId) {
    try {
      const certificatesQuery = query(
        collection(db, this.collection),
        where('assignmentId', '==', assignmentId)
      );

      const snapshot = await getDocs(certificatesQuery);
      let certificates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by uploadedAt in descending order (client-side)
      certificates.sort((a, b) => {
        const dateA = a.uploadedAt?.toDate ? a.uploadedAt.toDate() : new Date(a.uploadedAt || 0);
        const dateB = b.uploadedAt?.toDate ? b.uploadedAt.toDate() : new Date(b.uploadedAt || 0);
        return dateB - dateA;
      });

      // Verify access permissions
      for (const certificate of certificates) {
        if (certificate.companyId !== companyId) {
          throw new Error('Access denied: Certificate not in your company');
        }

        // For team managers, verify they can access this user's certificates
        if (userRole === 'teamManager' && certificate.userId !== userId) {
          const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
          if (!managedEmployeeIds.has(certificate.userId)) {
            throw new Error('Access denied: Certificate not in your team scope');
          }
        }

        // Regular employees can only see their own certificates
        if (userRole === 'employee' && certificate.userId !== userId) {
          throw new Error('Access denied: You can only view your own certificates');
        }
      }

      console.log(`Retrieved ${certificates.length} certificates for assignment ${assignmentId}`);
      return { success: true, data: certificates };
    } catch (error) {
      console.error('Error fetching certificates:', error);
      throw new Error(`Failed to fetch certificates: ${error.message}`);
    }
  }

  /**
   * Approve certificate
   */
  async approveCertificate(certificateId, approvedBy, userRole, companyId, notes = null) {
    try {
      const certificateRef = doc(db, this.collection, certificateId);
      const certificateSnap = await getDoc(certificateRef);

      if (!certificateSnap.exists()) {
        throw new Error('Certificate not found');
      }

      const certificate = certificateSnap.data();

      // Verify company access
      if (certificate.companyId !== companyId) {
        throw new Error('Access denied: Certificate not in your company');
      }

      // Verify approval permissions
      const canApproveRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor', 'siteManager', 'teamManager'];
      if (!canApproveRoles.includes(userRole)) {
        throw new Error('Access denied: Insufficient permissions to approve certificates');
      }

      // Prevent self-approval: users cannot approve their own certificates
      if (certificate.userId === approvedBy) {
        throw new Error('Access denied: You cannot approve your own training certificate');
      }

      // For team managers, verify they can manage this user
      if (userRole === 'teamManager') {
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(approvedBy, companyId);
        if (!managedEmployeeIds.has(certificate.userId)) {
          throw new Error('Access denied: User not in your team');
        }
      }

      // Check current status
      if (certificate.status !== 'pending_approval') {
        throw new Error(`Cannot approve certificate. Current status: ${certificate.status}`);
      }

      const now = serverTimestamp();

      // Update certificate status
      await updateDoc(certificateRef, {
        status: 'approved',
        approvedBy,
        approvedAt: now,
        approvalNotes: notes,
        updatedAt: now
      });

      // Update assignment status to completed
      const assignmentRef = doc(db, this.assignmentsCollection, certificate.assignmentId);
      await updateDoc(assignmentRef, {
        status: 'completed',
        completedDate: now,
        approvedBy,
        updatedAt: now
      });

      console.log('Certificate approved successfully:', certificateId);
      return { success: true, data: { id: certificateId, status: 'approved' } };
    } catch (error) {
      console.error('Error approving certificate:', error);
      throw new Error(`Failed to approve certificate: ${error.message}`);
    }
  }

  /**
   * Decline certificate
   */
  async declineCertificate(certificateId, declinedBy, userRole, companyId, reason) {
    try {
      if (!reason || reason.trim().length === 0) {
        throw new Error('Decline reason is required');
      }

      const certificateRef = doc(db, this.collection, certificateId);
      const certificateSnap = await getDoc(certificateRef);

      if (!certificateSnap.exists()) {
        throw new Error('Certificate not found');
      }

      const certificate = certificateSnap.data();

      // Verify company access
      if (certificate.companyId !== companyId) {
        throw new Error('Access denied: Certificate not in your company');
      }

      // Verify decline permissions
      const canDeclineRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor', 'siteManager', 'teamManager'];
      if (!canDeclineRoles.includes(userRole)) {
        throw new Error('Access denied: Insufficient permissions to decline certificates');
      }

      // Prevent self-approval: users cannot decline their own certificates
      if (certificate.userId === declinedBy) {
        throw new Error('Access denied: You cannot decline your own training certificate');
      }

      // For team managers, verify they can manage this user
      if (userRole === 'teamManager') {
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(declinedBy, companyId);
        if (!managedEmployeeIds.has(certificate.userId)) {
          throw new Error('Access denied: User not in your team');
        }
      }

      // Check current status
      if (certificate.status !== 'pending_approval') {
        throw new Error(`Cannot decline certificate. Current status: ${certificate.status}`);
      }

      const now = serverTimestamp();

      // Update certificate status
      await updateDoc(certificateRef, {
        status: 'declined',
        declinedBy,
        declinedAt: now,
        declineReason: reason,
        updatedAt: now
      });

      // Update assignment status back to assigned for resubmission
      const assignmentRef = doc(db, this.assignmentsCollection, certificate.assignmentId);
      await updateDoc(assignmentRef, {
        status: 'declined',
        declinedBy,
        declineReason: reason,
        updatedAt: now
      });

      console.log('Certificate declined successfully:', certificateId);
      return { success: true, data: { id: certificateId, status: 'declined', reason } };
    } catch (error) {
      console.error('Error declining certificate:', error);
      throw new Error(`Failed to decline certificate: ${error.message}`);
    }
  }

  /**
   * Delete certificate and file
   */
  async deleteCertificate(certificateId, userId, userRole, companyId) {
    try {
      const certificateRef = doc(db, this.collection, certificateId);
      const certificateSnap = await getDoc(certificateRef);

      if (!certificateSnap.exists()) {
        throw new Error('Certificate not found');
      }

      const certificate = certificateSnap.data();

      // Verify company access
      if (certificate.companyId !== companyId) {
        throw new Error('Access denied: Certificate not in your company');
      }

      // Only allow deletion by certificate owner or elevated roles
      const elevatedRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'siteManager'];
      if (certificate.userId !== userId && !elevatedRoles.includes(userRole)) {
        throw new Error('Access denied: You can only delete your own certificates');
      }

      // For team managers, verify they can manage this user
      if (userRole === 'teamManager' && certificate.userId !== userId) {
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
        if (!managedEmployeeIds.has(certificate.userId)) {
          throw new Error('Access denied: User not in your team');
        }
      }

      // Delete file from storage
      try {
        const fileRef = ref(this.storage, certificate.storagePath);
        await deleteObject(fileRef);
        console.log('Certificate file deleted from storage:', certificate.storagePath);
      } catch (storageError) {
        console.warn('Failed to delete file from storage:', storageError);
        // Continue with database deletion even if file deletion fails
      }

      // Delete certificate record
      await certificateRef.delete();

      // Update assignment status if this was the active certificate
      const assignmentRef = doc(db, this.assignmentsCollection, certificate.assignmentId);
      const assignmentSnap = await getDoc(assignmentRef);

      if (assignmentSnap.exists()) {
        const assignment = assignmentSnap.data();
        if (assignment.certificateId === certificateId) {
          await updateDoc(assignmentRef, {
            status: 'assigned',
            certificateId: null,
            updatedAt: serverTimestamp()
          });
        }
      }

      console.log('Certificate deleted successfully:', certificateId);
      return { success: true };
    } catch (error) {
      console.error('Error deleting certificate:', error);
      throw new Error(`Failed to delete certificate: ${error.message}`);
    }
  }

  /**
   * Get certificates for a user (for their profile/dashboard)
   */
  async getUserCertificates(userId, companyId) {
    try {
      const certificatesQuery = query(
        collection(db, this.collection),
        where('userId', '==', userId),
        where('companyId', '==', companyId),
        where('status', '==', 'approved')
      );

      const snapshot = await getDocs(certificatesQuery);
      const certificates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by approvedAt in descending order (client-side)
      certificates.sort((a, b) => {
        const dateA = a.approvedAt?.toDate ? a.approvedAt.toDate() : new Date(a.approvedAt || 0);
        const dateB = b.approvedAt?.toDate ? b.approvedAt.toDate() : new Date(b.approvedAt || 0);
        return dateB - dateA;
      });

      console.log(`Retrieved ${certificates.length} approved certificates for user ${userId}`);
      return { success: true, data: certificates };
    } catch (error) {
      console.error('Error fetching user certificates:', error);
      throw new Error(`Failed to fetch user certificates: ${error.message}`);
    }
  }

  /**
   * Get pending certificates for approval (managers only)
   */
  async getPendingCertificates(companyId, userRole, userId) {
    try {
      const canViewRoles = ['adminManager', 'adminAdvisor', 'hrManager', 'hrAdvisor', 'siteManager', 'teamManager'];
      if (!canViewRoles.includes(userRole)) {
        throw new Error('Access denied: Insufficient permissions to view pending certificates');
      }

      const certificatesQuery = query(
        collection(db, this.collection),
        where('companyId', '==', companyId),
        where('status', '==', 'pending_approval')
      );

      const snapshot = await getDocs(certificatesQuery);
      let certificates = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by uploadedAt in ascending order (oldest first for pending approvals)
      certificates.sort((a, b) => {
        const dateA = a.uploadedAt?.toDate ? a.uploadedAt.toDate() : new Date(a.uploadedAt || 0);
        const dateB = b.uploadedAt?.toDate ? b.uploadedAt.toDate() : new Date(b.uploadedAt || 0);
        return dateA - dateB;
      });

      // Filter for team managers
      if (userRole === 'teamManager') {
        const managedEmployeeIds = await getManagedEmployeeIdsForManager(userId, companyId);
        certificates = certificates.filter(certificate =>
          managedEmployeeIds.has(certificate.userId)
        );
      }

      console.log(`Retrieved ${certificates.length} pending certificates for approval`);
      return { success: true, data: certificates };
    } catch (error) {
      console.error('Error fetching pending certificates:', error);
      throw new Error(`Failed to fetch pending certificates: ${error.message}`);
    }
  }
}

// Export singleton instance
export const certificateService = new CertificateService();
export default certificateService;