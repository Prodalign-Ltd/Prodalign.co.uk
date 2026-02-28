const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

/**
 * Handle new production order
 * Explodes BOM and reserves WIP stock
 */
exports.handleOrderCreate = functions.firestore
  .document('companies/{companyId}/orders/{orderId}')
  .onCreate(async (snap, context) => {
    const order = snap.data();
    if (!order || order.componentOf) return null;

    const companyId = context.params.companyId;
    const orderQty = Number(order.quantity || 0);
    if (orderQty <= 0) return null;

    const parentItemRef = db.doc(`companies/${companyId}/items/${order.itemCode}`);
    const parentSnap = await parentItemRef.get();
    if (!parentSnap.exists) return null;

    const parentItem = parentSnap.data();
    const contains = parentItem.contains || [];

    const componentsSummary = [];

    for (const comp of contains) {
      const compCode = (typeof comp === 'string' ? comp : comp.code).toUpperCase();
      const compQty = typeof comp === 'object' ? Number(comp.qty || 1) : 1;
      const required = orderQty * compQty;

      const compRef = db.doc(`companies/${companyId}/items/${compCode}`);
      const compSnap = await compRef.get();
      if (!compSnap.exists) continue;

      const compData = compSnap.data();
      const available = Number(compData.wipQty ?? compData.stockQty ?? 0);

      const missing = Math.max(required - available, 0);
      const newWip = Math.max(available - required, 0);

      await compRef.update({
        wipQty: newWip,
        stockQty: newWip
      });

      let subOrderId = null;

      if (missing > 0) {
        const subOrderRef = db.collection(`companies/${companyId}/orders`).doc();
        subOrderId = subOrderRef.id;

        await subOrderRef.set({
          itemCode: compCode,
          quantity: missing,
          status: 'pending',
          componentOf: snap.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      componentsSummary.push({
        itemCode: compCode,
        requiredQty: required,
        stockUsed: Math.min(required, available),
        missingQty: missing,
        subOrderId
      });
    }

    await snap.ref.update({
      components: componentsSummary
    });

    return null;
  });

/**
 * Handle new job creation
 */
exports.handleJobCreate = functions.firestore
  .document('companies/{companyId}/jobs/{jobId}')
  .onCreate(async (snap, context) => {
    console.log("New job created:", snap.data());
    return null;
  });
