import { db } from '../firebase/client';
import { doc, getDoc, runTransaction, updateDoc, increment, collection, getDocs } from 'firebase/firestore';

/**
 * Distributed Counter Service
 * Handles high-frequency counters by sharding writes across multiple documents.
 * Firestore limits single document writes to ~1/sec. Sharding allows N/sec.
 */

export const DistributedCounter = {
    /**
     * Increment a distributed counter.
     * @param {DocumentReference} ref - Reference to the main counter document
     * @param {number} numShards - Number of shards to distribute across (default: 10)
     */
    increment: async (ref, numShards = 10) => {
        const shardId = Math.floor(Math.random() * numShards).toString();
        const shardRef = doc(collection(ref, 'shards'), shardId);

        return runTransaction(db, async (t) => {
            const shardDoc = await t.get(shardRef);
            if (!shardDoc.exists()) {
                t.set(shardRef, { count: increment(1) });
            } else {
                t.update(shardRef, { count: increment(1) });
            }
        });
    },

    /**
     * Decrement a distributed counter.
     */
    decrement: async (ref, numShards = 10) => {
        const shardId = Math.floor(Math.random() * numShards).toString();
        const shardRef = doc(collection(ref, 'shards'), shardId);

        return runTransaction(db, async (t) => {
            const shardDoc = await t.get(shardRef);
            if (!shardDoc.exists()) {
                t.set(shardRef, { count: increment(-1) });
            } else {
                t.update(shardRef, { count: increment(-1) });
            }
        });
    },

    /**
     * Get the total count from all shards.
     * @param {DocumentReference} ref - Reference to the main counter document
     */
    getCount: async (ref) => {
        const snapshot = await getDocs(collection(ref, 'shards'));
        let total = 0;
        snapshot.forEach(doc => {
            total += doc.data().count || 0;
        });
        return total;
    },

    /**
     * Initialize/Reset a counter (Admin only usually)
     */
    createCounter: async (ref, numShards = 10) => {
        const batch = db.batch();
        // Initialize shards with 0
        for (let i = 0; i < numShards; i++) {
            const shardRef = doc(collection(ref, 'shards'), i.toString());
            batch.set(shardRef, { count: 0 });
        }
        await batch.commit();
    }
};
