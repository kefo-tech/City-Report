import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { 
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  getFirestore, doc, setDoc, getDoc, addDoc, collection,
  serverTimestamp, query, where, orderBy, limit, getDocs, GeoPoint
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import {
  geohashForLocation, geohashQueryBounds, distanceBetween
} from "https://cdn.skypack.dev/geofire-common@6.0.4";

const firebaseConfig = {
  apiKey: "AIzaSyDBpj59oQ4BbSCLQi117Rn-gZjZ7awujV4",
  authDomain: "report-77313.firebaseapp.com",
  projectId: "report-77313",
  storageBucket: "report-77313.appspot.com",
  messagingSenderId: "664112522932",
  appId: "1:664112522932:web:ed636e68015bd089fb19e1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = s => document.querySelector(s);

const btnAdd=$("#btnAdd"), btnAuth=$("#btnAuth"), btnLogout=$("#btnLogout");
const modalAuth=$("#modalAuth"), modalAdd=$("#modalAdd");
const status=$("#status");

btnAuth.onclick=()=>modalAuth.classList.remove("hidden");
btnAdd.onclick=()=>modalAdd.classList.remove("hidden");
btnLogout.onclick=()=>signOut(auth);

onAuthStateChanged(auth, user=>{
  if(user){
    btnAuth.classList.add("hidden");
    btnLogout.classList.remove("hidden");
    status.textContent="مرحباً "+(user.displayName||user.email);
  }else{
    btnAuth.classList.remove("hidden");
    btnLogout.classList.add("hidden");
    status.textContent="غير مسجل الدخول";
  }
});

$("#btnLogin").onclick=async()=>{
  try{
    await signInWithEmailAndPassword(auth,$("#authEmail").value,$("#authPass").value);
    modalAuth.classList.add("hidden");
  }catch(e){ $("#authMsg").textContent=e.message; }
};

$("#btnRegister").onclick=async()=>{
  try{
    const c=await createUserWithEmailAndPassword(auth,$("#authEmail").value,$("#authPass").value);
    await updateProfile(c.user,{displayName:$("#authName").value});
    modalAuth.classList.add("hidden");
  }catch(e){ $("#authMsg").textContent=e.message; }
};

$("#btnSubmitReport").onclick=async()=>{
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{
      const lat=pos.coords.latitude,lng=pos.coords.longitude;
      await addDoc(collection(db,"reports"),{
        text:$("#reportText").value,
        type:$("#reportType").value,
        location:new GeoPoint(lat,lng),
        geohash:geohashForLocation([lat,lng]),
        createdAt:serverTimestamp()
      });
      $("#addMsg").textContent="تم نشر البلاغ بنجاح";
    }catch(e){ $("#addMsg").textContent=e.message; }
  });
};
