import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, push, update, onChildAdded, onChildChanged, onValue, onDisconnect, query, limitToLast, get, serverTimestamp, remove } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyALJPpmb3Hkdd162BgeeR9sz_wKmd_NPqM",
    authDomain: "chat-3e20c.firebaseapp.com",
    projectId: "chat-3e20c",
    storageBucket: "chat-3e20c.firebasestorage.app",
    messagingSenderId: "478481493082",
    appId: "1:478481493082:web:113ab87ab52e528cd6bc63",
    databaseURL: "https://chat-3e20c-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// State Management
let currentUser = null, targetUser = null;
let selectedIdentity = null; 
let replyContext = null, editContext = null;
let oldestKey = null, isFetchingHistory = false;
let offlineQueue = JSON.parse(localStorage.getItem('offlineQueue') || '[]');
let unreadCount = 0;
let firstUnreadKey = null;
window.loadedMessages = {}; 

// Notification & App State
const appStartTime = Date.now();
let swRegistration = null;
let lastNotifiedMsgId = null;

// Search State
let activeSearchTerm = "";
let searchMatches = [];
let currentSearchIndex = -1;

// Media & Calls State
let mediaRecorder = null, audioChunks = [], isRecordingAudio = false;
let localStream = null, peerConnection = null, currentCallRef = null, callTimer = null;
let activeCallMeta = null;
let currentFacingMode = "user";
const CHUNK_SIZE = 500 * 1024; 

// Celebration Particle Animation Engine State
let celebrationParticles = [];
let celebrationAnimationId = null;
let celebrationStreamEnd = 0;
let lastExecutedCelebrationToken = null;
let lastAvatarClickTime = 0;

const iceConfiguration = { iceServers: [{ urls: "stun:stun.relay.metered.ca:80" }, { urls: "turn:global.relay.metered.ca:80", username: "543072f0f5d6244071e0e5c5", credential: "I4+d+Z+jXxwve1mA" }] };

// IndexedDB Cache Setup
const dbName = "BroRaaCache";
let idb;
const initDB = () => new Promise((resolve) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = (e) => { idb = e.target.result; resolve(); };
});

const ui = {
    msgInput: document.getElementById("msg-input"),
    btnSend: document.getElementById("btn-send"),
    chatWindow: document.getElementById("chat-window"),
    fileInput: document.getElementById("file-input"),
    progressBar: document.getElementById("transfer-progress"),
    targetStatus: document.getElementById("target-status"),
    searchInput: document.getElementById("search-input")
};

/* --- Session & Portal Authentication --- */
window.addEventListener('DOMContentLoaded', () => {
    const session = localStorage.getItem("broraa_session");
    if (session === "Bro" || session === "Raa") {
        authenticateAs(session);
    }
});

document.getElementById("btn-bro").addEventListener("click", () => showPasswordPrompt("Bro"));
document.getElementById("btn-raa").addEventListener("click", () => showPasswordPrompt("Raa"));
document.getElementById("btn-auth-back").addEventListener("click", showIdentitySelection);
document.getElementById("btn-auth-submit").addEventListener("click", verifyPassword);
document.getElementById("auth-password").addEventListener("keydown", (e) => { if(e.key === 'Enter') verifyPassword(); });

document.getElementById("btn-logout").addEventListener("click", () => {
    localStorage.removeItem("broraa_session");
    location.reload(); 
});

function showPasswordPrompt(identity) {
    selectedIdentity = identity;
    document.getElementById("auth-step-1").classList.add("hidden");
    document.getElementById("auth-step-2").classList.remove("hidden");
    document.getElementById("auth-welcome").innerText = `Welcome, ${identity}`;
    document.getElementById("auth-password").value = "";
    document.getElementById("auth-error").classList.add("hidden");
    document.getElementById("auth-password").focus();
}

function showIdentitySelection() {
    selectedIdentity = null;
    document.getElementById("auth-step-2").classList.add("hidden");
    document.getElementById("auth-step-1").classList.remove("hidden");
}

function verifyPassword() {
    const pass = document.getElementById("auth-password").value;
    const correctPass = selectedIdentity === "Bro" ? "wifeu" : "hubbu";
    
    if (pass === correctPass) {
        localStorage.setItem("broraa_session", selectedIdentity);
        authenticateAs(selectedIdentity);
    } else {
        document.getElementById("auth-error").classList.remove("hidden");
    }
}

async function authenticateAs(identity) {
    currentUser = identity;
    targetUser = currentUser === "Bro" ? "Raa" : "Bro";
    document.getElementById("target-name").innerText = targetUser;
    document.getElementById("target-avatar").innerText = targetUser.charAt(0);
    document.getElementById("auth-screen").classList.add("hidden");
    
    await initDB();
    loadDraft();
    applyWallpaper();
    initializePresence();
    await registerServiceWorker(); 
    checkPermissionsFlow();
}

/* --- Permissions & Service Worker Setup --- */
async function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
        try {
            swRegistration = await navigator.serviceWorker.register('./sw.js');
        } catch (err) {
            console.error("Service Worker registration failed:", err);
        }
    }
}

function checkPermissionsFlow() {
    let notifGranted = "Notification" in window && Notification.permission === "granted";
    
    if (notifGranted && localStorage.getItem('media_perm_granted')) {
        finishSetup();
    } else {
        document.getElementById("permission-screen").classList.remove("hidden");
        updatePermissionUI();
    }
}

function updatePermissionUI() {
    if ("Notification" in window && Notification.permission === "granted") {
        const btn = document.getElementById("btn-perm-notif");
        btn.innerText = "Granted";
        btn.classList.add("granted");
    }
    if (localStorage.getItem('media_perm_granted')) {
        const btn = document.getElementById("btn-perm-media");
        btn.innerText = "Granted";
        btn.classList.add("granted");
    }
}

document.getElementById("btn-perm-notif").addEventListener("click", async () => {
    if ("Notification" in window) {
        const perm = await Notification.requestPermission();
        if (perm === "granted") updatePermissionUI();
    }
});

document.getElementById("btn-perm-media").addEventListener("click", async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(t => t.stop()); 
        localStorage.setItem('media_perm_granted', 'true');
        updatePermissionUI();
    } catch (err) {
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            audioStream.getTracks().forEach(t => t.stop());
            localStorage.setItem('media_perm_granted', 'true');
            updatePermissionUI();
        } catch (fallbackErr) {
            alert("Camera/Mic permission denied or hardware unavailable.");
        }
    }
});

document.getElementById("btn-perm-continue").addEventListener("click", () => {
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(console.error);
    }
    document.getElementById("permission-screen").classList.add("hidden");
    finishSetup();
});

function finishSetup() {
    document.getElementById("app-screen").classList.remove("hidden");
    initializeChatStream();
    initializeCallListener();
    initializePinnedListener();
    initializeSwipeToReply();
    initializeCelebrationListener();
    processOfflineQueue();
}

function notifyNewMessage(key, msg) {
    if (msg.sender === currentUser || key === lastNotifiedMsgId || document.hasFocus()) return;
    
    lastNotifiedMsgId = key;

    if (swRegistration && Notification.permission === "granted") {
        let bodyText = msg.body || (msg.image ? '📷 Image' : (msg.audio ? '🎵 Voice Message' : (msg.fileMeta ? '📄 File' : (msg.callMeta ? '📞 Call' : 'New message'))));
        
        swRegistration.showNotification(`New message from ${msg.sender}`, {
            body: bodyText,
            tag: 'broraa-chat', 
            renotify: true,
            vibrate: [200, 100, 200]
        });
    }
}

/* --- Storage & Cache --- */
function saveDraft() { localStorage.setItem(`draft_${currentUser}`, ui.msgInput.value); }
function loadDraft() { 
    const draft = localStorage.getItem(`draft_${currentUser}`);
    if(draft) { ui.msgInput.value = draft; toggleSendBtn(); }
}
ui.msgInput.addEventListener('input', saveDraft);

document.getElementById('btn-clear-cache').addEventListener('click', () => {
    indexedDB.deleteDatabase(dbName);
    localStorage.clear();
    alert("Cache cleared. Reload app.");
    location.reload();
});

/* --- UI & Menus --- */
document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('menu-dropdown').classList.toggle('hidden');
});
document.addEventListener('click', (e) => {
    if(!e.target.closest('.dropdown')) document.getElementById('menu-dropdown').classList.add('hidden');
});

document.getElementById('btn-wallpaper').addEventListener('click', () => document.getElementById('wallpaper-input').click());
document.getElementById('wallpaper-input').addEventListener('input', (e) => {
    localStorage.setItem('wallpaper', e.target.value);
    applyWallpaper();
});
function applyWallpaper() {
    const wp = localStorage.getItem('wallpaper');
    if(wp) document.documentElement.style.setProperty('--chat-bg', wp.startsWith('#') ? wp : `url(${wp})`);
}

function toggleSendBtn() {
    const hasText = !!ui.msgInput.value.trim();
    ui.btnSend.classList.toggle("hidden", !hasText);
    document.getElementById("btn-mic").classList.toggle("hidden", hasText);
}
ui.msgInput.addEventListener("input", toggleSendBtn);

/* --- Virtual Bro Chat Integration --- */
document.getElementById('btn-virtual-bro').addEventListener('click', () => {
    document.getElementById('menu-dropdown').classList.add('hidden');
    document.getElementById('virtual-bro-iframe').src = "https://its-me-you.github.io/doctor";
    document.getElementById('virtual-bro-overlay').classList.remove('hidden');
});
document.getElementById('btn-vb-close').addEventListener('click', () => {
    document.getElementById('virtual-bro-overlay').classList.add('hidden');
    document.getElementById('virtual-bro-iframe').src = "";
});
document.getElementById('btn-vb-fullscreen').addEventListener('click', () => {
    const overlay = document.getElementById('virtual-bro-overlay');
    if (!document.fullscreenElement) {
        overlay.requestFullscreen().catch(err => console.log("Fullscreen not supported or denied."));
    } else {
        document.exitFullscreen();
    }
});

/* --- Presence & Sync --- */
window.addEventListener('online', processOfflineQueue);
function processOfflineQueue() {
    if(!navigator.onLine || offlineQueue.length === 0) return;
    offlineQueue.forEach(msg => push(ref(db, "messages"), msg));
    offlineQueue = [];
    localStorage.setItem('offlineQueue', '[]');
}

function initializePresence() {
    const statusRef = ref(db, `presence/${currentUser}`);
    set(statusRef, { state: "online", last_changed: serverTimestamp() });
    onDisconnect(statusRef).set({ state: "offline", last_changed: serverTimestamp() });

    onValue(ref(db, `presence/${targetUser}`), (snap) => {
        const data = snap.val();
        if(!data) return;
        ui.targetStatus.innerText = data.state === "online" ? "online" : "offline";
        ui.targetStatus.className = data.state === "online" ? "online" : "offline";
    });
}

/* --- Core Messaging --- */
function initializeChatStream() {
    const messagesRef = query(ref(db, "messages"), limitToLast(40));
    
    onChildAdded(messagesRef, (snap) => {
        const msg = snap.val();
        if(!oldestKey) oldestKey = snap.key;
        window.loadedMessages[snap.key] = msg;
        renderMessageBubble(snap.key, msg);
        updateReadStatus(snap.key, msg);

        if (msg.timestamp > appStartTime) {
            notifyNewMessage(snap.key, msg);
        }
    });

    onChildChanged(ref(db, "messages"), (snap) => {
        window.loadedMessages[snap.key] = snap.val();
        updateMessageDOM(snap.key, snap.val());
    });
}

function updateReadStatus(key, msg) {
    if (msg.sender !== currentUser && msg.status !== 'seen') {
        if (!firstUnreadKey) {
            firstUnreadKey = key;
            document.getElementById('unread-jump').classList.remove('hidden');
        }
        const newStatus = document.hasFocus() ? 'seen' : 'delivered';
        if (msg.status !== newStatus) update(ref(db, `messages/${key}`), { status: newStatus });
    }
}

document.getElementById('unread-jump').addEventListener('click', () => {
    if(firstUnreadKey) window.jumpToMessage(firstUnreadKey);
    document.getElementById('unread-jump').classList.add('hidden');
});

async function sendMessage(body, image = null, audio = null, fileMeta = null, callLogMeta = null) {
    if (!body && !image && !audio && !fileMeta && !callLogMeta) return;
    const msg = {
        sender: currentUser, body, image, audio, fileMeta, callMeta: callLogMeta,
        timestamp: Date.now(), status: "sent", deleted: false, edited: false, reactions: {}
    };

    if (replyContext) { msg.replyTo = replyContext; cancelAction(); }
    if (editContext) { update(ref(db, `messages/${editContext}`), { body, edited: true }); cancelAction(); return; }

    if (navigator.onLine) {
        push(ref(db, "messages"), msg);
    } else {
        offlineQueue.push(msg);
        localStorage.setItem('offlineQueue', JSON.stringify(offlineQueue));
        renderMessageBubble('temp_' + Date.now(), {...msg, status: 'queued'});
    }
    
    ui.msgInput.value = "";
    localStorage.removeItem(`draft_${currentUser}`);
    toggleSendBtn();
}

ui.btnSend.addEventListener("click", () => sendMessage(ui.msgInput.value.trim()));
ui.msgInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(ui.msgInput.value.trim()); });

/* --- Pinned Messages --- */
function initializePinnedListener() {
    onValue(ref(db, 'chat_meta/pinned'), snap => {
        const data = snap.val();
        const pinBar = document.getElementById('pinned-bar');
        if(data) {
            pinBar.classList.remove('hidden');
            document.getElementById('pinned-content').innerText = `${data.sender}: ${data.text}`;
            pinBar.onclick = () => window.jumpToMessage(data.id);
        } else {
            pinBar.classList.add('hidden');
        }
    });
}
document.getElementById('btn-unpin').onclick = (e) => { e.stopPropagation(); remove(ref(db, 'chat_meta/pinned')); }

/* --- Message Rendering & Actions --- */
function renderMessageBubble(key, msg) {
    if (document.getElementById(`msg-${key}`)) return;
    
    const bubble = document.createElement("div");
    bubble.id = `msg-${key}`;
    bubble.className = `msg-bubble ${msg.sender === currentUser ? 'msg-right' : 'msg-left'}`;
    bubble.innerHTML = generateBubbleContent(msg, activeSearchTerm);
    
    bubble.addEventListener("click", (e) => {
        if(e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'IMG' || e.target.tagName === 'AUDIO' || msg.deleted) return;
        document.querySelectorAll('.msg-bubble').forEach(b => b.classList.remove('active'));
        bubble.classList.add("active");
        setTimeout(() => document.addEventListener('click', () => bubble.classList.remove('active'), {once: true}), 10);
    });
    
    bubble.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showEmojiPicker(e.clientX, e.clientY, key);
    });

    const menu = document.createElement("div");
    menu.className = "msg-actions";
    let menuHtml = `<button onclick="triggerReply('${key}', '${msg.sender}', '${(msg.body || 'Media').replace(/'/g, "\\'")}')">Reply</button>`;
    if (msg.body) menuHtml += `<button onclick="copyMessage('${msg.body.replace(/'/g, "\\'")}')">Copy</button>`;
    menuHtml += `<button onclick="pinMessage('${key}', '${msg.sender}', '${(msg.body || 'Media').replace(/'/g, "\\'")}')">Pin</button>`;
    if (msg.sender === currentUser) {
        if (!msg.image && !msg.audio && !msg.fileMeta && !msg.callMeta) menuHtml += `<button onclick="triggerEdit('${key}', '${msg.body.replace(/'/g, "\\'")}')">Edit</button>`;
        menuHtml += `<button onclick="deleteMessage('${key}')">Delete</button>`;
    }
    menu.innerHTML = menuHtml;
    bubble.appendChild(menu);

    ui.chatWindow.appendChild(bubble);
    if (!activeSearchTerm) ui.chatWindow.scrollTop = ui.chatWindow.scrollHeight;
}

function updateMessageDOM(key, msg) {
    const el = document.getElementById(`msg-${key}`);
    if (el) el.innerHTML = generateBubbleContent(msg, activeSearchTerm) + el.lastChild.outerHTML;
}

function generateBubbleContent(msg, searchTerm = "") {
    if (msg.deleted) return `<div class="msg-deleted">🚫 Message deleted</div>`;
    
    let html = msg.replyTo ? `<div class="quoted-msg" onclick="jumpToMessage('${msg.replyTo.id}')"><strong>${msg.replyTo.sender}</strong><br>${msg.replyTo.text}</div>` : "";
    
    if (msg.image) html += `<img src="${msg.image}" class="msg-image" onclick="openFullscreen('${msg.image}')">`;
    if (msg.audio) html += `<audio src="${msg.audio}" controls class="msg-audio"></audio>`;
    if (msg.fileMeta) html += `<a href="#" onclick="downloadFile('${msg.fileMeta.id}', '${msg.fileMeta.name}', ${msg.fileMeta.chunks})" class="msg-file"><ion-icon name="document"></ion-icon> ${msg.fileMeta.name}</a>`;
    
    if (msg.callMeta) {
        const icon = msg.callMeta.callType === 'video' ? 'videocam' : 'call';
        let statusText, color = "var(--text-dark)";
        if (msg.callMeta.status === 'completed') {
            const m = Math.floor(msg.callMeta.duration / 60);
            const s = msg.callMeta.duration % 60;
            statusText = `${msg.callMeta.callType} call • ${m}:${s.toString().padStart(2, '0')}`;
        } else {
            statusText = `Missed ${msg.callMeta.callType} call`;
            color = "#e74c3c";
        }
        html += `<div class="msg-call" style="color: ${color}">
                    <ion-icon name="${icon}"></ion-icon>
                    <div class="call-info">${statusText}</div>
                    <button onclick="launchCallInitiation('${msg.callMeta.callType}')"><ion-icon name="call"></ion-icon></button>
                 </div>`;
    }

    let bodyHtml = msg.body;
    if (bodyHtml && searchTerm) {
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        bodyHtml = bodyHtml.replace(regex, '<span class="search-highlight">$1</span>');
    }
    if (bodyHtml) html += `<div>${bodyHtml}</div>`;

    let reactionsHtml = '';
    if(msg.reactions) {
        const rx = Object.values(msg.reactions);
        if(rx.length > 0) reactionsHtml = `<div class="msg-reactions">${rx.join('')}</div>`;
    }

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let tick = msg.status === 'seen' ? `<ion-icon name="checkmark-done" class="tick-seen"></ion-icon>` : (msg.status === 'delivered' ? `<ion-icon name="checkmark-done" class="tick-delivered"></ion-icon>` : `<ion-icon name="checkmark" class="tick-sent"></ion-icon>`);

    html += `${reactionsHtml}<div class="msg-meta">${msg.edited ? '<span>(edited)</span>' : ''}<span>${time}</span> ${msg.sender === currentUser ? tick : ''}</div>`;
    return html;
}

/* --- Features (Copy, Jump, Reply, Swipe) --- */
window.copyMessage = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        const toast = document.getElementById('toast');
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2000);
    });
};

window.jumpToMessage = (id) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) { 
        el.scrollIntoView({behavior: 'smooth', block: 'center'}); 
        el.classList.add('search-focus'); 
        setTimeout(() => el.classList.remove('search-focus'), 1500); 
    }
};

window.triggerReply = (id, sender, text) => { replyContext = { id, sender, text }; document.getElementById("reply-preview").classList.remove("hidden"); ui.msgInput.focus(); };
window.triggerEdit = (id, text) => { editContext = id; ui.msgInput.value = text; document.getElementById("reply-preview").classList.remove("hidden"); ui.msgInput.focus(); };
window.deleteMessage = (key) => update(ref(db, `messages/${key}`), { deleted: true, body: null, image: null, audio: null, fileMeta: null, callMeta: null });
window.pinMessage = (id, sender, text) => set(ref(db, 'chat_meta/pinned'), { id, sender, text });
function cancelAction() { replyContext = editContext = null; document.getElementById("reply-preview").classList.add("hidden"); ui.msgInput.value = ""; toggleSendBtn(); }
document.getElementById("btn-cancel-action").addEventListener("click", cancelAction);

function initializeSwipeToReply() {
    let touchStartX = 0, touchStartY = 0, swipingElement = null, swipingMsgKey = null;
    ui.chatWindow.addEventListener('touchstart', e => {
        const bubble = e.target.closest('.msg-bubble');
        if(!bubble) return;
        touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY;
        swipingElement = bubble; swipingMsgKey = bubble.id.replace('msg-', '');
        bubble.style.transition = 'none';
    }, {passive: true});
    
    ui.chatWindow.addEventListener('touchmove', e => {
        if(!swipingElement) return;
        const diffX = e.touches[0].clientX - touchStartX;
        const diffY = e.touches[0].clientY - touchStartY;
        if(Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
            if (e.cancelable) e.preventDefault();
            const isRight = swipingElement.classList.contains('msg-right');
            let clamped = isRight ? Math.min(Math.max(diffX, -70), 0) : Math.min(Math.max(diffX, 0), 70);
            swipingElement.style.transform = `translateX(${clamped}px)`;
        } else {
            swipingElement.style.transform = ''; swipingElement = null;
        }
    }, {passive: false});
    
    ui.chatWindow.addEventListener('touchend', () => {
        if(!swipingElement) return;
        const trans = swipingElement.style.transform;
        swipingElement.style.transition = 'transform 0.15s linear';
        swipingElement.style.transform = '';
        if(trans) {
            const val = parseInt(trans.replace(/[^\d-]/g, ''));
            if(Math.abs(val) > 45) {
                const msg = window.loadedMessages[swipingMsgKey];
                if(msg) triggerReply(swipingMsgKey, msg.sender, msg.body || 'Media');
            }
        }
        swipingElement = null;
    });
}

/* --- Improved Search --- */
document.getElementById("btn-search").addEventListener("click", () => {
    document.getElementById("search-bar").classList.remove("hidden");
    ui.searchInput.focus();
});
document.getElementById("btn-close-search").addEventListener("click", () => {
    document.getElementById("search-bar").classList.add("hidden");
    ui.searchInput.value = "";
    activeSearchTerm = "";
    searchMatches = []; currentSearchIndex = -1;
    document.getElementById('search-count').innerText = "0/0";
    Object.keys(window.loadedMessages).forEach(key => updateMessageDOM(key, window.loadedMessages[key]));
});

let searchTimeout;
ui.searchInput.addEventListener("input", (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        activeSearchTerm = e.target.value.toLowerCase().trim();
        searchMatches = [];
        Object.keys(window.loadedMessages).forEach(key => {
            const msg = window.loadedMessages[key];
            if (activeSearchTerm && msg.body && msg.body.toLowerCase().includes(activeSearchTerm)) {
                searchMatches.push(key);
            }
            updateMessageDOM(key, msg);
        });
        currentSearchIndex = searchMatches.length > 0 ? searchMatches.length - 1 : -1;
        updateSearchNavigation();
    }, 200);
});

function updateSearchNavigation() {
    if (searchMatches.length === 0) {
        document.getElementById('search-count').innerText = "0/0";
        return;
    }
    document.getElementById('search-count').innerText = `${currentSearchIndex + 1}/${searchMatches.length}`;
    window.jumpToMessage(searchMatches[currentSearchIndex]);
}

document.getElementById('btn-search-up').onclick = () => {
    if(searchMatches.length > 0) {
        currentSearchIndex = (currentSearchIndex - 1 + searchMatches.length) % searchMatches.length;
        updateSearchNavigation();
    }
};
document.getElementById('btn-search-down').onclick = () => {
    if(searchMatches.length > 0) {
        currentSearchIndex = (currentSearchIndex + 1) % searchMatches.length;
        updateSearchNavigation();
    }
};

/* --- Reactions Constraint Fix --- */
const emojiPicker = document.getElementById('emoji-picker');
let activeReactKey = null;
function showEmojiPicker(x, y, key) {
    activeReactKey = key;
    emojiPicker.classList.remove('hidden');
    
    requestAnimationFrame(() => {
        const pickerRect = emojiPicker.getBoundingClientRect();
        let finalX = x;
        let finalY = y - 50;

        if (finalX + pickerRect.width > window.innerWidth) finalX = window.innerWidth - pickerRect.width - 15;
        if (finalX < 15) finalX = 15;

        if (finalY + pickerRect.height > window.innerHeight) finalY = window.innerHeight - pickerRect.height - 15;
        if (finalY < 15) finalY = 15;

        emojiPicker.style.left = `${finalX}px`;
        emojiPicker.style.top = `${finalY}px`;
    });
    
    setTimeout(() => document.addEventListener('click', () => emojiPicker.classList.add('hidden'), {once: true}), 10);
}
emojiPicker.addEventListener('click', e => {
    if(e.target.tagName === 'SPAN' && activeReactKey) {
        update(ref(db, `messages/${activeReactKey}/reactions`), { [currentUser]: e.target.innerText });
    }
});

/* --- Media, Chunking, Voice Note & Cache --- */
document.getElementById("btn-mic").addEventListener("click", async function() {
    if (!isRecordingAudio) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.onload = () => sendMessage(null, null, reader.result);
                reader.readAsDataURL(audioBlob);
                stream.getTracks().forEach(t => t.stop());
            };
            
            mediaRecorder.start();
            isRecordingAudio = true;
            this.classList.add("recording");
        } catch (err) {
            alert("Microphone permission denied or unavailable.");
        }
    } else {
        mediaRecorder.stop();
        isRecordingAudio = false;
        this.classList.remove("recording");
    }
});

document.getElementById("btn-attach").addEventListener("click", () => ui.fileInput.click());
ui.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = Math.min(800 / img.width, 1);
                canvas.width = img.width * scale; canvas.height = img.height * scale;
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                sendMessage(null, canvas.toDataURL('image/jpeg', 0.7), null);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    } else {
        if(file.size > 5 * 1024 * 1024) return alert("File exceeds 5MB chunking limit.");
        const fileId = `file_${Date.now()}`;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        ui.progressBar.classList.remove('hidden');
        
        for (let i = 0; i < totalChunks; i++) {
            const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(chunk); });
            await set(ref(db, `files/${fileId}/chunk_${i}`), base64);
            document.getElementById('progress-bar').value = ((i + 1) / totalChunks) * 100;
        }
        
        ui.progressBar.classList.add('hidden');
        sendMessage(null, null, null, { id: fileId, name: file.name, type: file.type, size: file.size, chunks: totalChunks });
    }
    e.target.value = '';
});

window.downloadFile = async (fileId, name, totalChunks) => {
    const tx = idb.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const request = store.get(fileId);
    
    request.onsuccess = async () => {
        let finalData = "";
        if (request.result) {
            finalData = request.result.data;
        } else {
            ui.progressBar.classList.remove('hidden');
            document.getElementById('progress-text').innerText = "Downloading...";
            for (let i = 0; i < totalChunks; i++) {
                const snap = await get(ref(db, `files/${fileId}/chunk_${i}`));
                finalData += snap.val().split(',')[1];
                document.getElementById('progress-bar').value = ((i + 1) / totalChunks) * 100;
            }
            finalData = `data:application/octet-stream;base64,${finalData}`;
            const wTx = idb.transaction('files', 'readwrite');
            wTx.objectStore('files').put({ id: fileId, data: finalData });
            ui.progressBar.classList.add('hidden');
        }
        const a = document.createElement("a");
        a.href = finalData;
        a.download = name;
        a.click();
    };
};

/* --- Image Zoom & Fullscreen --- */
let zoomScale = 1;
window.openFullscreen = (src) => {
    const viewer = document.getElementById('image-viewer');
    const img = document.getElementById('viewer-img');
    img.src = src; zoomScale = 1; img.style.transform = `scale(1)`;
    viewer.classList.remove('hidden');
};
document.getElementById('btn-close-viewer').onclick = () => document.getElementById('image-viewer').classList.add('hidden');
document.getElementById('btn-download-viewer').onclick = () => {
    const src = document.getElementById('viewer-img').src;
    const a = document.createElement("a");
    a.href = src; a.download = `BroRaa_Image_${Date.now()}.jpg`; a.click();
};
document.getElementById('viewer-img').addEventListener('wheel', e => {
    e.preventDefault();
    zoomScale += e.deltaY * -0.001;
    zoomScale = Math.min(Math.max(1, zoomScale), 4);
    e.target.style.transform = `scale(${zoomScale})`;
});

/* --- Calling, WebRTC & History --- */
const callUI = { screen: document.getElementById("call-screen"), status: document.getElementById("call-status-text"), duration: document.getElementById("call-duration"), local: document.getElementById("local-video"), remote: document.getElementById("remote-video") };

window.launchCallInitiation = async (type) => {
    setupCallingUI("outgoing");
    activeCallMeta = { sender: currentUser, type: type, status: 'dialing', startTime: 0 };
    callUI.status.innerText = `Calling ${targetUser}...`;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: type === "video" ? { facingMode: currentFacingMode } : false, audio: true });
        callUI.local.srcObject = localStream;
        if(type === "audio") callUI.local.classList.add("hidden");
    } catch (err) { executeCallTeardown(); return; }

    peerConnection = new RTCPeerConnection(iceConfiguration);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    peerConnection.ontrack = (e) => callUI.remote.srcObject = e.streams[0];
    peerConnection.onicecandidate = (e) => { if (e.candidate) push(ref(db, `calls/signals/ice_${targetUser}`), e.candidate.toJSON()); };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    currentCallRef = ref(db, `calls/active/${targetUser}`);
    await set(currentCallRef, { type, sender: currentUser, status: "dialing", sdp: offer.sdp });

    onValue(currentCallRef, async (snap) => {
        const data = snap.val();
        if (data && data.status === "connected" && !peerConnection.currentRemoteDescription) {
            callUI.status.classList.add('hidden');
            if(activeCallMeta) { activeCallMeta.status = 'connected'; activeCallMeta.startTime = Date.now(); }
            startCallTimer();
            await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.answerSdp }));
            bindIceCandidatesCollector();
        }
        if (!data && peerConnection) executeCallTeardown();
    });
};

document.getElementById("btn-audio-call").addEventListener("click", () => launchCallInitiation("audio"));
document.getElementById("btn-video-call").addEventListener("click", () => launchCallInitiation("video"));
document.getElementById("btn-hangup-call").addEventListener("click", executeCallTeardown);

function initializeCallListener() {
    onValue(ref(db, `calls/active/${currentUser}`), async (snap) => {
        const data = snap.val();
        if (!data) return executeCallTeardown();
        if (data.status === "dialing") {
            if (!document.hasFocus() && swRegistration && Notification.permission === "granted") {
                swRegistration.showNotification(`Incoming ${data.type} call from ${data.sender}`, {
                    tag: 'broraa-call',
                    renotify: true,
                    vibrate: [500, 250, 500, 250, 500]
                });
            }

            setupCallingUI("incoming");
            activeCallMeta = { sender: data.sender, type: data.type, status: 'incoming', startTime: 0 };
            callUI.status.innerText = `Incoming ${data.type} call...`;
            document.getElementById("btn-accept-call").onclick = async () => {
                document.getElementById("btn-accept-call").classList.add("hidden");
                localStream = await navigator.mediaDevices.getUserMedia({ video: data.type === "video", audio: true });
                callUI.local.srcObject = localStream;
                if(data.type === "audio") callUI.local.classList.add("hidden");

                peerConnection = new RTCPeerConnection(iceConfiguration);
                localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
                peerConnection.ontrack = (e) => callUI.remote.srcObject = e.streams[0];
                peerConnection.onicecandidate = (e) => { if (e.candidate) push(ref(db, `calls/signals/ice_${data.sender}`), e.candidate.toJSON()); };

                await peerConnection.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);

                set(ref(db, `calls/active/${currentUser}`), { ...data, status: "connected", answerSdp: answer.sdp });
                callUI.status.classList.add('hidden');
                startCallTimer();
                bindIceCandidatesCollector();
            };
        }
    });
}

function bindIceCandidatesCollector() {
    onChildAdded(ref(db, `calls/signals/ice_${currentUser}`), (snap) => {
        if (snap.val() && peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(snap.val()));
    });
}

document.getElementById('btn-toggle-mic').onclick = function() {
    const track = localStream?.getAudioTracks()[0];
    if(track) { track.enabled = !track.enabled; this.classList.toggle('muted'); }
};
document.getElementById('btn-toggle-video').onclick = function() {
    const track = localStream?.getVideoTracks()[0];
    if(track) { track.enabled = !track.enabled; this.classList.toggle('muted'); }
};
document.getElementById('btn-switch-cam').onclick = async function() {
    if(!localStream?.getVideoTracks().length) return;
    currentFacingMode = currentFacingMode === "user" ? "environment" : "user";
    const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: currentFacingMode } });
    const newTrack = newStream.getVideoTracks()[0];
    const sender = peerConnection.getSenders().find(s => s.track.kind === 'video');
    sender.replaceTrack(newTrack);
    localStream.removeTrack(localStream.getVideoTracks()[0]);
    localStream.addTrack(newTrack);
    callUI.local.srcObject = localStream;
};
document.getElementById('btn-fullscreen-call').onclick = () => document.getElementById('video-grid').classList.toggle('fullscreen');

function startCallTimer() {
    callUI.duration.classList.remove('hidden');
    const start = Date.now();
    callTimer = setInterval(() => {
        const s = Math.floor((Date.now() - start)/1000);
        callUI.duration.innerText = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    }, 1000);
}

function setupCallingUI(mode) {
    callUI.screen.classList.remove("hidden"); callUI.local.classList.remove("hidden");
    document.getElementById("btn-accept-call").classList.toggle("hidden", mode !== "incoming");
}

function executeCallTeardown() {
    callUI.screen.classList.add("hidden"); callUI.duration.classList.add('hidden');
    callUI.status.classList.remove('hidden');
    clearInterval(callTimer);
    
    if (activeCallMeta && activeCallMeta.sender === currentUser) {
        const duration = activeCallMeta.startTime ? Math.floor((Date.now() - activeCallMeta.startTime)/1000) : 0;
        const finalStatus = activeCallMeta.status === 'connected' ? 'completed' : 'missed';
        sendMessage(null, null, null, null, { callType: activeCallMeta.type, duration, status: finalStatus });
    }
    activeCallMeta = null;

    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (peerConnection) { peerConnection.close(); peerConnection = null; }
    if (currentUser) { set(ref(db, `calls/active/${currentUser}`), null); set(ref(db, `calls/active/${targetUser}`), null); }
}

/* --- Real-Time Love Particle Celebration Logic --- */
function initializeCelebrationListener() {
    document.getElementById("target-avatar").addEventListener("click", () => {
        const currentTime = Date.now();
        if (currentTime - lastAvatarClickTime < 3000) return;
        lastAvatarClickTime = currentTime;

        set(ref(db, 'chat_meta/celebration'), {
            triggeredBy: currentUser,
            token: currentTime + "_" + Math.random().toString(36).substr(2, 5)
        });
    });

    onValue(ref(db, 'chat_meta/celebration'), (snap) => {
        const data = snap.val();
        if (data && data.token && data.token !== lastExecutedCelebrationToken) {
            lastExecutedCelebrationToken = data.token;
            triggerFullscreenLoveAnimation();
        }
    });

    window.addEventListener('resize', () => {
        const canvas = document.getElementById("celebration-canvas");
        if(canvas && celebrationAnimationId) {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
    });
}

function triggerFullscreenLoveAnimation() {
    const canvas = document.getElementById("celebration-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    celebrationStreamEnd = Date.now() + 2000; 
    const assetTypes = ['❤️', '💕', '💖', '✨', 'love_bubble', 'sparkle_glowing'];
    
    for (let i = 0; i < 60; i++) {
        celebrationParticles.push(generateCelebrationParticle(canvas.width, canvas.height, assetTypes));
    }
    
    if (!celebrationAnimationId) {
        const processFrames = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            if (Date.now() < celebrationStreamEnd) {
                for (let i = 0; i < 2; i++) {
                    celebrationParticles.push(generateCelebrationParticle(canvas.width, canvas.height, assetTypes));
                }
            }
            
            for (let i = celebrationParticles.length - 1; i >= 0; i--) {
                const p = celebrationParticles[i];
                p.x += p.vx;
                p.y += p.vy;
                p.rotation += p.vRotation;
                p.scale += p.vScale;
                
                if (p.y < p.fadeThreshold) {
                    p.alpha -= 0.022; 
                }
                
                if (p.y < -60 || p.alpha <= 0) {
                    celebrationParticles.splice(i, 1);
                    continue;
                }
                
                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rotation);
                
                if (p.isEmojiString) {
                    ctx.font = `${p.baseSize * p.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(p.type, 0, 0);
                } else if (p.type === 'love_bubble') {
                    ctx.beginPath();
                    ctx.arc(0, 0, p.baseSize * p.scale, 0, Math.PI * 2);
                    ctx.fillStyle = p.shade;
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
                    ctx.lineWidth = 1.5;
                    ctx.fill();
                    ctx.stroke();
                } else if (p.type === 'sparkle_glowing') {
                    ctx.fillStyle = p.shade;
                    ctx.beginPath();
                    const outerRadius = p.baseSize * p.scale;
                    for (let j = 0; j < 4; j++) {
                        ctx.rotate(Math.PI / 2);
                        ctx.lineTo(0, outerRadius);
                        ctx.lineTo(outerRadius * 0.25, 0);
                    }
                    ctx.fill();
                }
                ctx.restore();
            }
            
            if (celebrationParticles.length > 0 || Date.now() < celebrationStreamEnd) {
                celebrationAnimationId = requestAnimationFrame(processFrames);
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                celebrationAnimationId = null;
            }
        };
        celebrationAnimationId = requestAnimationFrame(processFrames);
    }
}

function generateCelebrationParticle(w, h, assetTypes) {
    const chosenType = assetTypes[Math.floor(Math.random() * assetTypes.length)];
    const checkEmoji = ['❤️', '💕', '💖', '✨'].includes(chosenType);
    const pigmentPicks = ['rgba(255,105,180,0.65)', 'rgba(255,182,193,0.7)', 'rgba(240,128,128,0.6)', 'rgba(255,215,0,0.7)', 'rgba(221,160,221,0.55)'];
    
    return {
        x: Math.random() * w, 
        y: h + Math.random() * 50 + 15, 
        vx: (Math.random() - 0.5) * 3.5, 
        vy: -(Math.random() * 5.0 + 8.5), 
        baseSize: checkEmoji ? (Math.random() * 14 + 20) : (Math.random() * 8 + 7),
        scale: 1,
        vScale: (Math.random() - 0.5) * 0.004,
        rotation: Math.random() * Math.PI * 2,
        vRotation: (Math.random() - 0.5) * 0.04,
        alpha: 1.0,
        fadeThreshold: Math.random() * (h * 0.4) + (h * 0.1), 
        type: chosenType,
        isEmojiString: checkEmoji,
        shade: pigmentPicks[Math.floor(Math.random() * pigmentPicks.length)]
    };
}
