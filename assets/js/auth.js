const KEY_USERS = 'flowlock_users';
const KEY_SESSION = 'flowlock_session';
const AVATAR_BUCKET = 'flowlock-avatars';
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
const AVATAR_FILE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function resolvePagePath(page) {
  const base = document.body?.dataset.base || '.';
  return `${base.replace(/\/$/, '')}/${page}`.replace(/\/\/+/, '/');
}

function readStorage(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (error) {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

function getUsers() {
  return readStorage(KEY_USERS) || {};
}

function saveUsers(users) {
  writeStorage(KEY_USERS, users);
}

function getSession() {
  return readStorage(KEY_SESSION) || null;
}

function setSession(name) {
  if (name) {
    writeStorage(KEY_SESSION, name);
  } else {
    localStorage.removeItem(KEY_SESSION);
  }
}

function getCurrentUserRecord() {
  const currentName = getSession();
  const users = getUsers();

  if (!currentName) return null;

  return Object.values(users).find((user) => String(user.name).toLowerCase() === String(currentName).toLowerCase()) || null;
}

function generateUid() {
  const randomPart = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
  return `FLOW-${randomPart}`;
}

function generateUniqueUid(users = getUsers()) {
  let uid = '';
  do {
    uid = generateUid();
  } while (Object.values(users).some((user) => String(user.uid || '').toUpperCase() === uid.toUpperCase()));
  return uid;
}

function getUserByUsername(username) {
  const key = String(username || '').trim().toLowerCase();
  if (!key) return null;
  const users = getUsers();
  return users[key] || null;
}

async function getFriendsForCurrentUser() {
  return loadFlowlockFriends();
}

async function addFriendByValue(value) {
  if (!String(value || '').trim()) {
    return { success: false, message: 'กรุณากรอกชื่อผู้ใช้หรือ UID' };
  }
  const result = await sendFlowlockFriendRequest(value);
  const messages = {
    sent: 'ส่งคำขอเพื่อนแล้ว รออีกฝ่ายตอบรับ',
    already_sent: 'ส่งคำขอเพื่อนนี้ไปแล้ว กำลังรอการตอบรับ',
    already_friend: 'ผู้ใช้นี้เป็นเพื่อนอยู่แล้ว',
    incoming_pending: 'ผู้ใช้นี้ส่งคำขอถึงคุณแล้ว ไปที่หน้าเพื่อนเพื่อกดรับ',
    not_found: 'ไม่พบบัญชีนี้ ตรวจสอบชื่อผู้ใช้หรือ UID',
    self: 'ไม่สามารถเพิ่มตัวเองเป็นเพื่อนได้'
  };
  return { success: result === 'sent', message: messages[result] || 'ส่งคำขอเพื่อนไม่สำเร็จ' };
}

async function acceptFriendRequest(requestId) {
  return respondToFlowlockFriendRequest(requestId, true);
}

async function deleteFriend(friendId) {
  return removeFlowlockFriend(friendId);
}

async function renderPendingRequests(container) {
  if (!container) return;

  try {
    const requests = await loadFlowlockFriendRequests();
    if (!requests.length) {
      container.innerHTML = '<div class="empty-friend">ยังไม่มีคำขอเพื่อน</div>';
      return;
    }

    container.innerHTML = requests.map((request) => `
      <div class="friend-card">
        <strong>${escapeHtml(request.name)}</strong>
        <small>${escapeHtml(request.uid || 'UID ไม่ระบุ')} · ${request.direction === 'incoming' ? 'ส่งคำขอถึงคุณ' : 'รอการตอบรับ'}</small>
        <div class="stack">
          ${request.direction === 'incoming'
            ? `<button class="mini-btn accept-request" type="button" data-request-id="${escapeHtml(request.id)}">รับเพื่อน</button>`
            : ''}
          <button class="mini-btn delete-request" type="button" data-request-id="${escapeHtml(request.id)}">${request.direction === 'incoming' ? 'ปฏิเสธ' : 'ยกเลิกคำขอ'}</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.accept-request').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await acceptFriendRequest(button.dataset.requestId);
          await renderPendingRequests(container);
          await renderFriendList(document.getElementById('friendsList'));
        } catch (error) {
          showMessage(container, error.message || 'รับคำขอเพื่อนไม่สำเร็จ');
          button.disabled = false;
        }
      });
    });

    container.querySelectorAll('.delete-request').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await respondToFlowlockFriendRequest(button.dataset.requestId, false);
          await renderPendingRequests(container);
        } catch (error) {
          showMessage(container, error.message || 'จัดการคำขอเพื่อนไม่สำเร็จ');
          button.disabled = false;
        }
      });
    });
  } catch (error) {
    container.innerHTML = `<div class="msg">${escapeHtml(error.message || 'โหลดคำขอเพื่อนไม่สำเร็จ')}</div>`;
  }
}

function openFriendProfile(friend) {
  const modal = document.getElementById('friendModal');
  const nameEl = document.getElementById('friendProfileName');
  const uidEl = document.getElementById('friendProfileUid');
  const copyBtn = document.getElementById('copyFriendUidBtn');

  if (!modal || !nameEl || !uidEl || !copyBtn) return;

  nameEl.textContent = friend.name;
  uidEl.textContent = friend.uid || '-';
  copyBtn.dataset.uid = friend.uid || '-';
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeFriendProfile() {
  const modal = document.getElementById('friendModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

async function renderFriendList(container) {
  if (!container) return;

  let list;
  try {
    list = await getFriendsForCurrentUser();
  } catch (error) {
    container.innerHTML = `<div class="msg">${escapeHtml(error.message || 'โหลดรายชื่อเพื่อนไม่สำเร็จ')}</div>`;
    return;
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-friend">ยังไม่มีเพื่อนในรายชื่อ</div>';
    return;
  }

  container.innerHTML = list.map((friend) => `
    <div class="friend-card">
      <strong>${escapeHtml(friend.name)}</strong>
      <small>${escapeHtml(friend.uid)}</small>
      <div class="stack">
        <button class="mini-copy" type="button" data-copy="${escapeHtml(friend.uid)}">คัดลอก</button>
        <button class="mini-btn view-friend" type="button" data-friend-name="${escapeHtml(friend.name)}" data-friend-uid="${escapeHtml(friend.uid || '')}">ดูโปรไฟล์</button>
        <button class="mini-btn delete-friend" type="button" data-friend-id="${escapeHtml(friend.id)}">ลบเพื่อน</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.getAttribute('data-copy');
      try {
        await navigator.clipboard.writeText(uid);
        button.textContent = 'คัดลอกแล้ว';
        setTimeout(() => {
          button.textContent = 'คัดลอก';
        }, 1200);
      } catch (error) {
        button.textContent = 'ไม่สำเร็จ';
      }
    });
  });

  container.querySelectorAll('.view-friend').forEach((button) => {
    button.addEventListener('click', () => {
      const friendName = button.getAttribute('data-friend-name');
      const friendUid = button.getAttribute('data-friend-uid');
      openFriendProfile({ name: friendName, uid: friendUid });
    });
  });

  container.querySelectorAll('.delete-friend').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await deleteFriend(button.dataset.friendId);
        await renderFriendList(container);
        await renderPendingRequests(document.getElementById('pendingRequests'));
      } catch (error) {
        showMessage(container, error.message || 'ลบเพื่อนไม่สำเร็จ');
        button.disabled = false;
      }
    });
  });
}

async function hashValue(value) {
  try {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('flowlock:' + value));
    return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    return btoa(unescape(encodeURIComponent(value)));
  }
}

function redirectIfLoggedIn() {
  if (getSession()) {
    window.location.href = resolvePagePath('app.html');
  }
}

function requireAuth() {
  if (!getSession()) {
    window.location.href = resolvePagePath('login.html');
    return false;
  }
  return true;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function showMessage(element, message, isOk = false) {
  if (!element) return;
  element.textContent = message;
  element.className = 'msg' + (isOk ? ' ok' : '');
}

function bindPasswordToggle(inputId) {
  const input = document.getElementById(inputId);
  const toggle = document.getElementById(inputId + 'Toggle');

  if (!input || !toggle) return;

  toggle.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggle.textContent = isPassword ? 'ซ่อน' : 'แสดง';
  });
}

function setupLoginPage() {
  redirectIfLoggedIn();

  const form = document.getElementById('loginForm');
  const message = document.getElementById('loginMessage');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  if (!form || !usernameInput || !passwordInput) return;

  bindPasswordToggle('password');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showMessage(message, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    try {
      const client = getSupabaseClient();
      const email = await getSupabaseAuthEmail(username);
      let { data, error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        const legacyUser = getUserByUsername(username);
        const legacyPasswordMatches = legacyUser && legacyUser.h === await hashValue(password);
        if (!legacyPasswordMatches) {
          showMessage(message, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
          return;
        }

        const migration = await client.auth.signUp({
          email,
          password,
          options: { data: { username: legacyUser.name } }
        });

        if (!migration.error) {
          if (!migration.data.session) {
            showMessage(message, 'ย้ายบัญชีแล้ว แต่ต้องปิดการยืนยันอีเมลใน Supabase ก่อนจึงจะเข้าสู่ระบบได้');
            return;
          }
          data = migration.data;
        } else {
          const duplicateAccount = /already registered|already exists|duplicate key/i.test(migration.error.message);
          if (!duplicateAccount) throw migration.error;
          const retry = await client.auth.signInWithPassword({ email, password });
          if (retry.error) throw retry.error;
          data = retry.data;
        }
      }

      if (!data.user) {
        throw new Error('ระบบยืนยันตัวตนไม่ส่งข้อมูลบัญชีกลับมา');
      }
      const profile = await getSupabaseProfile(client, data.user.id);
      cacheSupabaseProfile(profile);
      window.location.href = resolvePagePath('app.html');
    } catch (error) {
      showMessage(message, error.message || 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่');
    }
  });
}

function setupRegisterPage() {
  redirectIfLoggedIn();

  const form = document.getElementById('registerForm');
  const message = document.getElementById('registerMessage');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');

  if (!form || !usernameInput || !passwordInput) return;

  bindPasswordToggle('password');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      showMessage(message, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      return;
    }

    if (username.length < 3) {
      showMessage(message, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร');
      return;
    }

    if (username.length > 32) {
      showMessage(message, 'ชื่อผู้ใช้ต้องไม่เกิน 32 ตัวอักษร');
      return;
    }

    if (password.length < 6) {
      showMessage(message, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }

    try {
      const client = getSupabaseClient();
      const { data, error } = await client.auth.signUp({
        email: await getSupabaseAuthEmail(username),
        password,
        options: { data: { username } }
      });

      if (error) {
        if (/already registered|already exists|duplicate key/i.test(error.message)) {
          showMessage(message, 'ชื่อผู้ใช้นี้ถูกใช้แล้ว ลองชื่ออื่น');
          return;
        }
        throw error;
      }

      if (!data.session || !data.user) {
        throw new Error('สมัครบัญชีแล้วแต่ยังไม่ได้เข้าสู่ระบบ กรุณาปิดการยืนยันอีเมลใน Supabase');
      }
      await getSupabaseProfile(client, data.user.id);
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw signOutError;

      showMessage(message, 'สมัครสำเร็จ กำลังพาไปหน้าเข้าสู่ระบบ…', true);
      setTimeout(() => {
        window.location.href = resolvePagePath('login.html');
      }, 900);
    } catch (error) {
      showMessage(message, error.message || 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่');
    }
  });
}

function attachLogoutButton(button, redirectTo = 'login.html') {
  if (!button) return;
  button.addEventListener('click', async () => {
    try {
      const client = getSupabaseClient();
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Supabase sign-out failed:', error);
    }
    setSession(null);
    window.location.href = resolvePagePath(redirectTo);
  });
}

function setupAppPage() {
  if (!requireAuth()) return;

  const currentName = getSession();
  const userName = document.getElementById('currentUser');
  const welcomeUser = document.getElementById('welcomeUser');
  const logoutButton = document.getElementById('logoutBtn');
  const addFriendBtn = document.getElementById('addFriendBtn');
  const friendToggle = document.getElementById('friendToggle');
  const closeDrawer = document.getElementById('closeDrawer');
  const friendDrawer = document.getElementById('friendDrawer');
  const friendList = document.getElementById('friendList');
  const profileShortcut = document.getElementById('profileShortcut');
  const friendsShortcut = document.getElementById('friendsShortcut');
  const appUid = document.getElementById('appUid');

  const currentUser = getCurrentUserRecord();

  if (userName) userName.textContent = currentName;
  if (welcomeUser) welcomeUser.textContent = currentName;
  if (appUid && currentUser) appUid.textContent = currentUser.uid || '-';

  attachLogoutButton(logoutButton, 'login.html');

  if (addFriendBtn) {
    addFriendBtn.addEventListener('click', () => {
      window.location.href = resolvePagePath('friends/add.html');
    });
  }

  if (friendToggle && friendDrawer) {
    friendToggle.addEventListener('click', () => {
      friendDrawer.classList.toggle('open');
    });
  }

  if (closeDrawer && friendDrawer) {
    closeDrawer.addEventListener('click', () => friendDrawer.classList.remove('open'));
  }

  const refreshFriends = () => renderFriendList(friendList);
  refreshFriends();
  window.setInterval(refreshFriends, 5000);

  if (profileShortcut) {
    profileShortcut.addEventListener('click', () => {
      window.location.href = resolvePagePath('user/profile.html');
    });
  }

  if (friendsShortcut) {
    friendsShortcut.addEventListener('click', () => {
      window.location.href = resolvePagePath('friends.html');
    });
  }
}

function setupProfilePage() {
  if (!requireAuth()) return;

  const currentUser = getCurrentUserRecord();
  const name = currentUser?.name || getSession();
  const currentUserEl = document.getElementById('currentUser');
  const profileUserName = document.getElementById('profileUserName');
  const profileUsername = document.getElementById('profileUsername');
  const profileUid = document.getElementById('profileUid');
  const copyUidBtn = document.getElementById('copyUidBtn');
  const logoutButton = document.getElementById('logoutBtn');
  const secondaryLogoutButton = document.getElementById('logoutSecondary');
  const avatarInput = document.getElementById('profileAvatarInput');
  const avatarImage = document.getElementById('profileAvatarImage');
  const avatarInitial = document.getElementById('profileAvatarInitial');
  const avatarMessage = document.getElementById('profileAvatarMessage');
  const avatarChange = document.querySelector('.avatar-change');

  if (currentUserEl) currentUserEl.textContent = name;
  if (profileUserName) profileUserName.textContent = name;
  if (profileUsername) profileUsername.textContent = name;
  if (profileUid) profileUid.textContent = currentUser?.uid || '-';
  if (avatarInitial) avatarInitial.textContent = Array.from(name || 'U')[0].toUpperCase();

  const displayAvatar = (url) => {
    if (!avatarImage || !avatarInitial) return;
    avatarImage.src = url || '';
    avatarImage.hidden = !url;
    avatarInitial.hidden = Boolean(url);
  };

  const loadAvatar = async () => {
    const client = getSupabaseClient();
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    if (!data.user) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

    const { data: profile, error: profileError } = await client
      .from('flowlock_profiles')
      .select('avatar_path')
      .eq('id', data.user.id)
      .single();
    if (profileError) throw profileError;
    if (!profile.avatar_path) return;

    const { data: signedUrl, error: signedUrlError } = await client
      .storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(profile.avatar_path, 3600);
    if (signedUrlError) throw signedUrlError;
    displayAvatar(signedUrl.signedUrl);
  };

  loadAvatar().catch((error) => {
    showMessage(avatarMessage, `โหลดรูปโปรไฟล์ไม่สำเร็จ (${error.message})`);
  });

  if (avatarInput) {
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) return;

      const extension = AVATAR_FILE_EXTENSIONS[file.type];
      if (!extension) {
        showMessage(avatarMessage, 'รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP');
        avatarInput.value = '';
        return;
      }
      if (file.size > MAX_AVATAR_SIZE) {
        showMessage(avatarMessage, 'รูปต้องมีขนาดไม่เกิน 5 MB');
        avatarInput.value = '';
        return;
      }

      avatarInput.disabled = true;
      if (avatarChange) avatarChange.setAttribute('aria-disabled', 'true');
      showMessage(avatarMessage, 'กำลังอัปโหลดรูป...');

      let client;
      let userId;
      let avatarPath;
      try {
        client = getSupabaseClient();
        const { data: authData, error: authError } = await client.auth.getUser();
        if (authError) throw authError;
        if (!authData.user) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
        userId = authData.user.id;

        const { data: profile, error: profileError } = await client
          .from('flowlock_profiles')
          .select('avatar_path')
          .eq('id', userId)
          .single();
        if (profileError) throw profileError;

        avatarPath = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
        const storage = client.storage.from(AVATAR_BUCKET);
        const { error: uploadError } = await storage.upload(avatarPath, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false
        });
        if (uploadError) throw uploadError;

        const { data: signedUrl, error: signedUrlError } = await storage.createSignedUrl(avatarPath, 3600);
        if (signedUrlError) {
          const { error: cleanupError } = await storage.remove([avatarPath]);
          if (cleanupError) console.error('Unable to clean up uploaded avatar:', cleanupError);
          throw signedUrlError;
        }

        const { error: updateError } = await client
          .from('flowlock_profiles')
          .update({ avatar_path: avatarPath })
          .eq('id', userId);
        if (updateError) {
          const { error: cleanupError } = await storage.remove([avatarPath]);
          if (cleanupError) console.error('Unable to clean up uploaded avatar:', cleanupError);
          throw updateError;
        }

        displayAvatar(signedUrl.signedUrl);
        if (profile.avatar_path) {
          const { error: removeError } = await storage.remove([profile.avatar_path]);
          if (removeError) {
            console.error('Unable to remove previous avatar:', removeError);
            showMessage(avatarMessage, 'เปลี่ยนรูปแล้ว แต่ลบรูปเดิมไม่สำเร็จ', true);
          } else {
            showMessage(avatarMessage, 'เปลี่ยนรูปโปรไฟล์แล้ว', true);
          }
        } else {
          showMessage(avatarMessage, 'เพิ่มรูปโปรไฟล์แล้ว', true);
        }
      } catch (error) {
        showMessage(avatarMessage, `อัปโหลดรูปไม่สำเร็จ (${error.message})`);
      } finally {
        avatarInput.disabled = false;
        avatarInput.value = '';
        if (avatarChange) avatarChange.removeAttribute('aria-disabled');
      }
    });
  }

  if (copyUidBtn) {
    copyUidBtn.addEventListener('click', async () => {
      const uid = currentUser?.uid || '-';
      try {
        await navigator.clipboard.writeText(uid);
        copyUidBtn.textContent = 'คัดลอกแล้ว';
        setTimeout(() => {
          copyUidBtn.textContent = 'คัดลอก UID';
        }, 1200);
      } catch (error) {
        copyUidBtn.textContent = 'คัดลอกไม่ได้';
      }
    });
  }

  attachLogoutButton(logoutButton, 'login.html');
  attachLogoutButton(secondaryLogoutButton, 'login.html');
}

function setupFriendsAddPage() {
  if (!requireAuth()) return;

  const form = document.getElementById('addFriendForm');
  const input = document.getElementById('friendInput');
  const message = document.getElementById('friendMessage');
  const currentUserEl = document.getElementById('currentUser');

  if (currentUserEl) {
    currentUserEl.textContent = getSession();
  }

  if (!form || !input) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      const result = await addFriendByValue(input.value);
      showMessage(message, result.message, result.success);
      if (result.success) {
        input.value = '';
      }
    } catch (error) {
      showMessage(message, error.message || 'ค้นหาบัญชีไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function setupFriendsListPage() {
  if (!requireAuth()) return;

  const currentUserEl = document.getElementById('currentUser');
  const listEl = document.getElementById('friendsList');
  const pendingEl = document.getElementById('pendingRequests');
  const logoutButton = document.getElementById('logoutBtn');
  const closeFriendModalBtn = document.getElementById('closeFriendModal');
  const copyFriendUidBtn = document.getElementById('copyFriendUidBtn');
  const friendModal = document.getElementById('friendModal');

  if (currentUserEl) {
    currentUserEl.textContent = getSession();
  }

  if (closeFriendModalBtn && friendModal) {
    closeFriendModalBtn.addEventListener('click', closeFriendProfile);
  }

  if (friendModal) {
    friendModal.addEventListener('click', (event) => {
      if (event.target === friendModal) closeFriendProfile();
    });
  }

  if (copyFriendUidBtn) {
    copyFriendUidBtn.addEventListener('click', async () => {
      const uid = copyFriendUidBtn.dataset.uid || '-';
      try {
        await navigator.clipboard.writeText(uid);
        copyFriendUidBtn.textContent = 'คัดลอกแล้ว';
        setTimeout(() => {
          copyFriendUidBtn.textContent = 'คัดลอก UID';
        }, 1200);
      } catch (error) {
        copyFriendUidBtn.textContent = 'คัดลอกไม่ได้';
      }
    });
  }

  attachLogoutButton(logoutButton, 'login.html');
  const refreshFriends = async () => {
    await Promise.all([
      renderPendingRequests(pendingEl),
      renderFriendList(listEl)
    ]);
  };
  refreshFriends();
  window.setInterval(refreshFriends, 5000);
}

async function setupTradePage() {
  if (!requireAuth()) return;

  const currentUserEl = document.getElementById('currentUser');
  const logoutButton = document.getElementById('logoutBtn');
  const friendSelect = document.getElementById('tradeFriend');
  const createRoomButton = document.getElementById('createTradeRoom');
  const message = document.getElementById('tradeRoomMessage');
  const roomsList = document.getElementById('tradeRooms');
  const inviteDialog = document.getElementById('tradeInviteDialog');
  const inviteStatus = document.getElementById('tradeInviteStatus');
  const acceptInviteButton = document.getElementById('acceptTradeInvite');
  const rejectInviteButton = document.getElementById('rejectTradeInvite');

  attachLogoutButton(logoutButton, 'login.html');

  let identity;
  let friends;
  try {
    identity = await getFlowlockIdentity();
    friends = await getFriendsForCurrentUser();
    if (currentUserEl) currentUserEl.textContent = identity.name;
    friendSelect.innerHTML = friends.length
      ? friends.map((friend) => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.name)}</option>`).join('')
      : '<option value="">ยังไม่มีเพื่อนในรายชื่อ</option>';
  } catch (error) {
    showMessage(message, error.message || 'โหลดรายชื่อเพื่อนไม่สำเร็จ');
    return;
  }

  createRoomButton.addEventListener('click', async () => {
    createRoomButton.disabled = true;
    try {
      const friend = friends.find((item) => item.id === friendSelect.value);
      if (!friend) {
        showMessage(message, 'กรุณาเลือกเพื่อนก่อนส่งคำเชิญ');
        return;
      }

      const existingRooms = await listFlowlockSharedRooms('trade', identity);
      const existing = existingRooms.find((row) =>
        [row.payload.hostId, row.payload.guestId].includes(identity.id)
        && [row.payload.hostId, row.payload.guestId].includes(friend.id)
        && !['closed', 'rejected'].includes(row.payload.status)
      );
      if (existing) {
        window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(existing.id)}`;
        return;
      }

      const roomId = `trade-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      const room = {
        id: roomId,
        host: identity.name,
        hostId: identity.id,
        guest: friend.name,
        guestId: friend.id,
        status: 'invited',
        ready: {},
        trades: [],
        createdAt: Date.now()
      };
      await createFlowlockSharedRoom({
        id: roomId,
        kind: 'trade',
        ownerId: identity.id,
        participantIds: [identity.id, friend.id],
        payload: room
      });
      window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(room.id)}`;
    } catch (error) {
      showMessage(message, error.message || 'สร้างห้องเทรดไม่สำเร็จ');
    } finally {
      createRoomButton.disabled = false;
    }
  });

  const refreshFriends = async () => {
    try {
      const selectedFriend = friendSelect.value;
      friends = await getFriendsForCurrentUser();
      friendSelect.innerHTML = friends.length
        ? friends.map((friend) => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.name)}</option>`).join('')
        : '<option value="">ยังไม่มีเพื่อนในรายชื่อ</option>';
      if (friends.some((friend) => friend.id === selectedFriend)) friendSelect.value = selectedFriend;
    } catch (error) {
      showMessage(message, error.message || 'โหลดรายชื่อเพื่อนไม่สำเร็จ');
    }
  };
  const refresh = () => renderTradeRooms(roomsList, identity, inviteDialog, respondToInvite);
  const respondToInvite = async (roomId, accept) => {
    const row = await getFlowlockSharedRoom(roomId);
    const room = row?.payload;
    if (!row || !room || room.guestId !== identity.id || room.status !== 'invited') {
      throw new Error('คำเชิญนี้ไม่พร้อมตอบรับแล้ว');
    }

    room.status = accept ? 'joined' : 'rejected';
    if (accept) room.joinedAt = Date.now();
    else room.rejectedAt = Date.now();
    await updateFlowlockSharedRoom(roomId, row.participant_ids, room, row.updated_at);
    if (inviteDialog.open) inviteDialog.close();
    if (accept) {
      window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(roomId)}`;
      return;
    }
    await refresh();
  };

  [acceptInviteButton, rejectInviteButton].forEach((button) => {
    button.addEventListener('click', async () => {
      const accept = button === acceptInviteButton;
      const roomId = inviteDialog.dataset.roomId;
      button.disabled = true;
      acceptInviteButton.disabled = true;
      rejectInviteButton.disabled = true;
      inviteStatus.textContent = '';
      try {
        await respondToInvite(roomId, accept);
      } catch (error) {
        showMessage(inviteStatus, error.message || 'จัดการคำเชิญไม่สำเร็จ');
      } finally {
        acceptInviteButton.disabled = false;
        rejectInviteButton.disabled = false;
      }
    });
  });

  refresh();
  window.setInterval(refreshFriends, 5000);
  window.setInterval(refresh, 3000);
}

async function renderTradeRooms(container, identity, inviteDialog = null, respondToInvite = null) {
  if (!container) return;

  let rows;
  try {
    rows = await listFlowlockSharedRooms('trade', identity);
  } catch (error) {
    container.innerHTML = `<p class="msg">${escapeHtml(error.message || 'โหลดห้องเทรดไม่สำเร็จ')}</p>`;
    return;
  }

  const rooms = rows.map((row) => row.payload)
    .filter((room) => room.status !== 'closed')
    .sort((first, second) => second.createdAt - first.createdAt);

  if (!rooms.length) {
    container.innerHTML = '<p class="empty-friend">ยังไม่มีห้องเทรด</p>';
  } else {
    container.innerHTML = rooms.map((room) => {
      const incoming = room.guestId === identity.id && room.status === 'invited';
      const friend = room.hostId === identity.id ? room.guest : room.host;
      const state = room.status === 'joined' || room.status === 'trading'
        ? 'เพื่อนเข้าห้องแล้ว'
        : room.status === 'rejected' ? 'อีกฝ่ายปฏิเสธคำเชิญ'
          : incoming ? 'มีคำเชิญใหม่' : 'รอเพื่อนเข้าห้อง';
      return `
        <article class="trade-request">
          <div><strong>ห้องกับ ${escapeHtml(friend)}</strong><span>${state}</span></div>
          ${incoming
            ? `<div class="trade-invite-actions">
                <button class="mini-btn reject-trade-invite" type="button" data-room-id="${escapeHtml(room.id)}">ปฏิเสธ</button>
                <button class="mini-btn accept-trade-invite" type="button" data-room-id="${escapeHtml(room.id)}">เข้าร่วม</button>
              </div>`
            : room.status === 'rejected' ? '' : `<button class="mini-btn open-trade-room" type="button" data-room-id="${escapeHtml(room.id)}">เปิดห้อง</button>`}
        </article>
      `;
    }).join('');

    container.querySelectorAll('.open-trade-room').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(button.dataset.roomId)}`;
      });
    });

    container.querySelectorAll('.accept-trade-invite, .reject-trade-invite').forEach((button) => {
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          const accept = button.classList.contains('accept-trade-invite');
          if (!respondToInvite) throw new Error('ไม่สามารถจัดการคำเชิญนี้ได้');
          await respondToInvite(button.dataset.roomId, accept);
        } catch (error) {
          showMessage(container, error.message || 'จัดการคำเชิญไม่สำเร็จ');
          button.disabled = false;
        }
      });
    });
  }

  if (inviteDialog) {
    const invitation = rooms.find((room) => room.guestId === identity.id && room.status === 'invited');
    if (invitation) {
      inviteDialog.dataset.roomId = invitation.id;
      document.getElementById('tradeInviteMessage').textContent = `${invitation.host} เชิญคุณเข้าร่วมห้องเทรด`;
      if (!inviteDialog.open) inviteDialog.showModal();
    } else if (inviteDialog.open) {
      inviteDialog.close();
    }
  }
}

async function setupTradeRoomPage() {
  if (!requireAuth()) return;

  const currentUserEl = document.getElementById('currentUser');
  const logoutButton = document.getElementById('logoutBtn');
  const roomState = document.getElementById('tradeRoomState');
  const members = document.getElementById('tradeRoomMembers');
  const readyButton = document.getElementById('tradeReady');
  const actions = document.getElementById('roomTradeActions');
  const form = document.getElementById('roomTradeForm');
  const formMessage = document.getElementById('roomTradeMessage');
  const roomMessage = document.getElementById('tradeRoomMessage');
  const offerConfirmButton = document.getElementById('tradeConfirm');
  const offerHistory = document.getElementById('roomTradeHistory');
  const sideSelect = document.getElementById('tradeSide');
  const walletFields = document.getElementById('walletOfferFields');
  const recipientFields = document.getElementById('recipientOfferFields');
  const recipientType = document.getElementById('recipientOfferType');
  const publicIdFields = document.getElementById('publicIdFields');
  const redeemCodeFields = document.getElementById('redeemCodeFields');
  const roomId = new URLSearchParams(window.location.search).get('room');

  attachLogoutButton(logoutButton, 'login.html');
  let identity;
  let room;
  let updatedAt;
  let offerState;
  let formDirty = false;
  try {
    identity = await getFlowlockIdentity();
    if (currentUserEl) currentUserEl.textContent = identity.name;
  } catch (error) {
    roomState.textContent = error.message || 'ไม่สามารถตรวจสอบบัญชีได้';
    return;
  }

  const render = () => {
    if (!room || ![room.hostId, room.guestId].includes(identity.id)) {
      roomState.textContent = 'ไม่พบห้องนี้ หรือคุณไม่ได้รับเชิญ';
      readyButton.hidden = true;
      actions.hidden = true;
      return;
    }

    const isJoined = room.status === 'joined' || room.status === 'trading';
    const everyoneReady = Boolean(offerState?.bothReady);
    roomState.textContent = room.status === 'invited'
      ? `กำลังรอ ${room.guest} เข้าห้อง`
      : room.status === 'rejected' ? 'คำเชิญนี้ถูกปฏิเสธแล้ว'
        : everyoneReady ? 'ทั้งสองฝ่ายพร้อมแล้ว เริ่มกำหนดข้อเสนอได้' : 'ทั้งสองฝ่ายต้องกดยืนยันความพร้อมก่อนเริ่มเทรด';
    members.innerHTML = [[room.host, room.hostId], [room.guest, room.guestId]].map(([name, userId]) => {
      const inRoom = room.status !== 'invited' || name === room.host;
      const ready = userId === identity.id
        ? Boolean(offerState?.ownReady)
        : Boolean(offerState?.partnerReady);
      return `<div class="trade-member"><strong>${escapeHtml(name)}${name === identity.name ? ' (คุณ)' : ''}</strong><span>${!inRoom ? 'รอเข้าห้อง' : ready ? 'พร้อมแล้ว' : 'อยู่ในห้อง'}</span></div>`;
    }).join('');
    readyButton.hidden = !isJoined || everyoneReady;
    readyButton.disabled = !isJoined || everyoneReady;
    readyButton.textContent = offerState?.ownReady ? 'ยกเลิกความพร้อม' : 'ตกลง พร้อมเทรด';
    actions.hidden = !everyoneReady;
    form.hidden = !everyoneReady;
    updateTradeOfferFields();
    renderTradeOfferState(offerHistory, offerState, everyoneReady);
    const ownOffer = offerState?.ownOffer;
    offerConfirmButton.hidden = !everyoneReady || !ownOffer || ownOffer.confirmed || offerState?.bothConfirmed;
  };

  if (!roomId) {
    roomState.textContent = 'ไม่พบรหัสห้อง';
    readyButton.hidden = true;
    return;
  }

  const refresh = async (force = false) => {
    try {
      const row = await getFlowlockSharedRoom(roomId);
      if (!row) {
        room = null;
        offerState = null;
        render();
        return;
      }
      if (force || row.updated_at !== updatedAt) {
        room = row.payload;
        updatedAt = row.updated_at;
      }
      offerState = await loadFlowlockTradeOffer(roomId);
      hydrateTradeOfferForm();
      render();
    } catch (error) {
      roomState.textContent = error.message || 'โหลดข้อมูลห้องไม่สำเร็จ';
    }
  };

  readyButton.addEventListener('click', async () => {
    readyButton.disabled = true;
    try {
      await refresh(true);
      if (!room || !['joined', 'trading'].includes(room.status) || ![room.hostId, room.guestId].includes(identity.id)) return;
      await setFlowlockTradeReady(roomId, !offerState?.ownReady);
      await refresh(true);
    } catch (error) {
      showMessage(roomMessage, error.message || 'บันทึกสถานะไม่สำเร็จ');
    } finally {
      readyButton.disabled = false;
    }
  });

  const updateTradeOfferFields = () => {
    const isPayer = sideSelect.value === 'payer';
    const isRecipient = sideSelect.value === 'recipient';
    const usesPublicId = recipientType.value === 'public_id';
    walletFields.hidden = !isPayer;
    recipientFields.hidden = !isRecipient;
    publicIdFields.hidden = !isRecipient || !usesPublicId;
    redeemCodeFields.hidden = !isRecipient || usesPublicId;
    document.getElementById('walletOfferLink').required = isPayer;
    document.getElementById('publicIdName').required = isRecipient && usesPublicId;
    document.getElementById('publicIdValue').required = isRecipient && usesPublicId;
    document.getElementById('redeemCodeValue').required = isRecipient && !usesPublicId;
  };

  const hydrateTradeOfferForm = () => {
    const ownOffer = offerState?.ownOffer;
    if (formDirty || !ownOffer) return;
    sideSelect.value = ownOffer.side;
    recipientType.value = ownOffer.type === 'redeem_code' ? 'redeem_code' : 'public_id';
    updateTradeOfferFields();
    if (ownOffer.type === 'wallet_link') {
      document.getElementById('walletOfferLink').value = ownOffer.details.url || '';
    } else if (ownOffer.type === 'public_id') {
      document.getElementById('publicIdName').value = ownOffer.details.name || '';
      document.getElementById('publicIdValue').value = ownOffer.details.value || '';
    } else if (ownOffer.type === 'redeem_code') {
      document.getElementById('redeemCodeValue').value = ownOffer.details.value || '';
    }
  };

  sideSelect.addEventListener('change', () => {
    formDirty = true;
    updateTradeOfferFields();
  });
  recipientType.addEventListener('change', () => {
    formDirty = true;
    updateTradeOfferFields();
  });
  form.addEventListener('input', () => {
    formDirty = true;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await refresh(true);
      if (!room || !offerState?.bothReady) {
        showMessage(formMessage, 'ทั้งสองฝ่ายต้องอยู่ในห้องและยืนยันความพร้อมก่อน');
        return;
      }
      const side = sideSelect.value;
      if (!side) {
        showMessage(formMessage, 'กรุณาเลือกบทบาทของคุณ');
        return;
      }
      let offerType;
      let details;
      if (side === 'payer') {
        const walletLink = document.getElementById('walletOfferLink').value.trim();
        let parsedLink;
        try {
          parsedLink = new URL(walletLink);
        } catch {
          throw new Error('กรุณาใส่ลิงก์ Mini Wallet ที่ถูกต้อง');
        }
        if (parsedLink.protocol !== 'https:') {
          throw new Error('ลิงก์ Mini Wallet ต้องขึ้นต้นด้วย https://');
        }
        offerType = 'wallet_link';
        details = { url: walletLink };
      } else if (recipientType.value === 'public_id') {
        offerType = 'public_id';
        details = {
          name: document.getElementById('publicIdName').value.trim(),
          value: document.getElementById('publicIdValue').value.trim()
        };
        if (!details.name || !details.value) {
          showMessage(formMessage, 'กรุณากรอกชื่อโปรไฟล์และรหัสไอดีสาธารณะ');
          return;
        }
      } else {
        offerType = 'redeem_code';
        details = { value: document.getElementById('redeemCodeValue').value.trim() };
        if (!details.value) {
          showMessage(formMessage, 'กรุณากรอกโค้ดแลกรับ');
          return;
        }
      }

      await submitFlowlockTradeOffer(roomId, side, offerType, details);
      formDirty = false;
      await refresh(true);
      showMessage(formMessage, 'บันทึกข้อเสนอแล้ว ข้อมูลจะเปิดเมื่อทั้งคู่ยืนยัน', true);
    } catch (error) {
      showMessage(formMessage, error.message || 'บันทึกรายการไม่สำเร็จ');
    }
  });

  offerConfirmButton.addEventListener('click', async () => {
    offerConfirmButton.disabled = true;
    try {
      await confirmFlowlockTradeOffer(roomId);
      await refresh(true);
      showMessage(roomMessage, offerState?.bothConfirmed
        ? 'ทั้งสองฝ่ายยืนยันแล้ว ข้อเสนอถูกเปิดเผย'
        : 'ยืนยันข้อเสนอแล้ว กำลังรออีกฝ่ายยืนยัน', true);
    } catch (error) {
      showMessage(roomMessage, error.message || 'ยืนยันข้อเสนอไม่สำเร็จ');
    } finally {
      offerConfirmButton.disabled = false;
    }
  });

  await refresh(true);
  window.setInterval(() => refresh(), 2500);
}

function renderTradeOfferState(container, state, everyoneReady) {
  if (!container) return;
  if (!everyoneReady) {
    container.innerHTML = '<p class="empty-friend">ข้อเสนอจะเริ่มได้เมื่อทั้งสองฝ่ายพร้อม</p>';
    return;
  }
  if (!state) {
    container.innerHTML = '<p class="empty-friend">กำลังโหลดข้อเสนอ</p>';
    return;
  }

  const ownOffer = state.ownOffer;
  const partnerOffer = state.partnerOffer;
  const renderOffer = (offer, heading) => {
    if (!offer) return '';
    let details = '';
    if (offer.type === 'wallet_link') {
      const url = String(offer.details.url || '');
      details = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">เปิด Link to Mini Wallet</a>`;
    } else if (offer.type === 'public_id') {
      details = `<p>ชื่อโปรไฟล์: ${escapeHtml(offer.details.name || '')}<br>รหัสไอดีสาธารณะ: ${escapeHtml(offer.details.value || '')}</p>`;
    } else if (offer.type === 'redeem_code') {
      details = `<p>โค้ดแลกรับ: ${escapeHtml(offer.details.value || '')}</p>`;
    }
    return `<article class="trade-request"><div><strong>${heading} · ${offer.side === 'payer' ? 'ผู้จ่าย' : 'ผู้รับ'}</strong>${details}</div></article>`;
  };
  const partnerStatus = state.bothConfirmed
    ? 'ยืนยันครบทั้งสองฝ่าย'
    : state.partnerConfirmed ? 'อีกฝ่ายยืนยันแล้ว' : state.partnerSubmitted ? 'รออีกฝ่ายยืนยัน' : 'รออีกฝ่ายส่งข้อเสนอ';
  const ownStatus = ownOffer
    ? ownOffer.confirmed ? 'คุณยืนยันแล้ว' : 'ข้อเสนอของคุณยังไม่ยืนยัน'
    : 'คุณยังไม่ได้ส่งข้อเสนอ';

  container.innerHTML = `
    ${renderOffer(ownOffer, 'ข้อเสนอของคุณ')}
    ${state.bothConfirmed
      ? renderOffer(partnerOffer, `ข้อเสนอของ ${escapeHtml(state.partnerName || 'อีกฝ่าย')}`)
      : `<article class="trade-request"><div><strong>ข้อเสนอของอีกฝ่าย</strong><span>${partnerStatus} · ข้อมูลยังถูกซ่อนไว้</span></div></article>`}
    <p class="trade-offer-state">${ownStatus} · ${partnerStatus}</p>
  `;
}

async function setupTradeHistoryPage() {
  if (!requireAuth()) return;

  const currentName = getSession();
  const currentUserEl = document.getElementById('currentUser');
  const logoutButton = document.getElementById('logoutBtn');
  const historyList = document.getElementById('tradeHistory');
  if (currentUserEl) currentUserEl.textContent = currentName;
  attachLogoutButton(logoutButton, 'login.html');

  let identity;
  try {
    identity = await getFlowlockIdentity();
  } catch (error) {
    historyList.innerHTML = `<p class="msg">${escapeHtml(error.message || 'ไม่สามารถตรวจสอบบัญชีได้')}</p>`;
    return;
  }

  const render = async () => {
    try {
      const rows = await listFlowlockSharedRooms('trade', identity);
      const rooms = rows.map((row) => row.payload);
      const history = rooms.flatMap((room) => room.trades || [])
        .sort((first, second) => second.createdAt - first.createdAt);
      if (!history.length) {
        historyList.innerHTML = '<p class="empty-friend">ยังไม่มีประวัติรายการ</p>';
        return;
      }
      const roomMap = new Map(rooms.map((room) => [room.id, room]));
      historyList.innerHTML = history.map((trade) => {
        const room = roomMap.get(trade.roomId);
        const confirmed = Array.isArray(trade.confirmedBy) ? trade.confirmedBy : [];
        const done = room && confirmed.includes(room.hostId) && confirmed.includes(room.guestId);
        const other = trade.from === currentName ? trade.to : trade.from;
        return `<article class="trade-history-item">
          <div class="trade-history-top"><strong>${trade.role === 'offer' ? 'ผู้ให้' : 'ผู้รับ'} · ${escapeHtml(trade.category)}</strong><time>${new Date(trade.createdAt).toLocaleString('th-TH')}</time></div>
          <p>${escapeHtml(trade.details)}</p>
          <span>${trade.from === currentName ? 'ส่งให้' : 'ได้รับจาก'} ${escapeHtml(other)} · ${done ? 'ยืนยันครบสองฝ่าย' : `ยืนยันแล้ว ${confirmed.length}/2`}</span>
        </article>`;
      }).join('');
    } catch (error) {
      historyList.innerHTML = `<p class="msg">${escapeHtml(error.message || 'โหลดประวัติไม่สำเร็จ')}</p>`;
    }
  };

  render();
  window.setInterval(render, 5000);
}

if (document.body && document.body.dataset.page === 'login') {
  setupLoginPage();
}

if (document.body && document.body.dataset.page === 'register') {
  setupRegisterPage();
}

if (document.body && document.body.dataset.page === 'app') {
  setupAppPage();
}

if (document.body && document.body.dataset.page === 'profile') {
  setupProfilePage();
}

if (document.body && document.body.dataset.page === 'friends-add') {
  setupFriendsAddPage();
}

if (document.body && document.body.dataset.page === 'friends-list') {
  setupFriendsListPage();
}

if (document.body && document.body.dataset.page === 'trade') {
  setupTradePage();
}

if (document.body && document.body.dataset.page === 'trade-confirm') {
  window.location.replace(resolvePagePath('trade.html'));
}

if (document.body && document.body.dataset.page === 'trade-room') {
  setupTradeRoomPage();
}

if (document.body && document.body.dataset.page === 'trade-history') {
  setupTradeHistoryPage();
}
