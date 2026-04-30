const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Lazy init for db
let dbInstance = null;
const getDb = () => {
    if (!dbInstance) {
        if (admin.apps.length === 0) {
            admin.initializeApp();
        }
        dbInstance = admin.firestore();
    }
    return dbInstance;
};

// Get Stripe secret key
const getStripeSecretKey = () => {
    return process.env.STRIPE_SECRET_KEY || functions.config().stripe?.secret_key;
};

// Lazy init for Stripe
let stripeInstance = null;
const getStripe = () => {
    if (!stripeInstance) {
        stripeInstance = require('stripe')(getStripeSecretKey());
    }
    return stripeInstance;
};

// Hardcoded Price IDs for plugins
// In production, these should be in environment variables
const getPluginPriceId = (addonType) => {
    const schedulingPriceId = process.env.STRIPE_PRICE_SCHEDULING || functions.config().stripe?.price_scheduling || 'price_1SmCAiASpeIKLh5Q5XdQkkra';
    const prices = {
        scheduling: schedulingPriceId
    };
    return prices[addonType];
};

/**
 * Add a plugin add-on to an existing subscription
 * @param {string} companyId - The company ID
 * @param {string} addonType - The type of addon (e.g., 'scheduling')
 */
async function addSubscriptionAddon(companyId, addonType) {
    const priceId = getPluginPriceId(addonType);

    if (!priceId) {
        throw new Error(`Invalid add-on type: ${addonType}`);
    }

    // Get company to find subscription ID
    const companyRef = getDb().collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
        throw new Error('Company not found');
    }

    const { stripeSubscriptionId } = companyDoc.data();

    if (!stripeSubscriptionId) {
        throw new Error('No active subscription found for this company');
    }

    // Retrieve current subscription to check if already added
    const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId);

    // Check if item already exists
    const existingItem = subscription.items.data.find(item => item.price.id === priceId);

    if (existingItem) {
        console.log(`Add-on ${addonType} already exists in subscription ${stripeSubscriptionId}`);
        return { success: true, message: 'Add-on already active' };
    }

    // Add the item to the subscription
    await getStripe().subscriptions.update(stripeSubscriptionId, {
        items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        proration_behavior: 'create_prorations', // Charge next cycle to avoid immediate payment failures/status changes
    });

    // Optimistically update Firestore (webhook will verify)
    // Use set with merge to ensure plugins map is created if missing
    await companyRef.set({
        plugins: {
            [addonType]: true
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true };
}

/**
 * Remove a plugin add-on from a subscription
 * @param {string} companyId - The company ID
 * @param {string} addonType - The type of addon
 */
async function removeSubscriptionAddon(companyId, addonType) {
    const priceId = getPluginPriceId(addonType);

    if (!priceId) {
        throw new Error(`Invalid add-on type: ${addonType}`);
    }

    const companyRef = getDb().collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();

    if (!companyDoc.exists) {
        throw new Error('Company not found');
    }

    const companyData = companyDoc.data();
    const { stripeSubscriptionId } = companyData;

    // If there's no Stripe subscription, we just update Firestore to disable the plugin
    // This handles cases where the state might be out of sync
    if (!stripeSubscriptionId) {
        console.log(`No active subscription found for company ${companyId}. Updating Firestore directly.`);
        await companyRef.set({
            plugins: {
                [addonType]: false
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { success: true, message: 'Updated local state only (no subscription found)' };
    }

    try {
        const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
        const item = subscription.items.data.find(item => item.price.id === priceId);

        if (item) {
            // Remove the item from Stripe
            await getStripe().subscriptionItems.del(item.id);
        } else {
            console.log(`Add-on ${addonType} (${priceId}) not found in subscription ${stripeSubscriptionId}.`);
        }
    } catch (stripeError) {
        console.error('Stripe error while removing addon:', stripeError);
        // We continue to update Firestore even if Stripe fails, 
        // as long as the intention is to remove it and it might already be gone
    }

    // Always update Firestore to ensure the UI reflects the change
    await companyRef.set({
        plugins: {
            [addonType]: false
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true };
}

module.exports = {
    addSubscriptionAddon,
    removeSubscriptionAddon,
};
