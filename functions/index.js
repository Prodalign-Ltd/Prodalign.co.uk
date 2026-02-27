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

        if (currentStock >= required) {
          // Enough stock: reserve it by decrementing stockQty
          tx.update(compRef, { stockQty: currentStock - required });
        } else {
          // Not enough: reserve what exists and create a sub‑order for the shortage
          const missing = required - currentStock;
          // Deplete current stock
          if (currentStock > 0) {
            tx.update(compRef, { stockQty: 0 });
          }
          // Create the sub‑order
          const subOrderRef = db.collection(`companies/${companyId}/orders`).doc();
          tx.set(subOrderRef, {
            itemCode: compCode,
            quantity: missing,
            dueDate: order.dueDate || null,
            status: 'pending',
            componentOf: snap.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    });
    return null;
  });
