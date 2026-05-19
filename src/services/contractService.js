import hrApiClient from '../lib/hrApiClient';

/**
 * Genuinely refactored Contract Service
 * Communicates with the HR Backend (Postgres) instead of Firebase Firestore or Central.
 * Uses the /hr/documents endpoints since contracts are a type of HrDocument.
 */

export const uploadContract = async (userId, file, metadata) => {
    // 1. Upload File to HR Storage API
    const formData = new FormData();
    formData.append('file', file);
    
    const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });

    // 2. Save Metadata to HR PostgreSQL as a document
    const { data: docRes } = await hrApiClient.post('/hr/documents', {
        employeeId: userId,
        title: metadata.title || file.name,
        documentType: 'employment_contract',
        fileKey: uploadRes.fileKey,
        fileName: uploadRes.fileName,
        fileMimeType: uploadRes.mimeType,
        fileSizeBytes: uploadRes.size,
        fileUrl: uploadRes.url,
        isConfidential: true,
        requiresSignature: true,
        uploadedBy: metadata.uploadedBy || userId,
    });
    
    // Polyfill status based on signedAt
    return { ...docRes, status: docRes.signedAt ? 'signed' : 'pending', uploadedByName: metadata.uploadedByName || 'Manager' };
};

export const getContracts = async (userId, companyId) => {
    const { data } = await hrApiClient.get('/hr/documents', {
        params: { employeeId: userId, type: 'employment_contract' }
    });
    
    const docs = data.documents || data || [];
    
    // Map to the shape expected by the frontend
    return docs.map(doc => ({
        ...doc,
        status: doc.signedAt ? 'signed' : 'pending',
        uploadedByName: doc.employee ? `${doc.employee.firstName} ${doc.employee.lastName}`.trim() : 'Manager'
    }));
};

export const signContract = async (userId, contractId, signatureBlob, typedName, companyId) => {
    // 1. Upload signature image
    const formData = new FormData();
    formData.append('file', signatureBlob, 'signature.png');
    
    const { data: uploadRes } = await hrApiClient.post('/hr/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });

    // 2. Update document record (using signedAt to represent signed status)
    const { data } = await hrApiClient.put(`/hr/documents/${contractId}`, {
        signedAt: new Date().toISOString(),
        metadata: {
            signatureUrl: uploadRes.url,
            typedSignature: typedName
        }
    });

    return { ...data, status: 'signed' };
};

export const deleteContract = async (userId, contractId) => {
    const { data } = await hrApiClient.delete(`/hr/documents/${contractId}`);
    return data;
};
