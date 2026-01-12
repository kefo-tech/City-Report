/* City Report - MVP (No ES Modules) */

(function () {
  // ====== Firebase Config (ضعه كما هو عندك) ======
  const firebaseConfig = {
    apiKey: "AIzaSyDBpj59oQ4BbSCLQi117Rn-gZjZ7awujV4",
    authDomain: "report-77313.firebaseapp.com",
    projectId: "report-77313",
    storageBucket: "report-77313.appspot.com",
    messagingSenderId: "664112522932",
    appId: "1:664112522932:web:ed636e68015bd089fb19e1"
  };

  // ====== Helpers ======
  const $ = (s) => document.querySelector(s);
  const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };
  const show = (el) => el && el.classList.remove("hidden");
  const hide = (el) => el && el.classList.add("hidden");

  function escapeHtml(str) {
    return (str ?? "").toString()
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Haversine distance in meters
  function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  // ====== UI refs ======
  const statusEl = $("#status");
  const feedEl = $("#feed");

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

  const radiusEl = $("#radius");
  const typeFilterEl = $("#typeFilter");

  // Tabs
  document.querySelectorAll(".tab").forEach(t => {
    on(t, "click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      const tab = t.dataset.tab;
      if (tab === "feed") {
        show($("#tab-feed")); hide($("#tab-map"));
      } else {
        hide($("#tab-feed")); show($("#tab-map"));
        ensureMap();
        renderMapMarkers(lastRenderedReports);
      }
    });
  });

  // ====== Firebase init ======
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (e) {
    // if already initialized
  }
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let currentPos = null; // {lat,lng}
  let lastRenderedReports = [];

  // ====== Map ======
  let map = null;
  let markers = [];
  function ensureMap() {
    if (map) return;
    map = L.map("map").setView([currentPos?.lat || 0, currentPos?.lng || 0], 15);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);
  }
  function clearMarkers() {
    markers.forEach(m => m.remove());
    markers = [];
  }
  function renderMapMarkers(list) {
    if (!$("#tab-map") || $("#tab-map").classList.contains("hidden")) return;
    ensureMap();
    clearMarkers();

    if (currentPos) {
      const me = L.marker([currentPos.lat, currentPos.lng]).addTo(map);
      me.bindPopup("موقعي الحالي");
      markers.push(me);
      map.setView([currentPos.lat, currentPos.lng], 15);
    }

    list.forEach(r => {
      const loc = r.location;
      const m = L.marker([loc.latitude, loc.longitude]).addTo(map);
      m.bindPopup(`<b>${escapeHtml(r.type)}</b><br>${escapeHtml(r.text)}<br>✅ ${r.yesCount||0} | ❌ ${r.noCount||0}`);
      markers.push(m);
    });
  }

  // ====== Location ======
  async function locate() {
    statusEl.textContent = "جارٍ تحديد موقعك…";
    currentPos = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
      );
    });

    if (!currentPos) {
      statusEl.textContent = "تعذر تحديد الموقع. فعّل GPS وأذونات الموقع ثم حاول مجددًا.";
      return null;
    }

    statusEl.textContent = `تم تحديد موقعك. lat:${currentPos.lat.toFixed(5)} lng:${currentPos.lng.toFixed(5)}`;
    if (map) map.setView([currentPos.lat, currentPos.lng], 16);
    return currentPos;
  }

  // ====== Auth ======
  auth.onAuthStateChanged(async (u) => {
    currentUser = u || null;
    if (currentUser) {
      hide(btnAuth);
      show(btnLogout);
      statusEl.textContent = `مرحبًا ${currentUser.displayName || currentUser.email} — يتم تحميل البلاغات…`;
      await ensureUserDoc();
    } else {
      show(btnAuth);
      hide(btnLogout);
      statusEl.textContent = "غير مسجل. يمكنك التصفح، لكن إضافة/تصويت يحتاج تسجيل دخول.";
    }
    await refreshFeed();
  });

  async function ensureUserDoc() {
    const ref = db.collection("users").doc(currentUser.uid);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        displayName: currentUser.displayName || "مستخدم",
        email: currentUser.email || "",
        emailVerified: !!currentUser.emailVerified,
        reputationScore: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  // ====== UI events ======
  on(btnAuth, "click", () => show(modalAuth));
  on(btnLogout, "click", async () => auth.signOut());

  on(btnLocate, "click", async () => { await locate(); await refreshFeed(); });
  on(btnRefresh, "click", refreshFeed);
  on(radiusEl, "change", refreshFeed);
  on(typeFilterEl, "change", refreshFeed);

  on(btnAdd, "click", async () => {
    addMsg.textContent = "";
    if (!currentUser) {
      addMsg.textContent = "يجب تسجيل الدخول لإضافة بلاغ.";
      show(modalAuth);
      return;
    }
    if (!currentPos) await locate();
    show(modalAdd);
  });

  on($("#btnLogin"), "click", async () => {
    authMsg.textContent = "";
    try {
      await auth.signInWithEmailAndPassword(authEmail.value.trim(), authPass.value);
      hide(modalAuth);
    } catch (e) {
      authMsg.textContent = e.message;
    }
  });

  on($("#btnRegister"), "click", async () => {
    authMsg.textContent = "";
    const email = authEmail.value.trim();
    const pass = authPass.value;
    const name = authName.value.trim() || "مستخدم";
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, pass);
      await cred.user.updateProfile({ displayName: name });
      await db.collection("users").doc(cred.user.uid).set({
        displayName: name,
        email,
        emailVerified: !!cred.user.emailVerified,
        reputationScore: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      hide(modalAuth);
    } catch (e) {
      authMsg.textContent = e.message;
    }
  });

  on($("#btnSubmitReport"), "click", async () => {
    addMsg.textContent = "";
    const text = reportText.value.trim();
    const type = reportType.value;

    if (!currentUser) { addMsg.textContent = "يجب تسجيل الدخول."; return; }
    if (text.length < 3) { addMsg.textContent = "الوصف قصير جدًا."; return; }
    if (!currentPos) await locate();
    if (!currentPos) { addMsg.textContent = "لم يتم تحديد موقعك بعد."; return; }

    try {
      await db.collection("reports").add({
        userId: currentUser.uid,
        userName: currentUser.displayName || currentUser.email || "مستخدم",
        type,
        text,
        location: new firebase.firestore.GeoPoint(currentPos.lat, currentPos.lng),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        yesCount: 0,
        noCount: 0,
        trustScore: 0,
        status: "new"
      });

      reportText.value = "";
      hide(modalAdd);
      await refreshFeed();
    } catch (e) {
      addMsg.textContent = e.message;
    }
  });

  // ====== Feed ======
  async function refreshFeed() {
    feedEl.innerHTML = "";
    const radiusMeters = parseInt(radiusEl.value, 10) || 500;
    const typeFilter = typeFilterEl.value || "all";

    if (!currentPos) await locate();
    if (!currentPos) {
      feedEl.innerHTML = `<div class="post"><div class="small">لا يمكن عرض البلاغات دون موقع.</div></div>`;
      return;
    }

    try {
      // MVP: جلب آخر 100 بلاغ
      const snap = await db.collection("reports")
        .orderBy("createdAt", "desc")
        .limit(100)
        .get();

      const all = [];
      snap.forEach(d => all.push({ id: d.id, ...d.data() }));

      const filtered = all
        .map(r => {
          const loc = r.location;
          const d = distanceMeters(currentPos.lat, currentPos.lng, loc.latitude, loc.longitude);
          return { ...r, distanceMeters: d };
        })
        .filter(r => r.distanceMeters <= radiusMeters)
        .filter(r => typeFilter === "all" ? true : r.type === typeFilter)
        .sort((a, b) => {
          if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
          return (b.trustScore || 0) - (a.trustScore || 0);
        });

      lastRenderedReports = filtered;

      if (filtered.length === 0) {
        feedEl.innerHTML = `<div class="post"><div class="small">لا توجد بلاغات ضمن النطاق المحدد.</div></div>`;
      } else {
        filtered.forEach(r => feedEl.appendChild(renderPost(r)));
      }

      renderMapMarkers(filtered);
    } catch (e) {
      statusEl.textContent = "خطأ تحميل البلاغات: " + e.message;
    }
  }

  function renderPost(r) {
    const el = document.createElement("div");
    el.className = "post";

    const yes = r.yesCount || 0;
    const no = r.noCount || 0;
    const trust = r.trustScore ?? (yes - no);

    el.innerHTML = `
      <div class="post-head">
        <div>
          <span class="badge">📌 ${escapeHtml(r.type)}</span>
          <span class="badge">📍 ${r.distanceMeters}م</span>
          <span class="badge">✅ ${yes} | ❌ ${no} | 🧭 ${trust}</span>
        </div>
        <div class="meta">بواسطة: ${escapeHtml(r.userName || "مستخدم")}</div>
      </div>

      <div class="post-text">${escapeHtml(r.text)}</div>

      <div class="post-actions">
        <button class="btn" data-openmap="${r.id}">عرض على الخريطة</button>
        <button class="btn primary" data-vote="yes" data-id="${r.id}">صادق (${yes})</button>
        <button class="btn danger" data-vote="no" data-id="${r.id}">كاذب (${no})</button>
      </div>
    `;

    on(el.querySelector('[data-openmap]'), "click", () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelector('.tab[data-tab="map"]').classList.add("active");
      hide($("#tab-feed")); show($("#tab-map"));
      ensureMap();
      const loc = r.location;
      map.setView([loc.latitude, loc.longitude], 18);
      renderMapMarkers(lastRenderedReports);
    });

    el.querySelectorAll("[data-vote]").forEach(btn => {
      on(btn, "click", async () => {
        if (!currentUser) { show(modalAuth); return; }
        await castVote(r.id, btn.dataset.vote);
        await refreshFeed();
      });
    });

    return el;
  }

  async function castVote(reportId, vote) {
    const reportRef = db.collection("reports").doc(reportId);
    const voteRef = reportRef.collection("votes").doc(currentUser.uid);

    await db.runTransaction(async (tx) => {
      const reportSnap = await tx.get(reportRef);
      if (!reportSnap.exists) throw new Error("البلاغ غير موجود.");

      const report = reportSnap.data();
      const prevSnap = await tx.get(voteRef);
      const prevVote = prevSnap.exists ? prevSnap.data().vote : null;

      let yes = report.yesCount || 0;
      let no = report.noCount || 0;

      if (prevVote === "yes") yes = Math.max(0, yes - 1);
      if (prevVote === "no") no = Math.max(0, no - 1);

      if (vote === "yes") yes += 1;
      if (vote === "no") no += 1;

      const trustScore = yes - no;

      tx.set(voteRef, { vote, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      tx.set(reportRef, { yesCount: yes, noCount: no, trustScore }, { merge: true });
    });
  }

})();
