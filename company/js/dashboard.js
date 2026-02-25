<script type="module">
  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
  import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
  import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, addDoc,
  collection, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
  import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

  const firebaseConfig = {
    apiKey: "AIzaSyD-ArzjlwKTZVpsH4ERg7n-MEgzCt6Nzno",
    authDomain: "prodalign-ltd.firebaseapp.com",
    projectId: "prodalign-ltd"
  };

  const TYPE_LABELS = {
    raw_material: "Raw material",
    bought_out: "Bought out item",
    final_saleable: "Final Saleable",
    operation: "Operation"
  };

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app);

  // URL company id
  const params = new URLSearchParams(window.location.search);
  const companyId = (params.get("c") || "").trim().toLowerCase();

  // Header UI
  const companyLogoEl = document.getElementById("companyLogo");
  const companyNameEl = document.getElementById("companyName");
  const logoutBtn = document.getElementById("logoutBtn");
  const backBtn = document.getElementById("backBtn");

  // Topbar
  const newItemBtn = document.getElementById("newItemBtn");
  const findInput = document.getElementById("findInput");

  // Tree + active UI
  const treeListEl = document.getElementById("treeList");
  const treeTitleEl = document.getElementById("treeTitle");
const toggleTreeItemsBtn = document.getElementById("toggleTreeItems");
const toggleTreeOpsBtn = document.getElementById("toggleTreeOps");

let treeMode = "items"; // "items" | "ops"
let allOps = [];
let allNonOps = [];
  const activeItemIdEl = document.getElementById("activeItemId");
  const containsItemsEl = document.getElementById("containsItems");
  const containsOpsEl = document.getElementById("containsOps");

  // Detail UI
  const detailItem = document.getElementById("detailItem");
  const detailType = document.getElementById("detailType");
  const detailCost = document.getElementById("detailCost");
  const detailTime = document.getElementById("detailTime");
  const detailEtc = document.getElementById("detailEtc");
  const detailCreatedBy = document.getElementById("detailCreatedBy");
const detailCreatedDate = document.getElementById("detailCreatedDate");
const detailUpdatedBy = document.getElementById("detailUpdatedBy");
const detailUpdatedDate = document.getElementById("detailUpdatedDate");
  const detailPanelEl = document.getElementById("detailPanel");
  const leftItemCardEl = document.getElementById("leftItemCard");
  // Active item action buttons
const editActiveItemBtn = document.getElementById("editActiveItemBtn");
const deleteActiveItemBtn = document.getElementById("deleteActiveItemBtn");

  // Add member UI
  const addMemberBtn = document.getElementById("addMemberBtn");
  const addMemberModal = document.getElementById("addMemberModal");
  const closeAddMemberModal = document.getElementById("closeAddMemberModal");
  const cancelAddMember = document.getElementById("cancelAddMember");
  const createMemberBtn = document.getElementById("createMemberBtn");
  const memberEmail = document.getElementById("memberEmail");
  const memberRole = document.getElementById("memberRole");
  const addMemberStatus = document.getElementById("addMemberStatus");

  // New item modal UI
  const newItemModal = document.getElementById("newItemModal");
  const closeNewItemModal = document.getElementById("closeNewItemModal");
  const cancelNewItem = document.getElementById("cancelNewItem");
  const saveNewItem = document.getElementById("saveNewItem");
  const newItemCode = document.getElementById("newItemCode");
  const newItemType = document.getElementById("newItemType");
  const newItemDescription = document.getElementById("newItemDescription");
  const newItemCost = document.getElementById("newItemCost");
  const newItemStatus = document.getElementById("newItemStatus");

  // Delete modal UI
  const deleteItemModal = document.getElementById("deleteItemModal");
  const closeDeleteItemModal = document.getElementById("closeDeleteItemModal");
  const cancelDeleteItem = document.getElementById("cancelDeleteItem");
  const confirmDeleteItem = document.getElementById("confirmDeleteItem");
  const deleteConfirmText = document.getElementById("deleteConfirmText");
  const deleteItemName = document.getElementById("deleteItemName");
  const deleteStatus = document.getElementById("deleteStatus");
  let pendingDeleteCode = null;

  // Edit modal UI
  const editItemModal = document.getElementById("editItemModal");
  const closeEditItemModal = document.getElementById("closeEditItemModal");
  const cancelEditItem = document.getElementById("cancelEditItem");
  const saveEditItem = document.getElementById("saveEditItem");
  const editItemCode = document.getElementById("editItemCode");
  const editItemDescription = document.getElementById("editItemDescription");
  const editItemCost = document.getElementById("editItemCost");
  const editItemStatus = document.getElementById("editItemStatus");
  let pendingEditCode = null;

  // Active item tracking
  let activeItemCode = null;
  let activeItemData = null;

  // Cache latest items for type validation + active refresh
  const itemsByCode = new Map(); // code -> item data
  let allItems = []; // used by Find search filter

  if (!companyId) {
    companyNameEl.textContent = "Missing company id (?c=...)";
    throw new Error("Missing ?c=");
  }
  function formatDateOnly(ts){
  try{
    const d =
      ts?.toDate ? ts.toDate() :
      ts instanceof Date ? ts :
      typeof ts === "number" ? new Date(ts) :
      null;

    if (!d || Number.isNaN(d.getTime())) return "—";

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric"
    }).format(d);
  } catch {
    return "—";
  }
}
  // ---------- Normalizers + renderers ----------
  function getUserIdentifier(){
  const u = auth.currentUser;
  if (!u) return null;

  // Prefer email; fall back to provider email; then displayName; then uid
  return (
    u.email ||
    u.providerData?.find(p => p?.email)?.email ||
    u.displayName ||
    u.uid ||
    null
  );
}
  function formatDate(ts){
  if (!ts?.toDate) return "—";
  const d = ts.toDate();
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });
}
  function normalizeContains(contains){
    if (!Array.isArray(contains)) return [];
    return contains
      .map(x => {
        if (typeof x === "string") return { code: x.trim().toUpperCase(), qty: 1 };
        if (x && typeof x === "object") {
          const code = String(x.code || "").trim().toUpperCase();
          const qtyN = Number(x.qty);
          const qty = Number.isFinite(qtyN) && qtyN > 0 ? Math.floor(qtyN) : 1;
          return code ? { code, qty } : null;
        }
        return null;
      })
      .filter(Boolean);
  }

  function normalizeOperations(ops){
    if (!Array.isArray(ops)) return [];
    return ops
      .map(x => {
        if (typeof x === "string") return { code: x.trim().toUpperCase(), iph: 0 };
        if (x && typeof x === "object") {
          const code = String(x.code || "").trim().toUpperCase();
          const iphN = Number(x.iph);
          const iph = Number.isFinite(iphN) && iphN >= 0 ? iphN : 0;
          return code ? { code, iph } : null;
        }
        return null;
      })
      .filter(Boolean);
  }

  function renderContainsTable(container, containsArr){
    const rows = normalizeContains(containsArr);

    if (rows.length === 0) {
      container.style.color = "rgba(255,255,255,0.65)";
      container.innerHTML = "No contained items";
      return;
    }

    container.style.color = "";
    container.innerHTML = `
      <table class="containsTable">
        <thead>
          <tr>
            <th style="width:55%;">Item</th>
            <th style="width:25%;">Qty</th>
            <th style="width:20%;"></th>
          </tr>
        </thead>
        <tbody id="containsTbody">
          ${rows.map(r => `
            <tr data-code="${r.code}">
              <td class="containsCode">${r.code}</td>
              <td><input class="qtyInput" type="number" min="1" step="1" value="${r.qty}" /></td>
              <td style="text-align:right;"><button class="rowBtn" type="button" data-remove="1">Remove</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderOperationsTable(container, opsArr){
  const rows = normalizeOperations(opsArr);

  if (rows.length === 0) {
    container.style.color = "rgba(255,255,255,0.65)";
    container.innerHTML = "No operations";
    return;
  }

  container.style.color = "";
  container.innerHTML = `
    <table class="containsTable">
      <thead>
        <tr>
          <th style="width:10%;">#</th>
          <th style="width:45%;">Operation</th>
          <th style="width:25%;">Items/hr</th>
          <th style="width:20%;"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r,i) => `
          <tr data-code="${r.code}" draggable="true" class="containsRowDraggable">
            <td style="font-weight:900;">${i+1}</td>
            <td class="containsCode">${r.code}</td>
            <td><input class="qtyInput opIphInput" type="number" min="0" step="0.1" value="${r.iph}" /></td>
            <td style="text-align:right;"><button class="rowBtn" type="button" data-op-remove="1">Remove</button></td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

  function setActiveItem(item){
    const code = item?.code || "—";
    activeItemCode = (code && code !== "—") ? String(code).trim().toUpperCase() : null;
    activeItemData = item || null;

    activeItemIdEl.textContent = code;

    renderContainsTable(containsItemsEl, item?.contains);
    renderOperationsTable(containsOpsEl, item?.operations);

    detailItem.textContent = code;
    detailType.textContent = TYPE_LABELS[item?.type] || "—";
    detailCost.textContent = (item?.baseCost ?? "—");
    detailTime.textContent = (item?.operationTime ?? "—");
    detailEtc.textContent = (item?.description ?? "—");
    detailCreatedBy.textContent = item?.createdBy ?? "—";
detailCreatedDate.textContent = formatDateOnly(item?.createdAt);

detailUpdatedBy.textContent = item?.updatedBy ?? "—";
detailUpdatedDate.textContent = formatDateOnly(item?.updatedAt);

    /// ===== Right panel content (matches left-card style) =====
if (leftItemCardEl) leftItemCardEl.style.display = "none"; // hide the left one so no duplicates

if (detailPanelEl) {
  if (!item || !activeItemCode) {
    detailPanelEl.className = "emptyHint";
    detailPanelEl.innerHTML = `
      Click an item in the Tree to view it here.<br/>
      Use “New Item” to create an item.
    `;
  } else {
    detailPanelEl.className = "card itemCard";
    detailPanelEl.innerHTML = `
      <div class="itemMetaGrid">
        <div class="metaRow">
          <div class="k">Item</div>
          <div class="v">${activeItemCode}</div>
        </div>

        <div class="metaRow">
          <div class="k">Type</div>
          <div class="v">${TYPE_LABELS[item?.type] || "—"}</div>
        </div>

        <div class="metaRow">
          <div class="k">Item Cost</div>
          <div class="v">${item?.baseCost ?? "—"}</div>
        </div>

        <div class="metaRow">
          <div class="k">Operation Time</div>
          <div class="v">${item?.operationTime ?? "—"}</div>
        </div>

        <div class="metaRow metaRowFull">
          <div class="k">Description</div>
          <div class="v" style="white-space:normal; overflow:visible; text-overflow:unset;">
            ${item?.description ?? "—"}
          </div>
        </div>
      </div>

      <div class="itemDivider"></div>

      <div class="auditGrid">
        <div class="auditCard">
          <div class="auditLabel">Created</div>
          <div class="auditValue">${item?.createdBy ?? "—"}</div>
          <div class="auditSub">${formatDateOnly(item?.createdAt)}</div>
        </div>

        <div class="auditCard">
          <div class="auditLabel">Last edited</div>
          <div class="auditValue">${item?.updatedBy ?? "—"}</div>
          <div class="auditSub">${formatDateOnly(item?.updatedAt)}</div>
        </div>
      </div>
    `;
  }
}
  // Enable/disable buttons depending on selection
const hasItem = !!activeItemCode;

if (editActiveItemBtn && deleteActiveItemBtn) {
  editActiveItemBtn.disabled = !hasItem;
  deleteActiveItemBtn.disabled = !hasItem;
}
}

  // ---------- Firestore save helpers ----------
let qtySaveTimer = null;
let iphSaveTimer = null;

async function saveContainsToActive(newContains){
  if (!activeItemCode) return;
  const ref = doc(db, "companies", companyId, "items", activeItemCode);

  await setDoc(ref, {
    contains: newContains,
    updatedBy: getUserIdentifier(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function scheduleQtySave(newContains){
  clearTimeout(qtySaveTimer);
  qtySaveTimer = setTimeout(() => {
    saveContainsToActive(newContains).catch(console.error);
  }, 250);
}

async function saveOperationsToActive(newOperations){
  if (!activeItemCode) return;
  const ref = doc(db, "companies", companyId, "items", activeItemCode);

  await setDoc(ref, {
    operations: newOperations,
    updatedBy: getUserIdentifier(),
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function scheduleIphSave(newOperations){
  clearTimeout(iphSaveTimer);
  iphSaveTimer = setTimeout(() => {
    saveOperationsToActive(newOperations).catch(console.error);
  }, 250);
}

  // ---------- Editable tables: qty + remove ----------
  containsItemsEl.addEventListener("input", (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.classList.contains("qtyInput")) return;
    if (input.classList.contains("opIphInput")) return;

    const tr = input.closest("tr");
    const code = tr?.dataset?.code;
    if (!code || !activeItemData) return;

    const qty = Math.max(1, Math.floor(Number(input.value || 1)));
    input.value = String(qty);

    const normalized = normalizeContains(activeItemData.contains);
    const next = normalized.map(r => r.code === code ? ({ ...r, qty }) : r);

    activeItemData = { ...activeItemData, contains: next, code: activeItemCode };
    scheduleQtySave(next);
  });

  containsItemsEl.addEventListener("click", (e) => {
    const btn = e.target;
    if (!(btn instanceof HTMLElement)) return;
    if (!btn.dataset.remove) return;

    const tr = btn.closest("tr");
    const code = tr?.dataset?.code;
    if (!code || !activeItemData) return;

    const normalized = normalizeContains(activeItemData.contains);
    const next = normalized.filter(r => r.code !== code);

    activeItemData = { ...activeItemData, contains: next, code: activeItemCode };
    renderContainsTable(containsItemsEl, next);
    saveContainsToActive(next).catch(console.error);
  });

  // ---------- Editable tables: items/hr + remove ----------
  containsOpsEl.addEventListener("input", (e) => {
    
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.classList.contains("opIphInput")) return;

    const tr = input.closest("tr");
    const code = tr?.dataset?.code;
    if (!code || !activeItemData) return;

    const raw = Number(input.value);
    const iph = Number.isFinite(raw) && raw >= 0 ? raw : 0;
    input.value = String(iph);

    const normalized = normalizeOperations(activeItemData.operations);
    const next = normalized.map(r => r.code === code ? ({ ...r, iph }) : r);

    activeItemData = { ...activeItemData, operations: next, code: activeItemCode };
    scheduleIphSave(next);
  });
// ===== REORDER OPERATIONS =====

let opDragSourceCode = null;

containsOpsEl.addEventListener("dragstart", (e) => {
  const row = e.target.closest("tr");
  if (!row) return;

  opDragSourceCode = row.dataset.code;
  row.classList.add("dragging");
});

containsOpsEl.addEventListener("dragend", (e) => {
  const row = e.target.closest("tr");
  if (row) row.classList.remove("dragging");
  opDragSourceCode = null;
});

containsOpsEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  const row = e.target.closest("tr");
  if (!row || !opDragSourceCode) return;
  row.classList.add("dragOver");
});

containsOpsEl.addEventListener("dragleave", (e) => {
  const row = e.target.closest("tr");
  if (row) row.classList.remove("dragOver");
});

containsOpsEl.addEventListener("drop", async (e) => {
  e.preventDefault();

  const targetRow = e.target.closest("tr");
  if (!targetRow || !opDragSourceCode || !activeItemData) return;

  targetRow.classList.remove("dragOver");

  const targetCode = targetRow.dataset.code;
  if (targetCode === opDragSourceCode) return;

  const list = normalizeOperations(activeItemData.operations);

  const fromIndex = list.findIndex(i => i.code === opDragSourceCode);
  const toIndex = list.findIndex(i => i.code === targetCode);

  const moved = list.splice(fromIndex, 1)[0];
  list.splice(toIndex, 0, moved);

  activeItemData = { ...activeItemData, operations: list, code: activeItemCode };
  renderOperationsTable(containsOpsEl, list);

  await saveOperationsToActive(list);
});
  
  containsOpsEl.addEventListener("click", (e) => {
    const btn = e.target;
    if (!(btn instanceof HTMLElement)) return;
    if (!btn.dataset.opRemove) return;

    const tr = btn.closest("tr");
    const code = tr?.dataset?.code;
    if (!code || !activeItemData) return;

    const normalized = normalizeOperations(activeItemData.operations);
    const next = normalized.filter(r => r.code !== code);

    activeItemData = { ...activeItemData, operations: next, code: activeItemCode };
    renderOperationsTable(containsOpsEl, next);
    saveOperationsToActive(next).catch(console.error);
  });

  // ===================== ORDER READY (DROPZONE -> MODAL -> FIRESTORE) =====================
const dropzone = document.getElementById("dropzone");

const orderReadyModal = document.getElementById("orderReadyModal");
const closeOrderReadyModal = document.getElementById("closeOrderReadyModal");
const cancelOrderReady = document.getElementById("cancelOrderReady");
const confirmOrderReady = document.getElementById("confirmOrderReady");

const orderReadyItem = document.getElementById("orderReadyItem");
const orderReadyOrderNo = document.getElementById("orderReadyOrderNo");
const orderReadyQty = document.getElementById("orderReadyQty");
const orderReadyStatus = document.getElementById("orderReadyStatus");

let pendingOrderReady = null; // { code, type }

function openOrderReadyModal(payload){
  pendingOrderReady = payload;

  orderReadyItem.textContent = payload?.code || "—";
  orderReadyOrderNo.value = "";
  orderReadyQty.value = "1";
  orderReadyStatus.textContent = "";

  orderReadyModal.classList.add("open");
  orderReadyModal.setAttribute("aria-hidden", "false");
  setTimeout(() => orderReadyOrderNo.focus(), 0);
}

function closeOrderReadyModalFn(){
  orderReadyModal.classList.remove("open");
  orderReadyModal.setAttribute("aria-hidden", "true");
  pendingOrderReady = null;
}

closeOrderReadyModal?.addEventListener("click", closeOrderReadyModalFn);
cancelOrderReady?.addEventListener("click", closeOrderReadyModalFn);
orderReadyModal?.addEventListener("click", (e) => {
  if (e.target === orderReadyModal) closeOrderReadyModalFn();
});

// Allow ESC to close this one too (your existing ESC handler can be extended)
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (orderReadyModal.classList.contains("open")) closeOrderReadyModalFn();
});

// Firestore write: creates a "job" for operators to pick up
async function getItemOpsInOrder(itemCode){
  const snap = await getDoc(doc(db, "companies", companyId, "items", itemCode));
  if (!snap.exists()) throw new Error(`Item ${itemCode} not found.`);
  const data = snap.data() || {};

  // Your items store operations like: [{code:"LASER", iph:0}, {code:"BEND", iph:0}]
  const ops = normalizeOperations(data.operations);

  if (!ops.length) {
    throw new Error(`Item ${itemCode} has no operations. Add operations first.`);
  }

  return ops; // already ordered
}

async function sendOrderToOperators({ code, type }){
  const itemCode = String(code || "").trim().toUpperCase();
  if (!itemCode) throw new Error("Missing item code.");

  // Block sending an OPERATION item as a job
  const resolvedType = await resolveItemType(itemCode, type);
  if (resolvedType === "operation") {
    throw new Error("Drop a normal item (not an Operation).");
  }

  const orderNo = String(orderReadyOrderNo.value || "").trim();
  const qty = Math.max(1, Math.floor(Number(orderReadyQty.value || 1)));
  if (!orderNo) throw new Error("Order number is required.");

  // ✅ Pull the ordered operation list from the item
  const ops = await getItemOpsInOrder(itemCode);

  const jobsRef = collection(db, "companies", companyId, "jobs");

  await addDoc(jobsRef, {
    itemCode,
    orderNo,
    qty,

    ops,                    // ordered queue: [{code, iph}, ...]
    currentOpIndex: 0,
    currentOpCode: ops[0].code,

    status: "ready",        // ready -> in_progress -> ready -> ... -> complete
    createdBy: getUserIdentifier(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),

    // optional history trail
    history: [{
      event: "created",
      at: Date.now(),
      by: getUserIdentifier()
    }]
  });
}

confirmOrderReady?.addEventListener("click", async () => {
  if (!pendingOrderReady?.code) return;

  confirmOrderReady.disabled = true;
  orderReadyStatus.textContent = "Sending…";

  try{
    await sendOrderToOperators(pendingOrderReady);
    orderReadyStatus.textContent = "Sent!";
    setTimeout(closeOrderReadyModalFn, 350);
  } catch(err){
    console.error(err);
    orderReadyStatus.textContent = err?.message || "Failed to send.";
  } finally{
    confirmOrderReady.disabled = false;
  }
});

// Dropzone drag/drop
if (dropzone){
  dropzone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dropzone.classList.add("drop-active");
  });

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drop-active");
    e.dataTransfer.dropEffect = "copy";
  });

  dropzone.addEventListener("dragleave", (e) => {
    // only remove highlight if leaving the dropzone fully
    if (e.relatedTarget && dropzone.contains(e.relatedTarget)) return;
    dropzone.classList.remove("drop-active");
  });

  dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("drop-active");

    const payload = readDragPayload(e.dataTransfer);
    if (!payload?.code) return;

    // Optional: only allow "items" tree to feed this
    // (we already block operations in sendOrderToOperators anyway)
    openOrderReadyModal(payload);
  });
}
  
  // ---------- Drag/drop UI helpers ----------
  function setDropActive(el, isActive){
    const panel = el.closest(".miniPanel");
    if (!panel) return;
    panel.style.borderColor = isActive ? "rgba(245,124,0,0.65)" : "rgba(255,255,255,0.10)";
    panel.style.boxShadow = isActive ? "0 0 0 4px rgba(245,124,0,0.12)" : "none";
  }

  function readDragPayload(dt){
    try {
      const raw = dt.getData("application/json");
      if (raw) return JSON.parse(raw);
    } catch {}
    const code = (dt.getData("text/plain") || "").trim().toUpperCase();
    return code ? { code, type: "" } : null;
  }

  // ---------- Drop into Contains Items ----------
  async function addContainedItemToActiveItem(containedCode) {
    if (!activeItemCode) {
      alert("Select an item first (the one that will contain the part).");
      return;
    }

    const child = String(containedCode || "").trim().toUpperCase();
    if (!child) return;

    if (child === activeItemCode) {
      alert("An item cannot contain itself.");
      return;
    }

    const parentRef = doc(db, "companies", companyId, "items", activeItemCode);
    const snap = await getDoc(parentRef);
    if (!snap.exists()) throw new Error(`Active item '${activeItemCode}' no longer exists.`);

    const data = snap.data() || {};
    const current = normalizeContains(data.contains);

    if (current.some(r => r.code === child)) return;

    const next = [...current, { code: child, qty: 1 }];

    await setDoc(parentRef, { contains: next, updatedAt: serverTimestamp() }, { merge: true });

    activeItemData = { ...(activeItemData || {}), code: activeItemCode, contains: next };
    renderContainsTable(containsItemsEl, next);
  }

  containsItemsEl.addEventListener("dragenter", (e) => { e.preventDefault(); setDropActive(containsItemsEl, true); });
  containsItemsEl.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  containsItemsEl.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && containsItemsEl.contains(e.relatedTarget)) return;
    setDropActive(containsItemsEl, false);
  });
  containsItemsEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  setDropActive(containsItemsEl, false);

  const payload = readDragPayload(e.dataTransfer);
  if (!payload?.code) return;

  // 🚫 BLOCK operations from being dropped into Contains Items
  const type = await resolveItemType(payload.code, payload.type);
  if (type === "operation") {
    alert("Operations can only be dropped into Contains Operations.");
    return;
  }

  try {
    await addContainedItemToActiveItem(payload.code);
  } catch (err) {
    console.error(err);
    alert(err?.message || "Failed to add contained item.");
  }
});
  // ---------- Drop into Contains Operations ----------
  async function resolveItemType(code, fallbackType){
    const clean = String(code || "").trim().toUpperCase();
    const typeLower = String(fallbackType || "").toLowerCase();
    if (typeLower) return typeLower;

    const cached = itemsByCode.get(clean);
    if (cached?.type) return String(cached.type).toLowerCase();

    try {
      const snap = await getDoc(doc(db, "companies", companyId, "items", clean));
      if (!snap.exists()) return "";
      return String(snap.data()?.type || "").toLowerCase();
    } catch {
      return "";
    }
  }

  async function addOperationToActiveItem(opCode){
    if (!activeItemCode) {
      alert("Select an item first (the one that will contain the operation).");
      return;
    }

    const child = String(opCode || "").trim().toUpperCase();
    if (!child) return;

    if (child === activeItemCode) {
      alert("An item cannot contain itself.");
      return;
    }

    const parentRef = doc(db, "companies", companyId, "items", activeItemCode);
    const snap = await getDoc(parentRef);
    if (!snap.exists()) throw new Error(`Active item '${activeItemCode}' no longer exists.`);

    const data = snap.data() || {};
    const current = normalizeOperations(data.operations);

    if (current.some(r => r.code === child)) return;

    const next = [...current, { code: child, iph: 0 }];

    await setDoc(parentRef, { operations: next, updatedAt: serverTimestamp() }, { merge: true });

    activeItemData = { ...(activeItemData || {}), code: activeItemCode, operations: next };
    renderOperationsTable(containsOpsEl, next);
  }

  containsOpsEl.addEventListener("dragenter", (e) => { e.preventDefault(); setDropActive(containsOpsEl, true); });
  containsOpsEl.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  containsOpsEl.addEventListener("dragleave", (e) => {
    if (e.relatedTarget && containsOpsEl.contains(e.relatedTarget)) return;
    setDropActive(containsOpsEl, false);
  });
  containsOpsEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    setDropActive(containsOpsEl, false);

    const payload = readDragPayload(e.dataTransfer);
    if (!payload?.code) return;

    const type = await resolveItemType(payload.code, payload.type);
    if (type !== "operation") {
      alert("Only items with Item Type = Operation can be dropped into Contains Operations.");
      return;
    }

    try {
      await addOperationToActiveItem(payload.code);
    } catch (err) {
      console.error(err);
      alert(err?.message || "Failed to add operation.");
    }
  });

  // ---------- Firestore: live tree ----------
  
  // ===== TREE RENDERER (used for search filtering) =====
function renderTree(items, queryText = "") {
  const q = String(queryText || "").trim().toLowerCase();
  treeListEl.innerHTML = "";

  const filtered = !q
    ? items
    : items.filter(it => {
        const code = String(it.code || "").toLowerCase();
        const desc = String(it.description || "").toLowerCase();
        return code.includes(q) || desc.includes(q);
      });

  if (filtered.length === 0) {
    treeListEl.style.color = "rgba(255,255,255,0.65)";
    treeListEl.textContent = q
      ? `No results for "${queryText}"`
      : "No items yet. Click “New Item” to create one.";
    return;
  }

  treeListEl.style.color = "";

  filtered.forEach((item) => {
    const code = (item.code || "").toUpperCase();

    const row = document.createElement("div");
    row.className = "tree-item";
    row.draggable = true;

    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/json", JSON.stringify({ code, type: item.type || "" }));
      e.dataTransfer.setData("text/plain", code);
      e.dataTransfer.effectAllowed = "copy";
    });

    const left = document.createElement("div");
    left.className = "left";
    left.innerHTML = `
      <strong>${code}</strong>
      <div class="muted">${item.description || "—"}</div>
    `;
    left.addEventListener("click", () => setActiveItem(item));

    const btnWrap = document.createElement("div");
    btnWrap.style.display = "flex";
    btnWrap.style.flexDirection = "column";
    btnWrap.style.gap = "6px";
    btnWrap.style.flex = "0 0 auto";

    row.appendChild(left);
treeListEl.appendChild(row);
  });
}

function renderCurrentTree() {
  const list = (treeMode === "ops") ? allOps : allNonOps;

  if (treeTitleEl) {
    treeTitleEl.textContent = (treeMode === "ops") ? "Tree of Operations" : "Tree of Items";
  }

  renderTree(list, findInput.value);
}
  function watchItems(companyId){
    const itemsRef = collection(db, "companies", companyId, "items");

    onSnapshot(itemsRef, (snap) => {
  itemsByCode.clear();
allItems = [];

allOps = [];
allNonOps = [];

  if (snap.empty) {
    treeListEl.style.color = "rgba(255,255,255,0.65)";
    treeListEl.textContent = "No items yet. Click “New Item” to create one.";
    setActiveItem(null);
    return;
  }

  let first = null;

  snap.forEach((d) => {
    const item = d.data();
    const code = (item.code || d.id || "").toUpperCase();
    const normalized = { ...item, code };

    itemsByCode.set(code, normalized);
    allItems.push(normalized);
    const type = String(normalized.type || "").toLowerCase();
if (type === "operation") allOps.push(normalized);
else allNonOps.push(normalized);

    if (!first) first = normalized;
  });

  if (!activeItemCode && first) setActiveItem(first);
  else if (activeItemCode && itemsByCode.has(activeItemCode)) setActiveItem(itemsByCode.get(activeItemCode));
  else if (first) setActiveItem(first);

  renderCurrentTree();
}, (err) => {
  console.error("Tree listener error:", err);
  treeListEl.innerHTML = `<div style="color:#ffb4b4;font-weight:900;">
    Error loading items: ${err.message}
  </div>`;
});
}

  // ---------- Branding + auth ----------
  async function loadCompanyBranding(companyId) {
    const snap = await getDoc(doc(db, "companies", companyId));
    if (!snap.exists()) {
      companyNameEl.textContent = `Company '${companyId}' not found`;
      return;
    }

    const company = snap.data();
    const name = company.displayname || "Company";
    const logoUrl = company.Logourl || "";

    companyNameEl.textContent = name;
    if (logoUrl) {
      companyLogoEl.src = logoUrl;
      companyLogoEl.style.display = "block";
    }

    document.title = `${name} | Settings`;
  }

  async function enforceUserCompany(user, companyId) {
    const userSnap = await getDoc(doc(db, "users", user.uid));
    if (!userSnap.exists()) throw new Error("User profile missing (users/{uid}).");

    const data = userSnap.data();
    const userCompany = String(data.companycode ?? data.companyCode ?? "").trim().toLowerCase();

    if (!userCompany) throw new Error("User profile missing companycode.");
    if (userCompany !== companyId) throw new Error("Access denied for this company.");
    return true;
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.assign(`/companylogin/?c=${encodeURIComponent(companyId)}`);
      return;
    }

    try {
      await enforceUserCompany(user, companyId);
      await loadCompanyBranding(companyId);
      watchItems(companyId);
    } catch (err) {
      console.error(err);
      try { await signOut(auth); } catch {}
      window.location.assign(`/companylogin/?c=${encodeURIComponent(companyId)}`);
    }
  });

  // ---------- Navigation ----------
  logoutBtn.addEventListener("click", async () => {
    await signOut(auth);
    window.location.assign(`/companylogin/?c=${encodeURIComponent(companyId)}`);
  });

  backBtn.addEventListener("click", () => {
    window.location.assign(`./index.html?c=${encodeURIComponent(companyId)}`);
  });

  // ---------- Edit modal ----------
  function openEditItemModal(item){
    pendingEditCode = item.code;

    editItemCode.value = item.code;
    editItemDescription.value = item.description || "";
    editItemCost.value = (item.baseCost ?? "");

    editItemStatus.textContent = "";

    editItemModal.classList.add("open");
    editItemModal.setAttribute("aria-hidden", "false");
    setTimeout(() => editItemDescription.focus(), 0);
  }

  function closeEditItemModalFn(){
    editItemModal.classList.remove("open");
    editItemModal.setAttribute("aria-hidden", "true");
    pendingEditCode = null;
  }

  closeEditItemModal.addEventListener("click", closeEditItemModalFn);
  cancelEditItem.addEventListener("click", closeEditItemModalFn);
  editItemModal.addEventListener("click", (e)=>{
    if(e.target === editItemModal) closeEditItemModalFn();
  });

  saveEditItem.addEventListener("click", async ()=>{
    if(!pendingEditCode) return;

    const description = editItemDescription.value.trim();
    const baseCost = Number(editItemCost.value || 0);

    saveEditItem.disabled = true;
    editItemStatus.textContent = "Saving…";

    try{
  await setDoc(
    doc(db, "companies", companyId, "items", pendingEditCode),
    {
      description,
      baseCost: Number.isFinite(baseCost) ? baseCost : 0,
      updatedBy: getUserIdentifier(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  editItemStatus.textContent = "Saved!";
  setTimeout(closeEditItemModalFn, 300);
} catch(err){
  console.error(err);
  editItemStatus.textContent = err?.message || "Save failed.";
} finally{
  saveEditItem.disabled = false;
}
  });

  // ---------- New Item modal ----------
  function openNewItemModal() {
    newItemStatus.textContent = "";
    newItemCode.value = "";
    newItemType.value = "final_saleable";
    newItemDescription.value = "";
    newItemCost.value = "";
    newItemModal.classList.add("open");
    newItemModal.setAttribute("aria-hidden", "false");
    setTimeout(() => newItemCode.focus(), 0);
  }
  function closeNewItemModalFn() {
    newItemModal.classList.remove("open");
    newItemModal.setAttribute("aria-hidden", "true");
  }

  newItemBtn.addEventListener("click", openNewItemModal);
  closeNewItemModal.addEventListener("click", closeNewItemModalFn);
  cancelNewItem.addEventListener("click", closeNewItemModalFn);
  newItemModal.addEventListener("click", (e) => {
    if (e.target === newItemModal) closeNewItemModalFn();
  });

  saveNewItem.addEventListener("click", async () => {
    const type = String(newItemType.value || "final_saleable");
    const code = String(newItemCode.value || "").trim().toUpperCase();
    const description = String(newItemDescription.value || "").trim();
    const baseCost = Number(newItemCost.value || 0);

    if (!code) {
      newItemStatus.textContent = "Item code is required.";
      return;
    }

    saveNewItem.disabled = true;
    newItemStatus.textContent = "Saving…";

    try {
      const itemRef = doc(db, "companies", companyId, "items", code);

      const existing = await getDoc(itemRef);
      if (existing.exists()) {
        newItemStatus.textContent = `${code} already exists.`;
        return;
      }

      const user = auth.currentUser;

await setDoc(itemRef, {
  code,
  type,
  description,
  baseCost: Number.isFinite(baseCost) ? baseCost : 0,
  contains: [],
  operations: [],

  // ⭐ ADD THESE TWO LINES
  createdBy: getUserIdentifier(),
updatedBy: getUserIdentifier(),
  
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});
      newItemStatus.textContent = "Saved!";
      setTimeout(closeNewItemModalFn, 350);
    } catch (err) {
      console.error(err);
      newItemStatus.textContent = err?.message || "Failed to save item.";
    } finally {
      saveNewItem.disabled = false;
    }
  });

  // ---------- Delete modal ----------
  function openDeleteModal(code){
    pendingDeleteCode = code;
    deleteItemName.textContent = code;
    deleteConfirmText.value = "";
    deleteStatus.textContent = "";
    confirmDeleteItem.disabled = true;

    deleteItemModal.classList.add("open");
    deleteItemModal.setAttribute("aria-hidden", "false");
    setTimeout(() => deleteConfirmText.focus(), 0);
  }

  function closeDeleteModal(){
    deleteItemModal.classList.remove("open");
    deleteItemModal.setAttribute("aria-hidden", "true");
    pendingDeleteCode = null;
  }

  closeDeleteItemModal.addEventListener("click", closeDeleteModal);
  cancelDeleteItem.addEventListener("click", closeDeleteModal);
  deleteItemModal.addEventListener("click", (e) => {
    if (e.target === deleteItemModal) closeDeleteModal();
  });

  deleteConfirmText.addEventListener("input", () => {
    confirmDeleteItem.disabled = deleteConfirmText.value.trim().toUpperCase() !== "DELETE";
  });

  confirmDeleteItem.addEventListener("click", async () => {
    if (!pendingDeleteCode) return;
    if (deleteConfirmText.value.trim().toUpperCase() !== "DELETE") return;

    confirmDeleteItem.disabled = true;
    deleteStatus.textContent = "Deleting…";

    try {
      await deleteDoc(doc(db, "companies", companyId, "items", pendingDeleteCode));
      deleteStatus.textContent = "Deleted.";
      setTimeout(closeDeleteModal, 250);
    } catch (err) {
      console.error(err);
      deleteStatus.textContent = err?.message || "Delete failed.";
      confirmDeleteItem.disabled = false;
    }
  });

  // ---------- Add member modal ----------
  function openAddMemberModal() {
    addMemberStatus.textContent = "";
    memberEmail.value = "";
    memberRole.value = "member";
    addMemberModal.classList.add("open");
    addMemberModal.setAttribute("aria-hidden", "false");
    setTimeout(() => memberEmail.focus(), 0);
  }
  function closeAddMemberModalFn() {
    addMemberModal.classList.remove("open");
    addMemberModal.setAttribute("aria-hidden", "true");
  }

  addMemberBtn.addEventListener("click", openAddMemberModal);
  closeAddMemberModal.addEventListener("click", closeAddMemberModalFn);
  cancelAddMember.addEventListener("click", closeAddMemberModalFn);
  addMemberModal.addEventListener("click", (e) => {
    if (e.target === addMemberModal) closeAddMemberModalFn();
  });

  async function callCreateCompanyMember(email, role) {
    const fn = httpsCallable(functions, "createCompanyMember");
    const res = await fn({ companyId, email, role });
    return res.data;
  }

  createMemberBtn.addEventListener("click", async () => {
    const email = memberEmail.value.trim().toLowerCase();
    const role = memberRole.value === "admin" ? "admin" : "member";

    if (!email || !email.includes("@")) {
      addMemberStatus.textContent = "Enter a valid email.";
      return;
    }

    createMemberBtn.disabled = true;
    addMemberStatus.textContent = "Creating member…";

    try {
      const data = await callCreateCompanyMember(email, role);
      addMemberStatus.textContent = `Member added: ${data.email || email}`;
      setTimeout(closeAddMemberModalFn, 800);
    } catch (err) {
      console.error(err);
      addMemberStatus.textContent =
        err?.message || "Could not create member. (Have you deployed the Cloud Function?)";
    } finally {
      createMemberBtn.disabled = false;
    }
  });

  // ---------- ESC closes topmost modal ----------
    // ===== ACTIVE ITEM ACTION BUTTONS =====
editActiveItemBtn?.addEventListener("click", () => {
  if (!activeItemData) return;
  openEditItemModal(activeItemData);
});

deleteActiveItemBtn?.addEventListener("click", () => {
  if (!activeItemCode) return;
  openDeleteModal(activeItemCode);
});
    document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (deleteItemModal.classList.contains("open")) closeDeleteModal();
    else if (editItemModal.classList.contains("open")) closeEditItemModalFn();
    else if (addMemberModal.classList.contains("open")) closeAddMemberModalFn();
    else if (newItemModal.classList.contains("open")) closeNewItemModalFn();
  });

  // Find (still placeholder)
  // ===== LIVE SEARCH FILTER =====
  function setTreeMode(nextMode){
  treeMode = (nextMode === "ops") ? "ops" : "items";

  if (toggleTreeItemsBtn && toggleTreeOpsBtn) {
    const isItems = treeMode === "items";

    toggleTreeItemsBtn.classList.toggle("active", isItems);
    toggleTreeOpsBtn.classList.toggle("active", !isItems);

    toggleTreeItemsBtn.setAttribute("aria-selected", isItems ? "true" : "false");
    toggleTreeOpsBtn.setAttribute("aria-selected", !isItems ? "true" : "false");
  }

  renderCurrentTree();
}

toggleTreeItemsBtn?.addEventListener("click", () => setTreeMode("items"));
toggleTreeOpsBtn?.addEventListener("click", () => setTreeMode("ops"));
findInput.addEventListener("input", () => {
  renderCurrentTree();
});
  
</script>
