// ── Real Chat Module — replaces demo chat with Socket.io + REST API ──
(function() {
'use strict';

const CHAT_API = window.location.origin + '/api/chat';
let socket = null;
let currentRoomId = null;
let rooms = [];
let messages = {};
let onlineUsers = new Set();
let typingTimers = {};

// ── Connect Socket.io ─────────────────────────────────────────────
function connectSocket() {
  if (socket?.connected) return;
  const token = state.accessToken;
  if (!token) return;

  socket = io(window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('[Chat] Socket connected');
    loadRooms();
  });

  socket.on('message:new', (msg) => {
    if (!messages[msg.room_id]) messages[msg.room_id] = [];
    messages[msg.room_id].push(msg);
    if (msg.room_id === currentRoomId) {
      appendMessage(msg);
      socket.emit('message:read', { room_id: currentRoomId });
    }
    updateRoomBadge(msg.room_id);
    renderRealChatList();
  });

  socket.on('user:online', ({ userId, online }) => {
    if (online) onlineUsers.add(userId);
    else onlineUsers.delete(userId);
    renderRealChatList();
  });

  socket.on('typing:start', ({ room_id, name }) => {
    if (room_id !== currentRoomId) return;
    const el = document.getElementById('chatTypingIndicator');
    if (el) { el.textContent = `${name} is typing...`; el.style.display = 'block'; }
  });

  socket.on('typing:stop', ({ room_id }) => {
    if (room_id !== currentRoomId) return;
    const el = document.getElementById('chatTypingIndicator');
    if (el) el.style.display = 'none';
  });

  socket.on('call:incoming', ({ room_id, daily_room_url, caller_name }) => {
    if (confirm(`📹 Incoming video call from ${caller_name}. Join?`)) {
      openVideoRoom(daily_room_url);
    }
  });

  socket.on('disconnect', () => console.log('[Chat] Socket disconnected'));
}

// ── Load rooms ────────────────────────────────────────────────────
async function loadRooms() {
  try {
    const r = await apiFetch('/chat/rooms');
    if (!r?.ok) return;
    rooms = await r.json();
    renderRealChatList();
  } catch(e) { console.error('[Chat] loadRooms', e); }
}

// ── Load messages for a room ──────────────────────────────────────
async function loadMessages(roomId) {
  try {
    const r = await apiFetch(`/chat/rooms/${roomId}/messages?limit=50`);
    if (!r?.ok) return;
    messages[roomId] = await r.json();
    renderMessages(roomId);
    socket?.emit('message:read', { room_id: roomId });
  } catch(e) { console.error('[Chat] loadMessages', e); }
}

// ── Render chat list ──────────────────────────────────────────────
function renderRealChatList() {
  const container = document.getElementById('chatContactList');
  if (!container) return;

  if (!rooms.length) {
    container.innerHTML = `<div style="padding:1rem;color:var(--text-3);text-align:center">
      No conversations yet.<br><button onclick="openNewChatModal()" style="margin-top:.5rem;padding:.4rem .8rem;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer">+ New Chat</button>
    </div>`;
    return;
  }

  container.innerHTML = rooms.map(room => {
    const unread = room.unread_count > 0 ? `<span style="background:var(--accent);color:#fff;border-radius:10px;padding:2px 6px;font-size:.7rem">${room.unread_count}</span>` : '';
    const lastMsg = room.last_message ? room.last_message.substring(0, 35) + (room.last_message.length > 35 ? '...' : '') : 'No messages';
    const time = room.last_message_at ? formatChatTime(room.last_message_at) : '';
    const isGroup = room.type === 'group';
    const icon = isGroup ? '👥' : '💬';
    return `<div class="chat-contact-item ${room.id === currentRoomId ? 'active' : ''}" 
              onclick="openRealChatThread('${room.id}','${(room.name||'Chat').replace(/'/g,"\\'")}')">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="font-size:1.2rem">${icon}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:.85rem">${room.name || 'Direct Chat'}</strong>
            <span style="font-size:.7rem;color:var(--text-3)">${time}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.75rem;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${lastMsg}</span>
            ${unread}
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Open chat thread ──────────────────────────────────────────────
window.openRealChatThread = function(roomId, roomName) {
  currentRoomId = roomId;

  const header = document.querySelector('.chat-header-title');
  if (header) header.textContent = roomName;

  const msgContainer = document.getElementById('chatMessages');
  if (msgContainer) msgContainer.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--text-3)">Loading...</div>';

  document.getElementById('chatThread')?.classList.add('open');
  document.getElementById('chatContactList')?.classList.add('thread-open');

  loadMessages(roomId);
  renderRealChatList();
};

// ── Render messages ───────────────────────────────────────────────
function renderMessages(roomId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const msgs = messages[roomId] || [];

  if (!msgs.length) {
    container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-3)">No messages yet. Say hello! 👋</div>';
    return;
  }

  container.innerHTML = msgs.map(msg => renderMessageBubble(msg)).join('');
  container.scrollTop = container.scrollHeight;
}

function appendMessage(msg) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const empty = container.querySelector('[style*="No messages"]');
  if (empty) container.innerHTML = '';
  container.insertAdjacentHTML('beforeend', renderMessageBubble(msg));
  container.scrollTop = container.scrollHeight;
}

function renderMessageBubble(msg) {
  const isMine = msg.sender_id === state.user?.id;
  const time = formatChatTime(msg.created_at);
  const name = msg.sender_name || 'Unknown';

  let content = '';
  if (msg.type === 'file' || msg.type === 'image') {
    const isImage = msg.type === 'image' || /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.file_name || '');
    if (isImage) {
      content = `<img src="${msg.file_url}" style="max-width:200px;border-radius:8px;cursor:pointer" onclick="window.open('${msg.file_url}')">`;
    } else {
      content = `<a href="${msg.file_url}" target="_blank" style="color:var(--accent);text-decoration:none">📎 ${msg.file_name} (${formatFileSize(msg.file_size)})</a>`;
    }
  } else {
    content = `<span>${escapeHtml(msg.content || '')}</span>`;
  }

  return `<div class="chat-msg ${isMine ? 'mine' : 'theirs'}" style="margin:.4rem .8rem;display:flex;flex-direction:column;align-items:${isMine?'flex-end':'flex-start'}">
    ${!isMine ? `<span style="font-size:.7rem;color:var(--text-3);margin-bottom:2px">${name}</span>` : ''}
    <div style="max-width:70%;padding:.5rem .8rem;border-radius:${isMine?'12px 12px 2px 12px':'12px 12px 12px 2px'};background:${isMine?'var(--accent)':'var(--bg-2)'};color:${isMine?'#fff':'var(--text-1)'};word-break:break-word">
      ${content}
    </div>
    <span style="font-size:.65rem;color:var(--text-3);margin-top:2px">${time}</span>
  </div>`;
}

// ── Send message ──────────────────────────────────────────────────
window.sendRealChatMessage = function() {
  if (!currentRoomId || !socket?.connected) return;
  const input = document.getElementById('chatInput');
  const content = input?.value?.trim();
  if (!content) return;
  input.value = '';
  socket.emit('message:send', { room_id: currentRoomId, content, type: 'text' }, (ack) => {
    if (ack?.error) console.error('[Chat] Send error:', ack.error);
  });
  socket.emit('typing:stop', { room_id: currentRoomId });
};

// ── Typing indicator ──────────────────────────────────────────────
window.handleRealChatKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendRealChatMessage(); return; }
  if (!currentRoomId || !socket?.connected) return;
  socket.emit('typing:start', { room_id: currentRoomId });
  clearTimeout(typingTimers[currentRoomId]);
  typingTimers[currentRoomId] = setTimeout(() => {
    socket.emit('typing:stop', { room_id: currentRoomId });
  }, 2000);
};

// ── File upload ───────────────────────────────────────────────────
window.handleRealChatFile = async function(event) {
  const file = event.target.files[0];
  if (!file || !currentRoomId) return;
  if (file.size > 50 * 1024 * 1024) { alert('File too large. Max 50MB.'); return; }

  try {
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (state.accessToken) headers['Authorization'] = `Bearer ${state.accessToken}`;

    const r = await fetch('/api/chat/upload', { method: 'POST', headers, body: formData });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message);

    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
    socket.emit('message:send', {
      room_id: currentRoomId,
      type: isImage ? 'image' : 'file',
      content: file.name,
      file_url: data.url,
      file_name: data.name,
      file_size: data.size
    });
  } catch(e) { alert('Upload failed: ' + e.message); }
};

// ── New chat modal ────────────────────────────────────────────────
window.openNewChatModal = async function() {
  // Get users
  const r = await apiFetch('/users');
  const users = r?.ok ? await r.json() : [];
  const contacts = state.contacts || [];

  const modal = document.createElement('dialog');
  modal.style.cssText = 'padding:1.5rem;border-radius:12px;border:1px solid var(--border);background:var(--bg-1);color:var(--text-1);min-width:320px;max-width:480px';
  modal.innerHTML = `
    <h3 style="margin:0 0 1rem">New Conversation</h3>
    <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Name (for group chats)</label>
    <input id="newChatName" placeholder="e.g. Project Team" style="width:100%;padding:.5rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-2);color:var(--text-1);margin-bottom:1rem;box-sizing:border-box">
    <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Type</label>
    <select id="newChatType" style="width:100%;padding:.5rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-2);color:var(--text-1);margin-bottom:1rem;box-sizing:border-box">
      <option value="direct">Direct Message</option>
      <option value="group">Group Chat</option>
    </select>
    <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Add Team Members</label>
    <div style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:.5rem;margin-bottom:1rem">
      ${users.filter(u => u.id !== state.user?.id).map(u => `
        <label style="display:flex;align-items:center;gap:.5rem;padding:.3rem;cursor:pointer">
          <input type="checkbox" value="${u.id}" class="new-chat-user">
          <span>${u.name} (${u.email})</span>
        </label>`).join('') || '<span style="color:var(--text-3);font-size:.85rem">No other users</span>'}
    </div>
    <label style="display:block;margin-bottom:.5rem;font-size:.85rem">Add Contacts (optional)</label>
    <div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:.5rem;margin-bottom:1rem">
      ${contacts.slice(0,20).map(c => `
        <label style="display:flex;align-items:center;gap:.5rem;padding:.3rem;cursor:pointer">
          <input type="checkbox" value="${c.id}" class="new-chat-contact">
          <span>${c.name}</span>
        </label>`).join('') || '<span style="color:var(--text-3);font-size:.85rem">No contacts</span>'}
    </div>
    <div style="display:flex;gap:.5rem;justify-content:flex-end">
      <button onclick="this.closest('dialog').close()" style="padding:.5rem 1rem;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-1);cursor:pointer">Cancel</button>
      <button id="createChatBtn" style="padding:.5rem 1rem;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer">Create</button>
    </div>`;

  document.body.appendChild(modal);
  modal.showModal();

  modal.querySelector('#createChatBtn').onclick = async () => {
    const name = modal.querySelector('#newChatName').value.trim();
    const type = modal.querySelector('#newChatType').value;
    const member_ids = [...modal.querySelectorAll('.new-chat-user:checked')].map(el => el.value);
    const contact_ids = [...modal.querySelectorAll('.new-chat-contact:checked')].map(el => el.value);

    if (!member_ids.length && !contact_ids.length) { alert('Add at least one member.'); return; }

    const r = await apiFetch('/chat/rooms', { method: 'POST', body: JSON.stringify({ name: name || (type === 'direct' ? 'Direct Chat' : 'Group Chat'), type, member_ids, contact_ids }) });
    if (r?.ok) {
      const room = await r.json();
      modal.close();
      await loadRooms();
      openRealChatThread(room.id, room.name);
    }
  };
  modal.addEventListener('close', () => modal.remove());
};

// ── Video call ────────────────────────────────────────────────────
window.startRealVideoCall = async function() {
  if (!currentRoomId) return;
  try {
    const r = await apiFetch('/video/rooms', { method: 'POST', body: JSON.stringify({ name: `crm-${currentRoomId.slice(0,8)}` }) });
    const room = await r?.json();
    if (!room?.url) { alert('Video not configured yet. Add DAILY_API_KEY to .env to enable video calls.'); return; }
    socket?.emit('call:start', { room_id: currentRoomId, daily_room_url: room.url });
    openVideoRoom(room.url);
  } catch(e) { alert('Video call failed: ' + e.message); }
};

function openVideoRoom(url) {
  const win = window.open(url, '_blank', 'width=900,height=600');
  if (!win) alert('Please allow popups for video calls.');
}

// ── Update room badge ─────────────────────────────────────────────
function updateRoomBadge(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (room && roomId !== currentRoomId) {
    room.unread_count = (parseInt(room.unread_count) || 0) + 1;
  }
  updateChatBadge();
}

// ── Helpers ───────────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

// ── Override initChat to use real backend ─────────────────────────
const _origInitChat = window.initChat;
window.initChat = function() {
  connectSocket();
  // Add typing indicator div to chat
  const inputArea = document.querySelector('.chat-compose');
  if (inputArea && !document.getElementById('chatTypingIndicator')) {
    const ti = document.createElement('div');
    ti.id = 'chatTypingIndicator';
    ti.style.cssText = 'font-size:.75rem;color:var(--text-3);padding:0 .8rem .3rem;display:none';
    inputArea.insertAdjacentElement('beforebegin', ti);
  }
  // Override send button
  const sendBtn = document.querySelector('.chat-send-btn,[onclick*="sendChatMessage"]');
  if (sendBtn) sendBtn.setAttribute('onclick', 'sendRealChatMessage()');
  // Override input keydown
  const input = document.getElementById('chatInput');
  if (input) input.setAttribute('onkeydown', 'handleRealChatKeydown(event)');
  // Override file input
  const fileInput = document.getElementById('chatFileInput');
  if (fileInput) fileInput.setAttribute('onchange', 'handleRealChatFile(event)');
  // Override video call button
  const videoBtn = document.getElementById('chatVideoBtn');
  if (videoBtn) videoBtn.setAttribute('onclick', 'startRealVideoCall()');
  // Add new chat button to header
  const chatHeader = document.querySelector('.chat-header-actions,.chat-icons');
  if (chatHeader && !document.getElementById('newChatBtn')) {
    const btn = document.createElement('button');
    btn.id = 'newChatBtn';
    btn.className = 'chat-icon-btn';
    btn.title = 'New Conversation';
    btn.textContent = '✏️';
    btn.onclick = openNewChatModal;
    chatHeader.insertBefore(btn, chatHeader.firstChild);
  }
};

// ── Auto-init when state is ready ────────────────────────────────
const _origRenderSession = window.renderSession;
window.renderSession = function() {
  _origRenderSession?.apply(this, arguments);
  if (state.accessToken && !socket?.connected) {
    setTimeout(connectSocket, 500);
  }
};

console.log('[Chat] Real chat module loaded');
})();
