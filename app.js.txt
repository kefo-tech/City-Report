import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  GeoPoint,
  runTransaction
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  geohashForLocation,
  geohashQueryBounds,
  distanceBetween
} from "https://cdn.skypack.dev/geofire-common@6.0.4";

// 1) ضع إعدادات Firebase هنا:
const firebaseConfig = {
  apiKey: "AIzaSyDBpj59oQ4BbSCLQi117Rn-gZjZ7awujV4",
  authDomain: "report-77313.firebaseapp.com",
  projectId: "report-77313",
  storageBucket: "report-77313.firebasestorage.app",
  messagingSenderId: "664112522932",
  appId: "1:664112522932:web:ed636e68015bd089fb19e1"
};

// Initialize Firebase

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// UI refs
const $ = (s) => document.querySelector(s);

const btnAuth = $("#btnAuth");
const btnLogout = $("#btnLogout");
const btnAdd = $("#btnAdd");
const btnLocate = $("#btnLocate");
const btnRefresh = $("#btnRefresh");

const modalAuth = $("#modalAuth");
const modalAdd = $("#modalAdd");

const authEmail = $("#authEmail");
const authPass = $("#authPass");
const authName = $("#authName");
const authMsg = $("#authMsg");

const reportType = $("#reportType");
const reportText = $("#reportText");
const addMsg = $("#addMsg");

const feedEl = $("#feed");
const statusEl = $("#status");
const radiusEl = $("#radius");
const typeFilterEl = $("#typeFilter");

let currentUser = null;
let currentPos = null; // {lat,lng}

// Map
let map = null;
let markers = [];

function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function openModal(el){ show(el); }
function closeModal(el){ hide(el); }

document.addEventListener("click", (e) => {
  const close = e.target?.getAttribute?.("data-close");
  if(close){
    const m = document.querySelector(close);
    if(m) closeModal(m);
  }
});

// Tabs
document.querySelectorAll(".tab").forEach(t => {
  t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const tab = t.dataset.tab;
    if(tab === "feed"){
      show($("#tab-feed")); hide($("#tab-map"));
    } else {
      hide($("#tab-feed")); show($("#tab-map"));
      ensureMap();
      renderMapMarkersFromFeed();
    }
  });
});

// Service Worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// Auth state
onAuthStateChanged(auth, async (u) => {
  currentUser = u || null;
  if(currentUser){
    hide(btnAuth);
    show(btnLogout);
    statusEl.textContent = `مرحبًا ${currentUser.displayName || currentUser.email} — سيتم عرض البلاغات القريبة.`;
    await ensureUserDoc();
  } else {
    show(btnAuth);
    hide(btnLogout);
    statusEl.textContent = "غير مسجل. يمكنك التصفح، لكن إضافة/تصويت يحتاج تسجيل دخول.";
  }
  await refreshFeed();
});

async function ensureUserDoc(){
  const ref = doc(db, "users", currentUser.uid);
  const snap = await getDoc(ref);
  if(!snap.exists()){
    await setDoc(ref, {
      displayName: currentUser.displayName || "مستخدم",
      email: currentUser.email || "",
      emailVerified: !!currentUser.emailVerified,
      reputationScore: 0,
      createdAt: serverTimestamp()
    });
  }
}

// Buttons
btnAuth.addEventListener("click", () => openModal(modalAuth));
btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

btnAdd.addEventListener("click", async () => {
  addMsg.textContent = "";
  if(!currentUser){
    addMsg.textContent = "يجب تسجيل الدخول لإضافة بلاغ.";
    openModal(modalAuth);
    return;
  }
  if(!currentPos){
    await locate();
  }
  openModal(modalAdd);
});

btnLocate.addEventListener("click", locate);
btnRefresh.addEventListener("click", refreshFeed);
radiusEl.addEventListener("change", refreshFeed);
typeFilterEl.addEventListener("change", refreshFeed);

// Auth actions
$("#btnLogin").addEventListener("click", async () => {
  authMsg.textContent = "";
  try{
    await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPass.value);
    closeModal(modalAuth);
  }catch(err){
    authMsg.textContent = err.message;
  }
});

$("#btnRegister").addEventListener("click", async () => {
  authMsg.textContent = "";
  const email = authEmail.value.trim();
  const pass = authPass.value;
  const name = authName.value.trim() || "مستخدم";
  try{
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: name,
      email,
      emailVerified: !!cred.user.emailVerified,
      reputationScore: 0,
      createdAt: serverTimestamp()
    });
    closeModal(modalAuth);
  }catch(err){
    authMsg.textContent = err.message;
  }
});

// Add report
$("#btnSubmitReport").addEventListener("click", async () => {
  addMsg.textContent = "";
  const text = reportText.value.trim();
  const type = reportType.value;

  if(!currentUser){
    addMsg.textContent = "يجب تسجيل الدخول.";
    return;
  }
  if(!currentPos){
    addMsg.textContent = "لم يتم تحديد موقعك بعد.";
    return;
  }
  if(text.length < 3){
    addMsg.textContent = "الوصف قصير جدًا.";
    return;
  }

  const lat = currentPos.lat;
  const lng = currentPos.lng;
  const gh = geohashForLocation([lat, lng]);

  try{
    await addDoc(collection(db, "reports"), {
      userId: currentUser.uid,
      userName: currentUser.displayName || (currentUser.email || "مستخدم"),
      type,
      text,
      location: new GeoPoint(lat, lng),
      geohash: gh,
      createdAt: serverTimestamp(),
      yesCount: 0,
      noCount: 0,
      trustScore: 0,
      status: "new"
    });

    reportText.value = "";
    closeModal(modalAdd);
    await refreshFeed();
  }catch(err){
    addMsg.textContent = err.message;
  }
});

// Location
async function locate(){
  statusEl.textContent = "جارٍ تحديد موقعك...";
  currentPos = await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
    );
  });

  if(!currentPos){
    statusEl.textContent = "تعذر تحديد الموقع. فعّل GPS وأذونات الموقع ثم حاول مجددًا.";
    return;
  }
  statusEl.textContent = `تم تحديد موقعك. (تقريبًا) lat:${currentPos.lat.toFixed(5)} lng:${currentPos.lng.toFixed(5)}`;
  if(map){
    map.setView([currentPos.lat, currentPos.lng], 16);
  }
}

// Feed
async function refreshFeed(){
  feedEl.innerHTML = "";
  const radiusMeters = parseInt(radiusEl.value, 10);
  const typeFilter = typeFilterEl.value;

  if(!currentPos){
    await locate();
  }
  if(!currentPos){
    feedEl.innerHTML = `<div class="post"><div class="small">لا يمكن عرض البلاغات دون موقع.</div></div>`;
    return;
  }

  const center = [currentPos.lat, currentPos.lng];
  const radiusKm = radiusMeters / 1000;

  // Geo queries by geohash bounds
  const bounds = geohashQueryBounds(center, radiusKm);
  const promises = [];

  for (const b of bounds) {
    const q = query(
      collection(db, "reports"),
      orderBy("geohash"),
      where("geohash", ">=", b[0]),
      where("geohash", "<=", b[1]),
      limit(50)
    );
    promises.push(getDocs(q));
  }

  const snaps = await Promise.all(promises);
  const all = [];
  snaps.forEach(s => s.forEach(docu => all.push({ id: docu.id, ...docu.data() })));

  // Filter by real distance + type
  const filtered = all
    .map(r => {
      const loc = r.location;
      const dKm = distanceBetween([loc.latitude, loc.longitude], center);
      return { ...r, distanceMeters: Math.round(dKm * 1000) };
    })
    .filter(r => r.distanceMeters <= radiusMeters)
    .filter(r => typeFilter === "all" ? true : r.type === typeFilter);

  // Sort: nearest, then trustScore, then newest-ish
  filtered.sort((a,b) => {
    if(a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
    if((b.trustScore||0) !== (a.trustScore||0)) return (b.trustScore||0) - (a.trustScore||0);
    return 0;
  });

  if(filtered.length === 0){
    feedEl.innerHTML = `<div class="post"><div class="small">لا توجد بلاغات ضمن النطاق المحدد.</div></div>`;
  } else {
    filtered.forEach(r => feedEl.appendChild(renderPost(r)));
  }

  // Update map markers if visible
  if(!$("#tab-map").classList.contains("hidden")){
    ensureMap();
    renderMapMarkers(filtered);
  }
}

function renderPost(r){
  const el = document.createElement("div");
  el.className = "post";

  const yes = r.yesCount || 0;
  const no = r.noCount || 0;
  const trust = r.trustScore || (yes - no);

  el.innerHTML = `
    <div class="post-head">
      <div>
        <span class="badge">📌 ${escapeHtml(r.type)} </span>
        <span class="badge">📍 ${r.distanceMeters}م</span>
        <span class="badge">✅ ${yes} | ❌ ${no} | 🧭 ${trust}</span>
      </div>
      <div class="meta">
        بواسطة: ${escapeHtml(r.userName || "مستخدم")}
      </div>
    </div>

    <div class="post-text">${escapeHtml(r.text)}</div>

    <div class="post-actions">
      <button class="btn" data-openmap="${r.id}">عرض على الخريطة</button>
      <button class="btn primary" data-vote="yes" data-id="${r.id}">صادق (${yes})</button>
      <button class="btn danger" data-vote="no" data-id="${r.id}">كاذب (${no})</button>
      <span class="small">النطاق: ${radiusEl.value}m</span>
    </div>
  `;

  el.querySelector('[data-openmap]').addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelector('.tab[data-tab="map"]').classList.add("active");
    hide($("#tab-feed")); show($("#tab-map"));
    ensureMap();
    const loc = r.location;
    map.setView([loc.latitude, loc.longitude], 18);
  });

  el.querySelectorAll("[data-vote]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if(!currentUser){
        openModal(modalAuth);
        return;
      }
      await castVote(r.id, btn.dataset.vote);
      await refreshFeed();
    });
  });

  return el;
}

async function castVote(reportId, vote){
  // MVP: Transaction: write/overwrite user vote doc, and update counts in report doc
  // ملاحظة: هذا قابل للتحسين لاحقًا عبر Cloud Functions لمنع التلاعب.
  const reportRef = doc(db, "reports", reportId);
  const voteRef = doc(db, "reports", reportId, "votes", currentUser.uid);

  await runTransaction(db, async (tx) => {
    const reportSnap = await tx.get(reportRef);
    if(!reportSnap.exists()) throw new Error("التقرير غير موجود.");

    const report = reportSnap.data();

    const prevVoteSnap = await tx.get(voteRef);
    const prevVote = prevVoteSnap.exists() ? prevVoteSnap.data().vote : null;

    let yes = report.yesCount || 0;
    let no = report.noCount || 0;

    // remove previous effect
    if(prevVote === "yes") yes = Math.max(0, yes - 1);
    if(prevVote === "no") no = Math.max(0, no - 1);

    // apply new vote
    if(vote === "yes") yes += 1;
    if(vote === "no") no += 1;

    const trustScore = yes - no;

    tx.set(voteRef, { vote, createdAt: serverTimestamp() }, { merge: true });
    // update report counts (MVP)
    tx.set(reportRef, { yesCount: yes, noCount: no, trustScore }, { merge: true });
  });
}

// Map helpers
function ensureMap(){
  if(map) return;
  map = L.map("map").setView([currentPos?.lat || 0, currentPos?.lng || 0], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);
}

function clearMarkers(){
  markers.forEach(m => m.remove());
  markers = [];
}

function renderMapMarkers(list){
  ensureMap();
  clearMarkers();

  if(currentPos){
    const me = L.marker([currentPos.lat, currentPos.lng]).addTo(map);
    me.bindPopup("موقعي الحالي");
    markers.push(me);
  }

  list.forEach(r => {
    const loc = r.location;
    const m = L.marker([loc.latitude, loc.longitude]).addTo(map);
    m.bindPopup(`<b>${escapeHtml(r.type)}</b><br>${escapeHtml(r.text)}<br>✅ ${r.yesCount||0} | ❌ ${r.noCount||0}`);
    markers.push(m);
  });
}

function renderMapMarkersFromFeed(){
  // إذا أردت، يمكننا لاحقًا تخزين آخر قائمة محمّلة لتفادي إعادة التحميل
  refreshFeed();
}

function escapeHtml(str){
  return (str ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
