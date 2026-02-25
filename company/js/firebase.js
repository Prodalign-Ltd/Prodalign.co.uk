import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

export const firebaseConfig = {
  apiKey: "AIzaSyD-ArzjlwKTZVpsH4ERg7n-MEgzCt6Nzno",
  authDomain: "prodalign-ltd.firebaseapp.com",
  projectId: "prodalign-ltd"
};

export const TYPE_LABELS = {
  raw_material: "Raw material",
  bought_out: "Bought out item",
  final_saleable: "Final Saleable",
  operation: "Operation"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// URL company id (?c=...)
const params = new URLSearchParams(window.location.search);
export const companyId = (params.get("c") || "").trim().toLowerCase();
