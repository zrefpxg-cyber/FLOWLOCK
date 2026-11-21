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
        && row.payload.status !== 'closed'
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
  const refresh = () => renderTradeRooms(roomsList, identity);
  refresh();
  window.setInterval(refreshFriends, 5000);
  window.setInterval(refresh, 3000);
}

async function renderTradeRooms(container, identity) {
  if (!container) return;

  let rooms;
  try {
    const rows = await listFlowlockSharedRooms('trade', identity);
    rooms = rows.map((row) => row.payload)
      .filter((room) => room.status !== 'closed')
      .sort((first, second) => second.createdAt - first.createdAt);
  } catch (error) {
    container.innerHTML = `<p class="msg">${escapeHtml(error.message || 'โหลดห้องเทรดไม่สำเร็จ')}</p>`;
    return;
  }

  if (!rooms.length) {
    container.innerHTML = '<p class="empty-friend">ยังไม่มีห้องเทรด</p>';
    return;
  }

  container.innerHTML = rooms.map((room) => {
    const incoming = room.guestId === identity.id && room.status === 'invited';
    const friend = room.hostId === identity.id ? room.guest : room.host;
    const state = room.status === 'joined' || room.status === 'trading'
      ? 'เพื่อนเข้าห้องแล้ว'
      : incoming ? 'มีคำเชิญใหม่' : 'รอเพื่อนเข้าห้อง';
    return `
      <article class="trade-request">
        <div><strong>ห้องกับ ${escapeHtml(friend)}</strong><span>${state}</span></div>
        <button class="mini-btn open-trade-room" type="button" data-room-id="${escapeHtml(room.id)}">${incoming ? 'เข้าห้อง' : 'เปิดห้อง'}</button>
      </article>
    `;
  }).join('');

  container.querySelectorAll('.open-trade-room').forEach((button) => {
    button.addEventListener('click', async () => {
      const roomId = button.dataset.roomId;
      button.disabled = true;
      try {
        const row = await getFlowlockSharedRoom(roomId);
        const room = row?.payload;
        if (!row || !room || !row.participant_ids.includes(identity.id)) {
          throw new Error('ไม่พบห้องนี้ หรือคุณไม่ได้รับเชิญ');
        }
        if (room.guestId === identity.id && room.status === 'invited') {
          room.status = 'joined';
          room.joinedAt = Date.now();
          await updateFlowlockSharedRoom(roomId, row.participant_ids, room, row.updated_at);
        }
        window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(roomId)}`;
      } catch (error) {
        showMessage(container, error.message || 'เปิดห้องเทรดไม่สำเร็จ');
        button.disabled = false;
      }
    });
  });
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
  const roleInput = document.getElementById('roomTradeRole');
  const formTitle = document.getElementById('roomTradeTitle');
  const roomId = new URLSearchParams(window.location.search).get('room');

  attachLogoutButton(logoutButton, 'login.html');
  let identity;
  let room;
  let updatedAt;
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
    const everyoneReady = Boolean(room.ready?.[room.hostId] && room.ready?.[room.guestId]);
    roomState.textContent = room.status === 'invited'
      ? `กำลังรอ ${room.guest} เข้าห้อง`
      : everyoneReady ? 'ทั้งสองฝ่ายพร้อมแล้ว' : 'ยืนยันความพร้อมเมื่อทั้งสองคนอยู่ในห้อง';
    members.innerHTML = [[room.host, room.hostId], [room.guest, room.guestId]].map(([name, userId]) => {
      const inRoom = room.status !== 'invited' || name === room.host;
      const ready = Boolean(room.ready?.[userId]);
      return `<div class="trade-member"><strong>${escapeHtml(name)}${name === identity.name ? ' (คุณ)' : ''}</strong><span>${!inRoom ? 'รอเข้าห้อง' : ready ? 'พร้อมแล้ว' : 'อยู่ในห้อง'}</span></div>`;
    }).join('');
    readyButton.hidden = !isJoined || everyoneReady;
    readyButton.disabled = !isJoined || everyoneReady;
    readyButton.textContent = room.ready?.[identity.id] ? 'ยกเลิกความพร้อม' : 'ตกลง พร้อมเทรด';
    actions.hidden = !everyoneReady;
    renderRoomTrades(document.getElementById('roomTradeHistory'), room, identity.id, persist);
  };

  if (!roomId) {
    roomState.textContent = 'ไม่พบรหัสห้อง';
    readyButton.hidden = true;
    return;
  }

  const persist = async () => {
    const row = await updateFlowlockSharedRoom(roomId, [room.hostId, room.guestId], room, updatedAt);
    updatedAt = row.updated_at;
  };
  const refresh = async (force = false) => {
    try {
      const row = await getFlowlockSharedRoom(roomId);
      if (!row) {
        room = null;
        render();
        return;
      }
      if (force || row.updated_at !== updatedAt) {
        room = row.payload;
        updatedAt = row.updated_at;
        render();
      }
    } catch (error) {
      roomState.textContent = error.message || 'โหลดข้อมูลห้องไม่สำเร็จ';
    }
  };

  readyButton.addEventListener('click', async () => {
    readyButton.disabled = true;
    try {
      await refresh(true);
      if (!room || room.status !== 'joined' || ![room.hostId, room.guestId].includes(identity.id)) return;
      room.ready = room.ready || {};
      room.ready[identity.id] = !room.ready[identity.id];
      room.status = room.ready[room.hostId] && room.ready[room.guestId] ? 'trading' : 'joined';
      await persist();
      render();
    } catch (error) {
      showMessage(roomMessage, error.message || 'บันทึกสถานะไม่สำเร็จ');
    } finally {
      readyButton.disabled = false;
    }
  });

  document.querySelectorAll('[data-room-role]').forEach((button) => {
    button.addEventListener('click', () => {
      roleInput.value = button.dataset.roomRole;
      formTitle.textContent = button.dataset.roomRole === 'offer' ? 'รายการที่เสนอให้' : 'รายการที่ต้องการรับ';
      form.hidden = false;
      formMessage.textContent = '';
      document.getElementById('roomTradeCategory').focus();
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await refresh(true);
      const details = document.getElementById('roomTradeDetails').value.trim();
      if (!room || room.status !== 'trading' || !details) {
        showMessage(formMessage, 'ทั้งสองฝ่ายต้องอยู่ในห้องและยืนยันความพร้อมก่อน');
        return;
      }
      if (/https?:\/\/|www\.|password|passwd|passcode|otp|cookie|token|access.?key|login|รหัสผ่าน|พาสเวิร์ด|รหัสผู้ใช้|ชื่อผู้ใช้|อั่งเปา|ทรูมันนี่|ลิงก์|link|บัญชี/i.test(details)) {
        showMessage(formMessage, 'รายละเอียดนี้มีลิงก์หรือข้อมูลอ่อนไหว กรุณาระบุเฉพาะรายการทั่วไป');
        return;
      }
      room.trades = Array.isArray(room.trades) ? room.trades : [];
      room.trades.push({
        id: `ITEM-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        roomId,
        from: identity.name,
        fromId: identity.id,
        to: room.hostId === identity.id ? room.guest : room.host,
        role: roleInput.value,
        category: document.getElementById('roomTradeCategory').value,
        details,
        confirmedBy: [],
        createdAt: Date.now()
      });
      await persist();
      form.reset();
      form.hidden = true;
      roomMessage.textContent = 'เพิ่มรายการในห้องแล้ว';
      render();
    } catch (error) {
      showMessage(formMessage, error.message || 'บันทึกรายการไม่สำเร็จ');
    }
  });

  await refresh(true);
  window.setInterval(() => refresh(), 2500);
}

function renderRoomTrades(container, room, currentUserId, persist) {
  if (!container) return;

  const trades = (room.trades || [])
    .sort((first, second) => first.createdAt - second.createdAt);
  if (!trades.length) {
    container.innerHTML = '<p class="empty-friend">ยังไม่มีรายการในห้อง</p>';
    return;
  }

  container.innerHTML = trades.map((trade) => {
    const confirmed = Array.isArray(trade.confirmedBy) ? trade.confirmedBy : [];
    const done = confirmed.includes(room.hostId) && confirmed.includes(room.guestId);
    const isParticipant = [room.hostId, room.guestId].includes(currentUserId);
    return `
      <article class="trade-request">
        <div><strong>${trade.role === 'offer' ? 'ผู้ให้' : 'ผู้รับ'} · ${escapeHtml(trade.category)}</strong>
          <span>${escapeHtml(trade.from)} · ${done ? 'ยืนยันครบสองฝ่าย' : `ยืนยันแล้ว ${confirmed.length}/2`}</span>
          <p>${escapeHtml(trade.details)}</p>
        </div>
        ${isParticipant && !confirmed.includes(currentUserId)
          ? `<button class="mini-btn confirm-room-trade" type="button" data-trade-id="${escapeHtml(trade.id)}">ยืนยันรายการ</button>`
          : ''}
      </article>
    `;
  }).join('');

  container.querySelectorAll('.confirm-room-trade').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      const trade = (room.trades || []).find((item) => item.id === button.dataset.tradeId);
      if (!trade) return;
      trade.confirmedBy = Array.isArray(trade.confirmedBy) ? trade.confirmedBy : [];
      if (![room.hostId, room.guestId].includes(currentUserId) || trade.confirmedBy.includes(currentUserId)) return;
      trade.confirmedBy.push(currentUserId);
      try {
        await persist();
        renderRoomTrades(container, room, currentUserId, persist);
      } catch (error) {
        showMessage(container, error.message || 'ยืนยันรายการไม่สำเร็จ');
        button.disabled = false;
      }
    });
  });
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
