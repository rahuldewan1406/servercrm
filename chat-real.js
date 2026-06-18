// ── Real Chat Module (final) ──────────────────────────────────────
let _socket = null;
let _roomId = null;
let _rooms = [];
let _msgs = {};
let _connected = false;

function chatConnect() {
  if (_connected || _socket?.connected) return;
  const token = state?.accessToken;
  if (!token) return;
  _connected = true;
  _socket = io(window.location.origin, { auth: { token }, transports: ['polling'], forceNew: false });
  _socket.on('connect', () => { console.log('[Chat] connected:', _socket.id); chatLoadRooms(); });
  _socket.on('connect_error', () => { _connected = false; });
  _socket.on('disconnect', () => { _connected = false; });
  _socket.on('message:new', (msg) => {
    if (!_msgs[msg.room_id]) _msgs[msg.room_id] = [];
    if (_msgs[msg.room_id].find(m => m.id === msg.id)) return; // dedupe
    _msgs[msg.room_id].push(msg);
    if (msg.room_id === _roomId) { chatAppend(msg); _socket.emit('message:read', { room_id: _roomId }); }
    const r = _rooms.find(r => r.id === msg.room_id);
    if (r) { r.last_message = msg.content; r.last_message_at = msg.created_at; }
    chatRenderList();
  });
  _socket.on('typing:start', ({ room_id, name }) => {
    if (room_id !== _roomId) return;
    const el = document.getElementById('chatTypingIndicator');
    if (el) { el.textContent = name + ' is typing...'; el.style.display = 'block'; }
  });
  _socket.on('typing:stop', ({ room_id }) => {
    if (room_id !== _roomId) return;
    const el = document.getElementById('chatTypingIndicator');
    if (el) el.style.display = 'none';
  });
  _socket.on('call:incoming', ({ daily_room_url, caller_name }) => {
    if (confirm('📹 Call from ' + caller_name + '. Join?')) window.open(daily_room_url, '_blank');
  });
}

async function chatLoadRooms() {
  const r = await apiFetch('/chat/rooms');
  if (!r?.ok) return;
  const data = await r.json();
  const seen = new Set();
  _rooms = data.filter(r => seen.has(r.id) ? false : seen.add(r.id));
  chatRenderList();
}

function chatRenderList() {
  const c = document.getElementById('chatContactList');
  if (!c) return;
  if (!_rooms.length) {
    c.innerHTML = '<div style="padding:1rem;text-align:center;color:var(--text-3);font-size:.85rem">No chats.<br><button onclick="openNewChatModal()" style="margin-top:.5rem;padding:.3rem .7rem;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer">+ New</button></div>';
    return;
  }
  c.innerHTML = _rooms.map(room => {
    const last = (room.last_message || 'No messages').substring(0, 40);
    const time = room.last_message_at ? formatChatTime(room.last_message_at) : '';
    const icon = room.type === 'group' ? '👥' : '💬';
    const bg = room.id === _roomId ? 'background:var(--bg-2);' : '';
    return '<div style="' + bg + 'cursor:pointer;padding:.5rem .75rem;border-bottom:1px solid var(--border)" onclick="chatOpenRoom(\'' + room.id + '\',\'' + (room.name||'Chat').replace(/'/g,"\\'") + '\')">'
      + '<div style="display:flex;gap:.5rem;align-items:center">'
      + '<span>' + icon + '</span>'
      + '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between"><strong style="font-size:.82rem">' + (room.name||'Chat') + '</strong><span style="font-size:.68rem;color:var(--text-3)">' + time + '</span></div>'
      + '<div style="font-size:.75rem;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + last + '</div></div></div></div>';
  }).join('');
}

window.chatOpenRoom = window.openRealChatThread = function(roomId, roomName) {
  _roomId = roomId;
  const tw = document.getElementById('chatThreadWrap');
  const te = document.getElementById('chatThreadEmpty');
  if (tw) tw.classList.remove('hidden');
  if (te) te.classList.add('hidden');
  const ne = document.getElementById('chatThreadName');
  if (ne) ne.textContent = roomName;
  const pe = document.getElementById('chatThreadPhone');
  if (pe) pe.textContent = '';
  const me = document.getElementById('chatMessages');
  if (me) me.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-3)">Loading...</div>';
  chatLoadMsgs(roomId);
  chatRenderList();
  chatFixSend();
};

async function chatLoadMsgs(roomId) {
  const r = await apiFetch('/chat/rooms/' + roomId + '/messages?limit=50');
  if (!r?.ok) return;
  _msgs[roomId] = await r.json();
  chatRenderMsgs(roomId);
  _socket?.emit('message:read', { room_id: roomId });
}

function chatRenderMsgs(roomId) {
  const c = document.getElementById('chatMessages');
  if (!c) return;
  const msgs = _msgs[roomId] || [];
  if (!msgs.length) { c.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-3)">No messages yet 👋</div>'; return; }
  c.innerHTML = msgs.map(chatBubble).join('');
  c.scrollTop = c.scrollHeight;
}

function chatAppend(msg) {
  const c = document.getElementById('chatMessages');
  if (!c) return;
  c.insertAdjacentHTML('beforeend', chatBubble(msg));
  c.scrollTop = c.scrollHeight;
}

function chatBubble(msg) {
  const mine = msg.sender_id === state?.user?.id;
  const time = formatChatTime(msg.created_at);
  let body = '';
  if (msg.type === 'file' || msg.type === 'image') {
    const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(msg.file_name || '');
    body = isImg ? '<img src="' + msg.file_url + '" style="max-width:200px;border-radius:8px">'
      : '<a href="' + msg.file_url + '" target="_blank" style="color:' + (mine?'#fff':'var(--accent)') + '">📎 ' + (msg.file_name||'file') + '</a>';
  } else {
    body = (msg.content||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  return '<div style="margin:.35rem .75rem;display:flex;flex-direction:column;align-items:' + (mine?'flex-end':'flex-start') + '">'
    + (!mine ? '<span style="font-size:.68rem;color:var(--text-3);margin-bottom:2px">' + (msg.sender_name||'User') + '</span>' : '')
    + '<div style="max-width:72%;padding:.45rem .75rem;border-radius:' + (mine?'12px 12px 2px 12px':'12px 12px 12px 2px') + ';background:' + (mine?'var(--accent)':'var(--bg-2)') + ';color:' + (mine?'#fff':'var(--text-1)') + ';word-break:break-word;font-size:.88rem">' + body + '</div>'
    + '<span style="font-size:.65rem;color:var(--text-3);margin-top:2px">' + time + '</span></div>';
}

window.sendChatMessage = window.sendRealChatMessage = window.handleChatKeydown = function(e) {
  if (e && e.key !== undefined) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
  }
  if (!_roomId || !_socket?.connected) return;
  const input = document.getElementById('chatInput');
  const content = (input?.value || '').trim();
  if (!content) return;
  input.value = '';
  _socket.emit('message:send', { room_id: _roomId, content, type: 'text' });
};

window.handleRealChatFile = async function(event) {
  const file = event.target.files[0];
  if (!file || !_roomId) return;
  if (file.size > 50*1024*1024) { alert('Max 50MB'); return; }
  const fd = new FormData(); fd.append('file', file);
  const headers = state.accessToken ? { 'Authorization': 'Bearer ' + state.accessToken } : {};
  const r = await fetch('/api/chat/upload', { method:'POST', headers, body:fd });
  const d = await r.json();
  if (!r.ok) { alert('Upload failed'); return; }
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.name);
  _socket.emit('message:send', { room_id: _roomId, type: isImg?'image':'file', content: file.name, file_url: d.url, file_name: d.name, file_size: d.size });
};

window.openNewChatModal = async function() {
  const r = await apiFetch('/users');
  const users = r?.ok ? await r.json() : [];
  const contacts = state.contacts || [];
  const modal = document.createElement('dialog');
  modal.style.cssText = 'padding:1.5rem;border-radius:12px;border:1px solid var(--border);background:var(--bg-1);color:var(--text-1);min-width:300px;max-width:440px;width:90%';
  modal.innerHTML = '<h3 style="margin:0 0 1rem">New Conversation</h3>'
    + '<input id="ncName" placeholder="Name" style="width:100%;padding:.4rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-2);color:var(--text-1);margin-bottom:.75rem;box-sizing:border-box">'
    + '<select id="ncType" style="width:100%;padding:.4rem;border-radius:6px;border:1px solid var(--border);background:var(--bg-2);color:var(--text-1);margin-bottom:.75rem;box-sizing:border-box"><option value="direct">Direct</option><option value="group">Group</option></select>'
    + '<div style="font-size:.82rem;margin-bottom:.25rem">Team Members</div><div style="max-height:120px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:.3rem;margin-bottom:.75rem">'
    + (users.filter(u=>u.id!==state.user?.id).map(u=>'<label style="display:flex;gap:.4rem;align-items:center;padding:.2rem;font-size:.82rem;cursor:pointer"><input type="checkbox" value="'+u.id+'" class="ncu"> '+u.name+'</label>').join('')||'<span style="color:var(--text-3);font-size:.82rem">No other users</span>')
    + '</div><div style="font-size:.82rem;margin-bottom:.25rem">Contacts</div><div style="max-height:90px;overflow-y:auto;border:1px solid var(--border);border-radius:6px;padding:.3rem;margin-bottom:.75rem">'
    + (contacts.slice(0,20).map(c=>'<label style="display:flex;gap:.4rem;align-items:center;padding:.2rem;font-size:.82rem;cursor:pointer"><input type="checkbox" value="'+c.id+'" class="ncc"> '+c.name+'</label>').join('')||'<span style="color:var(--text-3);font-size:.82rem">No contacts</span>')
    + '</div><div style="display:flex;gap:.5rem;justify-content:flex-end"><button onclick="this.closest(\'dialog\').close()" style="padding:.4rem .8rem;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text-1);cursor:pointer">Cancel</button><button id="ncCreate" style="padding:.4rem .8rem;border-radius:6px;background:var(--accent);color:#fff;border:none;cursor:pointer">Create</button></div>';
  document.body.appendChild(modal);
  modal.showModal();
  modal.querySelector('#ncCreate').onclick = async () => {
    const name = modal.querySelector('#ncName').value.trim();
    const type = modal.querySelector('#ncType').value;
    const member_ids = [...modal.querySelectorAll('.ncu:checked')].map(e=>e.value);
    const contact_ids = [...modal.querySelectorAll('.ncc:checked')].map(e=>e.value);
    if (!member_ids.length && !contact_ids.length) { alert('Add at least one member.'); return; }
    const cr = await apiFetch('/chat/rooms', { method:'POST', body:JSON.stringify({ name:name||(type==='direct'?'Direct':'Group'), type, member_ids, contact_ids }) });
    if (cr?.ok) { const room = await cr.json(); modal.close(); await chatLoadRooms(); chatOpenRoom(room.id, room.name); }
  };
  modal.addEventListener('close', () => modal.remove());
};

window.startRealVideoCall = async function() {
  if (!_roomId) return;
  const r = await apiFetch('/video/rooms', { method:'POST', body:JSON.stringify({ name:'crm-'+_roomId.slice(0,8) }) });
  const room = await r?.json();
  if (!room?.url) { alert('Video call failed.'); return; }
  _socket?.emit('call:start', { room_id: _roomId, daily_room_url: room.url });
  window.open(room.url, '_blank', 'width=900,height=600');
};

function chatFixSend() {
  const btn = document.getElementById('chatSendBtn');
  if (btn) { btn.removeAttribute('onclick'); btn.onclick = window.sendChatMessage; }
  const input = document.getElementById('chatInput');
  if (input) { input.removeAttribute('onkeydown'); input.onkeydown = window.handleChatKeydown; }
  const fi = document.getElementById('chatFileInput');
  if (fi) { fi.removeAttribute('onchange'); fi.onchange = window.handleRealChatFile; }
  const vb = document.getElementById('chatVideoBtn');
  if (vb) { vb.removeAttribute('onclick'); vb.onclick = window.startRealVideoCall; }
}

// Layout fix
const _chatStyle = document.createElement('style');
_chatStyle.textContent = '#chatThreadWrap{display:flex!important;flex-direction:column!important;overflow:hidden!important}#chatMessages{flex:1!important;overflow-y:auto!important;min-height:0!important}.chat-compose-bar{flex-shrink:0!important}';
document.head.appendChild(_chatStyle);

// Override toggleChat
const _origToggle = window.toggleChat;
window.toggleChat = function() {
  _origToggle?.apply(this, arguments);
  chatConnect();
  setTimeout(() => { chatLoadRooms(); chatFixSend(); }, 300);
};

// Override initChat
window.initChat = function() { chatConnect(); setTimeout(chatFixSend, 500); };

// Single init
setTimeout(() => { if (state?.accessToken) { chatConnect(); chatFixSend(); } }, 2000);
console.log('[Chat] loaded v3');

// ── Fix emoji picker closing before insert ────────────────────────
window.insertEmoji = function(emoji) {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const pos = input.selectionStart || 0;
  input.value = input.value.slice(0, pos) + emoji + input.value.slice(input.selectionEnd || pos);
  input.selectionStart = input.selectionEnd = pos + emoji.length;
  input.focus();
  document.getElementById('emojiPicker')?.classList.add('hidden');
};

// ── Fix emoji picker visibility ───────────────────────────────────
const _emojiStyle = document.createElement('style');
_emojiStyle.textContent = `
  #emojiPicker {
    position: fixed !important;
    bottom: 120px !important;
    left: auto !important;
    right: 20px !important;
    z-index: 99999 !important;
    max-height: 300px !important;
    overflow-y: auto !important;
  }
`;
document.head.appendChild(_emojiStyle);

// Override renderChatList to show socket.io rooms instead of SMS contacts
const _origRenderChatList = window.renderChatList;
window.renderChatList = function() {
  if (_rooms && _rooms.length > 0) {
    chatRenderList();
  } else {
    if (_origRenderChatList) _origRenderChatList();
  }
};
