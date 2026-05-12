export const getStorage = () => ({});
export const ref = (storage, path) => ({ path });
export const uploadBytes = async (ref, blob) => {
    console.warn(`Firebase Storage Shim: uploadBytes called for ${ref.path}. Returning dummy result.`);
    return { ref };
};
export const getDownloadURL = async (ref) => {
    console.warn(`Firebase Storage Shim: getDownloadURL called for ${ref.path}. Returning dummy URL.`);
    return 'https://via.placeholder.com/150';
};
export const deleteObject = async (ref) => {
    console.warn(`Firebase Storage Shim: deleteObject called for ${ref.path}. Doing nothing.`);
    return true;
};
