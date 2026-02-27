const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize the default app once. When deployed, Firebase Functions will
// automatically use the correct project configuration. When testing locally,
// ensure that you have configured credentials via the Firebase CLI.
admin.initializeApp();

/**
 * Firestore trigger: handleOrderCreate
 *
 * This function runs whenever a new order document is created under
 * companies/{companyId}/orders/{orderId}. It checks the bill of materials
 * (BOM) for the ordered item and ensures that sufficient stock exists for
 * each component. If stock is insufficient, it creates a sub‑order for the
 * missing quantity and reserves existing stock by deducting it. This
 * ensures that orders cannot proceed without their required materials.
 *
 * Expected order document fields:
 * - itemCode: string (code of the item being ordered)
 * - quantity: number (quantity of the item being ordered)
 * - dueDate: timestamp/string/number (optional; propagated to sub‑orders)
 * - componentOf: string (optional; indicates this is a sub‑order of
 *   another order)
 */
exports.handleOrderCreate = functions.firestore
  .document('companies/{companyId}/orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data() || {};
    // Skip processing for sub‑orders to avoid infinite recursion
    if (order.componentOf) {
      return null;
    }
    const companyId = context.params.companyId;
    const db = admin.firestore();

    await db.runTransaction(async (tx) => {
      // Load parent item and its BOM
      const parentItemRef = db.doc(`companies/${companyId}/items/${order.itemCode}`);
      const parentSnap = await tx.get(parentItemRef);
      if (!parentSnap.exists) {
        console.warn('handleOrderCreate: parent item not found', order.itemCode);
        return;
      }
      const parentItem = parentSnap.data() || {};
      const contains = Array.isArray(parentItem.contains) ? parentItem.contains : [];

      // We'll build a list of components to store on the parent order for reference
      const compList = [];

      // Iterate through each component required by the BOM
      for (const comp of contains) {
        // comp can be a string (code) or an object {code, qty}
        const compCode = typeof comp === 'string' ? comp.trim().toUpperCase() : String(comp.code || '').trim().toUpperCase();
        if (!compCode) continue;
        const compQty = (typeof comp === 'object' && typeof comp.qty === 'number' && comp.qty > 0)
          ? Math.floor(comp.qty)
          : 1;
        // Calculate required quantity for this component based on the order quantity
        const orderQty = typeof order.quantity === 'number' && order.quantity > 0 ? order.quantity : 0;
        const required = orderQty * compQty;
        if (required <= 0) continue;

        const compRef = db.doc(`companies/${companyId}/items/${compCode}`);
        const compSnap = await tx.get(compRef);
        const compData = compSnap.exists ? compSnap.data() || {} : {};
        const currentStock = typeof compData.stockQty === 'number' && compData.stockQty >= 0 ? compData.stockQty : 0;

        // Determine how much stock will be consumed and how much is missing
        const missing = Math.max(required - currentStock, 0);
        const newStock = Math.max(currentStock - required, 0);
        // Update stock for this component
        tx.update(compRef, { stockQty: newStock });

        // If there is any missing quantity, create a sub-order for that shortage
        let subOrderId = null;
        if (missing > 0) {
          const subOrderRef = db.collection(`companies/${companyId}/orders`).doc();
          subOrderId = subOrderRef.id;
          tx.set(subOrderRef, {
            itemCode: compCode,
            quantity: missing,
            dueDate: order.dueDate || null,
            status: 'pending',
            componentOf: snap.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }

        // Record component details on the parent order. This helps you reference
        // child components and see the required vs missing quantities even if
        // stock was sufficient.
        compList.push({
          itemCode: compCode,
          requiredQty: required,
          stockUsed: Math.min(currentStock, required),
          missingQty: missing,
          subOrderId
        });
      }

      // Attach the components list to the parent order so that it references
      // its child components. Use merge:true to avoid overwriting other fields.
      tx.set(snap.ref, { components: compList }, { merge: true });
    });
    return null;
  });

/**
 * Firestore trigger: handleJobCreate
 *
 * When a new job document is created under companies/{companyId}/jobs/{jobId},
 * this function examines the bill of materials (BOM) of the job’s item and
 * automatically creates child jobs for any components that themselves have
 * defined operations. It processes the entire BOM tree recursively: each
 * component job created by this trigger will, in turn, trigger this
 * function for its own BOM. To prevent duplicate processing, each job
 * document is marked with a `bomProcessed: true` flag once its BOM has been
 * exploded.
 *
 * Expected job document fields:
 * - itemCode: string (code of the item being produced)
 * - qty: number (quantity of the item being produced)
 * - ops: array (operations list for this job; if empty, no sub‑jobs are created)
 * - parentJobId: string (optional; id of the parent job that spawned this job)
 * - bomProcessed: boolean (optional; set to true once processed)
 */
exports.handleJobCreate = functions.firestore
  .document('companies/{companyId}/jobs/{jobId}')
  .onCreate(async (snap, context) => {
    const jobData = snap.data() || {};
    const companyId = context.params.companyId;
    const jobId = context.params.jobId;
    // Skip if this job has already had its BOM processed
    if (jobData.bomProcessed) {
      return null;
    }
    const db = admin.firestore();
    const itemCode = String(jobData.itemCode || '').trim().toUpperCase();
    const qty = Number(jobData.qty || jobData.quantity || 0);
    if (!itemCode || qty <= 0) {
      console.warn('handleJobCreate: invalid job data', jobData);
      await snap.ref.update({ bomProcessed: true });
      return null;
    }

    try {
      // Load the item document to read its BOM and operations
      const itemRef = db.doc(`companies/${companyId}/items/${itemCode}`);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        console.warn('handleJobCreate: item not found', itemCode);
        await snap.ref.update({ bomProcessed: true });
        return null;
      }
      const item = itemSnap.data() || {};
      const bom = Array.isArray(item.contains) ? item.contains : [];

      // For each component in the BOM, determine if we need to create a child job
      for (const comp of bom) {
        // Determine component code and quantity from the BOM entry
        let compCode = '';
        let compQty = 1;
        if (typeof comp === 'string') {
          compCode = comp.trim().toUpperCase();
        } else if (comp && typeof comp === 'object') {
          compCode = String(comp.code || comp.itemCode || '').trim().toUpperCase();
          const q = Number(comp.qty || comp.quantity || 1);
          compQty = Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
        }
        if (!compCode) continue;

        // Calculate the total required quantity for this component
        const required = qty * compQty;
        if (required <= 0) continue;

        // Load the component item to see if it has operations defined
        const compItemRef = db.doc(`companies/${companyId}/items/${compCode}`);
        const compItemSnap = await compItemRef.get();
        if (!compItemSnap.exists) {
          // Component item not found; treat as raw material only
          continue;
        }
        const compItem = compItemSnap.data() || {};
        // Retrieve the operations list from the component item. In Firestore
        // arrays may sometimes be stored as objects with numeric keys (e.g.,
        // {0: {...}, 1: {...}}). To support both representations we extract
        // values if it's an object.
        let compOps = [];
        const rawOps = compItem.operations;
        if (Array.isArray(rawOps)) {
          compOps = rawOps;
        } else if (rawOps && typeof rawOps === 'object') {
          compOps = Object.values(rawOps);
        } else {
          compOps = [];
        }
        if (compOps.length === 0) {
          // No operations defined for this component; do not create a job
          continue;
        }
        // Build the operations array and add meta fields similar to existing job schema.
        const normalizedOps = compOps
          .map(op => {
            const code = String(op.code || op.op || '').trim().toUpperCase();
            const iph = Number(op.iph || op.rate);
            return code ? { code, iph: Number.isFinite(iph) ? iph : 0 } : null;
          })
          .filter(Boolean);
        if (normalizedOps.length === 0) {
          // Nothing usable
          continue;
        }
        // Prepare op entries with additional metadata for consistency. Each op entry
        // carries the order number, quantity and a per‑operation status. We
        // initialise status to "ready" and copy the required quantity for this
        // component. updatedAt will be updated when the op starts or completes.
        const opsWithMeta = normalizedOps.map(op => ({
          code: op.code,
          iph: op.iph,
          orderNo: jobData.orderNo || jobData.productionOrder || null,
          qty: required,
          status: 'ready',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }));
        // Create a new job document for the component
        const newJobRef = db.collection(`companies/${companyId}/jobs`).doc();
        await newJobRef.set({
          companyId,
          itemCode: compCode,
          qty: required,
          ops: opsWithMeta,
          currentOpIndex: 0,
          currentOpCode: opsWithMeta[0].code,
          status: 'ready',
          parentJobId: jobId,
          orderNo: jobData.orderNo || jobData.productionOrder || null,
          bomProcessed: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: jobData.createdBy || null
        });
      }
      // Mark the original job as processed so we don't reprocess its BOM
      await snap.ref.update({ bomProcessed: true });
    } catch (err) {
      console.error('handleJobCreate error:', err);
      // Mark as processed anyway to avoid infinite retries on errors
      await snap.ref.update({ bomProcessed: true });
    }
    return null;
  });
