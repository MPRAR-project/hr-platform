export const getFunctions = () => ({});
export const httpsCallable = (functions, name) => {
    console.warn(`Firebase Functions Shim: httpsCallable called for ${name}. Returning dummy function.`);
    return async (data) => {
        return { data: {} };
    };
};
