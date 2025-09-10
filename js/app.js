// js/app.js
import { db, auth, signInAnonymously } from "./firebase-init.js";
import {
  ref, set, push, onValue, onChildAdded, serverTimestamp,
  update, runTransaction, get, remove, child
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const uidKey = 'local_uid_v1';
let uid = localStorage.getItem(uidKey) || null;
let currentRoom = null;
let myName = 'ضيف' + Math.floor(Math.random()*900+100);
let role = null;
let heartbeatTimer = null;

// UI
const statusText = document.getElementById('statusText');
const btnFind = document.getElementById('btn-find');
const btnLeave = document.getElementById('btn-leave');
const noRoom = document.getElementById('noRoom');
const inRoom = document.getElementById('inRoom');
const myRoleEl = document.getElementById('myRole');
const opponentNameEl = document.getElementById('opponentName');
const challengeText = document.getElementById('challengeText');
const challengeFrom = document.getElementById('challengeFrom');
const challengeTs = document.getElementById('challengeTs');
const btnAccept = document.getElementById('btn-accept');
const btnWrite = document.getElementById('btn-write');
const btnRefuse = document.getElementById('btn-refuse');
const btnComplete = document.getElementById('btn-complete');
const messagesEl = document.getElementById('messages');
const eventsEl = document.getElementById('events');
const messageInput = document.getElementById('messageInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const reportBtn = document.getElementById('reportBtn');

// Helpers
const timeNow = () => Date.now();
function setStatus(s){ statusText.textContent = s; }
function addEvent(msg){ const el = document.createElement('div'); el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`; eventsEl.appendChild(el); eventsEl.scrollTop = eventsEl.scrollHeight; }
function addMessage(text, who='me'){ const el = document.createElement('div'); el.className = 'message ' + (who==='me' ? 'me' : 'other'); el.textContent = text; messagesEl.appendChild(el); messagesEl.scrollTop = messagesEl.scrollHeight; }

// Authentication (anonymous)
async function authAnon(){
  setStatus('جارٍ الاتصال...');
  try{
    const res = await signInAnonymously(auth);
    uid = res.user.uid;
    localStorage.setItem(uidKey, uid);
    setStatus('متصل');
    addEvent('تم تسجيل الدخول كـ ' + uid.slice(0,6));
  }catch(e){
    console.error(e);
    setStatus('خطأ في الاتصال');
  }
}

// Heartbeat presence
function startHeartbeat(){
  if(!uid) return;
  const presRef = ref(db, `presence/${uid}`);
  const setPres = () => {
    set(presRef, { online: true, lastSeen: serverTimestamp() }).catch(e=>console.warn(e));
  };
  setPres();
  heartbeatTimer = setInterval(setPres, 10000);
  window.addEventListener('beforeunload', ()=> {
    remove(presRef);
  });
}

// Matchmaking: push uid to waiting queue and try to pair with existing waiting
async function findPartner(){
  setStatus('في انتظار شريك...');
  // Add to waiting list
  await set(ref(db, `queues/waiting/${uid}`), { ts: timeNow(), name: myName });

  // Try to match with someone else using transaction to be atomic
  runTransaction(ref(db, `matchmaker/lock`), current => {
    if (current === null) { return { owner: uid, ts: timeNow() }; }
    return; // abort if lock exists
  }).then(async (lockRes) => {
    if (!lockRes.committed) {
      // someone else holds lock; just wait for onChildAdded to rooms or manual polling
      addEvent('انتظار...');
      return;
    }
    // acquire lock; try to pop two users
    const waitingRef = ref(db, 'queues/waiting');
    const snap = await get(waitingRef);
    const list = snap.val() || {};
    // find first two unique uids (including self)
    const uids = Object.keys(list).slice(0,2);
    if(uids.length < 2){
      // release lock
      await remove(ref(db, `matchmaker/lock`));
      addEvent('لا يوجد شريك الآن، انتظر.');
      return;
    }
    // create room id
    const roomId = 'room_' + Date.now();
    const playersData = {};
    // randomly assign roles
    const shuffled = uids.sort(()=>Math.random()-0.5);
    playersData[shuffled[0]] = { displayName: list[shuffled[0]].name || 'لاسم', role: 'حاكم', connected: true, joinedAt: timeNow() };
    playersData[shuffled[1]] = { displayName: list[shuffled[1]].name || 'لاسم', role: 'محكوم', connected: true, joinedAt: timeNow() };
    await set(ref(db, `rooms/${roomId}`), {
      players: playersData,
      state: 'pending',
      createdAt: timeNow()
    });
    // remove from queue
    for(const id of uids) await remove(ref(db, `queues/waiting/${id}`));
    // release lock
    await remove(ref(db, `matchmaker/lock`));
    addEvent('تم إنشاء غرفة: ' + roomId);
  }).catch(err => {
    console.error(err);
    addEvent('خطأ أثناء الـmatching');
    remove(ref(db, `matchmaker/lock`)).catch(()=>{});
  });
}

// Listener: when user gets assigned a room, pick it up
onChildAdded(ref(db, 'rooms'), async (snap) => {
  const roomId = snap.key;
  const data = snap.val();
  if(!data || !data.players) return;
  if(data.players[uid]){
    // joined
    currentRoom = roomId;
    role = data.players[uid].role;
    myRoleEl.textContent = role;
    opponentNameEl.textContent = Object.values(data.players).find(p => p && p.displayName && p.displayName !== data.players[uid].displayName)?.displayName || 'الخصم';
    noRoom.classList.add('hidden');
    inRoom.classList.remove('hidden');
    btnLeave.classList.remove('hide');
    addEvent('انضممت للغرفة: ' + roomId + ' دورك: ' + role);
    // attach room listeners
    attachRoomListeners(roomId);
  }
});

// Attach listeners for a room
function attachRoomListeners(roomId){
  const roomRef = ref(db, `rooms/${roomId}`);
  // listen for changes to challenge
  onValue(child(roomRef, 'challenge'), (snap) => {
    const ch = snap.val();
    if(!ch){
      challengeText.textContent = 'لم يتم اختيار تحدي بعد.';
      challengeFrom.textContent = '';
      challengeTs.textContent = '';
      btnAccept.classList.remove('hidden');
      btnWrite.classList.remove('hidden');
      btnRefuse.classList.remove('hidden');
      btnComplete.classList.add('hide');
      return;
    }
    challengeText.textContent = ch.text;
    challengeFrom.textContent = ch.fromUid === uid ? 'أنت' : 'الحاكم';
    challengeTs.textContent = new Date(ch.createdAt || Date.now()).toLocaleTimeString();
    // show/hide buttons according to role
    if(role === 'محكوم'){
      btnAccept.classList.add('hidden');
      btnWrite.classList.add('hidden');
      btnRefuse.classList.add('hidden');
      btnComplete.classList.remove('hide');
    }
    if(role === 'حاكم'){
      btnAccept.classList.remove('hidden');
      btnWrite.classList.remove('hidden');
      btnRefuse.classList.remove('hidden');
      btnComplete.classList.add('hide');
    }
  });

  // messages
  onChildAdded(child(roomRef, 'messages'), (snap) => {
    const m = snap.val();
    if(!m) return;
    addMessage(`${m.from === uid ? 'أنت' : 'الخصم'}: ${m.text}`, m.from === uid ? 'me' : 'other');
  });
}

// UI actions
btnFind.addEventListener('click', async () => {
  await findPartner();
});
btnLeave.addEventListener('click', async () => {
  if(!currentRoom) return;
  await remove(ref(db, `rooms/${currentRoom}/players/${uid}`));
  addEvent('غادرت الغرفة');
  currentRoom = null;
  inRoom.classList.add('hidden');
  noRoom.classList.remove('hidden');
  btnLeave.classList.add('hide');
});

btnWrite.addEventListener('click', async () => {
  const text = prompt('اكتب التحدي الذي تريد عرضه:');
  if(!text) return;
  if(!currentRoom) return alert('ليس لديك غرفة الآن');
  await set(ref(db, `rooms/${currentRoom}/challenge`), { text, fromUid: uid, createdAt: timeNow(), accepted:false, completed:false });
  addEvent('نشرت تحدي جديد');
});

btnAccept.addEventListener('click', async () => {
  // حاكم يؤكد التحدي -> ببساطة نترك المحكوم يتفاعل
  alert('التحدي معروض للمحكوم. استنى الضغط على تم.');
});

btnComplete.addEventListener('click', async () => {
  if(!currentRoom) return;
  // نمنع تغرير الـcompleted من أي حد — فقط المحكوم يمكنه الضغط
  const challengeRef = ref(db, `rooms/${currentRoom}/challenge`);
  runTransaction(challengeRef, (ch) => {
    if(!ch) return ch;
    if(ch.completed) return; // already completed
    ch.completed = true;
    ch.completedBy = uid;
    ch.completedAt = timeNow();
    return ch;
  }).then(res => {
    if(res.committed){
      addEvent('تم تنفيذ التحدي وطلب التأكيد من الحاكم.');
      // نخبر الحاكم عبر رسالة
      push(ref(db, `rooms/${currentRoom}/messages`), { from: uid, text: 'المحكوم ضغط "تم" لتنفيذ التحدي', ts: timeNow() });
    } else {
      addEvent('لم يتم تسجيل الاكتمال (ربما تم مسبقاً).');
    }
  });
});

sendMsgBtn.addEventListener('click', async () => {
  const txt = messageInput.value.trim();
  if(!txt || !currentRoom) return;
  await push(ref(db, `rooms/${currentRoom}/messages`), { from: uid, text: txt, ts: timeNow() });
  messageInput.value = '';
});

reportBtn.addEventListener('click', async () => {
  if(!currentRoom) return alert('أنت لست في غرفة الآن');
  const reason = prompt('اكتب سبب البلاغ (مستخدم مسيء/تحدي مخالف/الخ):');
  if(!reason) return;
  const r = await push(ref(db, 'reports'), { roomId: currentRoom, reporter: uid, reason, ts: timeNow() });
  addEvent('تم إرسال البلاغ');
});

// start
(async function init(){
  await authAnon();
  startHeartbeat();
  setStatus('جاهز — اضغط ابدأ للعثور على شريك');
  // listen for direct assignment (in case the room was created earlier and we missed onChildAdded)
  onValue(ref(db, `rooms`), (snap) => {
    const rooms = snap.val() || {};
    for(const roomId of Object.keys(rooms)){
      if(rooms[roomId].players && rooms[roomId].players[uid]){
        // already in room
        if(!currentRoom){
          currentRoom = roomId;
          role = rooms[roomId].players[uid].role;
          myRoleEl.textContent = role;
          noRoom.classList.add('hidden');
          inRoom.classList.remove('hidden');
          btnLeave.classList.remove('hide');
          attachRoomListeners(roomId);
        }
      }
    }
  });
})();
