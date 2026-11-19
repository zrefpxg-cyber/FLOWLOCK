const KEY_USERS = 'flowlock_users';
const KEY_SESSION = 'flowlock_session';
const KEY_FRIENDS = 'flowlock_friends';
const KEY_REQUESTS = 'flowlock_friend_requests';
const KEY_TRADES = 'flowlock_trades';
const KEY_TRADE_ROOMS = 'flowlock_trade_rooms';
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

function getUserByUid(value) {
  const uid = String(value || '').trim().toUpperCase();
  if (!uid) return null;

  const users = getUsers();
  return Object.values(users).find((user) => String(user.uid || '').toUpperCase() === uid) || null;
}

function findUserByUidOrName(value) {
  const input = String(value || '').trim();
  if (!input) return null;

  return getUserByUid(input) || getUserByUsername(input);
}

function getFriendMap() {
  return readStorage(KEY_FRIENDS) || {};
}

function saveFriendMap(map) {
  writeStorage(KEY_FRIENDS, map);
}

function getRequestMap() {
  return readStorage(KEY_REQUESTS) || {};
}

function saveRequestMap(map) {
  writeStorage(KEY_REQUESTS, map);
}

function getFriendsForCurrentUser() {
  const currentName = getSession();
  if (!currentName) return [];

  const map = getFriendMap();
  const key = String(currentName).trim().toLowerCase();
  return Array.isArray(map[key]) ? map[key] : [];
}

function saveFriendsForCurrentUser(list) {
  const currentName = getSession();
  if (!currentName) return;

  const map = getFriendMap();
  map[String(currentName).trim().toLowerCase()] = list;
  saveFriendMap(map);
}

function getPendingRequestsForCurrentUser() {
  const currentName = getSession();
  if (!currentName) return [];

  const map = getRequestMap();
  const key = String(currentName).trim().toLowerCase();
  return Array.isArray(map[key]) ? map[key] : [];
}

function savePendingRequestsForCurrentUser(list) {
  const currentName = getSession();
  if (!currentName) return;

  const map = getRequestMap();
  map[String(currentName).trim().toLowerCase()] = list;
  saveRequestMap(map);
}

function removeFriendFromList(username, friendName) {
  if (!username || !friendName) return;

  const map = getFriendMap();
  const key = String(username).trim().toLowerCase();
  const list = Array.isArray(map[key]) ? map[key] : [];
  map[key] = list.filter((friend) => String(friend.name).toLowerCase() !== String(friendName).toLowerCase());
  saveFriendMap(map);
}

function addFriendRequestToUser(targetUsername, senderUsername, senderUid) {
  const map = getRequestMap();
  const key = String(targetUsername).trim().toLowerCase();
  const list = Array.isArray(map[key]) ? map[key] : [];

  const duplicate = list.some((request) => String(request.name).toLowerCase() === String(senderUsername).toLowerCase());
  if (!duplicate) {
    list.push({ name: senderUsername, uid: senderUid || '-', createdAt: Date.now() });
    map[key] = list;
    saveRequestMap(map);
  }
}

function removeRequestForUser(targetUsername, senderName) {
  const map = getRequestMap();
  const key = String(targetUsername).trim().toLowerCase();
  const list = Array.isArray(map[key]) ? map[key] : [];
  map[key] = list.filter((request) => String(request.name).toLowerCase() !== String(senderName).toLowerCase());
  saveRequestMap(map);
}

function addFriendByValue(value) {
  const currentName = getSession();
  if (!currentName) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบก่อนเพิ่มเพื่อน' };
  }

  const currentUser = getCurrentUserRecord();
  const friend = findUserByUidOrName(value);
  if (!friend) {
    return { success: false, message: 'ไม่พบผู้ใช้นี้ในระบบ' };
  }

  if (String(friend.name).toLowerCase() === String(currentName).toLowerCase()) {
    return { success: false, message: 'ไม่สามารถเพิ่มตัวเองเป็นเพื่อนได้' };
  }

  const currentFriends = getFriendsForCurrentUser();
  const alreadyFriend = currentFriends.some((item) => String(item.uid || '').toUpperCase() === String(friend.uid || '').toUpperCase());
  if (alreadyFriend) {
    return { success: false, message: 'ผู้ใช้นี้อยู่ในรายชื่อเพื่อนแล้ว' };
  }

  const requests = getPendingRequestsForCurrentUser();
  const alreadyRequest = requests.some((request) => String(request.name).toLowerCase() === String(friend.name).toLowerCase());
  if (alreadyRequest) {
    return { success: false, message: 'คุณส่งคำขอเพื่อนไปแล้ว' };
  }

  addFriendRequestToUser(friend.name, currentName, currentUser?.uid || '-');

  return { success: true, message: 'ส่งคำขอเพื่อนแล้ว รอการยืนยัน', friend };
}

function acceptFriendRequest(senderName) {
  const currentName = getSession();
  if (!currentName) return false;

  const sender = findUserByUidOrName(senderName);
  if (!sender) return false;

  const currentMap = getFriendMap();
  const currentKey = String(currentName).trim().toLowerCase();
  const senderKey = String(sender.name).trim().toLowerCase();

  const currentList = Array.isArray(currentMap[currentKey]) ? currentMap[currentKey] : [];
  const senderList = Array.isArray(currentMap[senderKey]) ? currentMap[senderKey] : [];

  const currentHas = currentList.some((item) => String(item.uid || '').toUpperCase() === String(sender.uid || '').toUpperCase());
  if (!currentHas) currentList.push({ uid: sender.uid, name: sender.name });

  const senderHas = senderList.some((item) => String(item.uid || '').toUpperCase() === String(getCurrentUserRecord()?.uid || '').toUpperCase());
  if (!senderHas) senderList.push({ uid: getCurrentUserRecord()?.uid || '-', name: currentName });

  currentMap[currentKey] = currentList;
  currentMap[senderKey] = senderList;
  saveFriendMap(currentMap);

  removeRequestForUser(currentName, sender.name);
  return true;
}

function deleteFriend(friendName) {
  const currentName = getSession();
  if (!currentName || !friendName) return false;

  const friend = findUserByUidOrName(friendName);
  if (!friend) {
    removeFriendFromList(currentName, friendName);
    return true;
  }

  removeFriendFromList(currentName, friend.name);
  removeFriendFromList(friend.name, currentName);
  return true;
}

function renderPendingRequests(container) {
  if (!container) return;

  const requests = getPendingRequestsForCurrentUser();

  if (!requests.length) {
    container.innerHTML = '<div class="empty-friend">ยังไม่มีคำขอเพื่อน</div>';
    return;
  }

  container.innerHTML = requests.map((request) => `
    <div class="friend-card">
      <strong>${escapeHtml(request.name)}</strong>
      <small>${escapeHtml(request.uid || 'UID ไม่ระบุ')}</small>
      <div class="stack">
        <button class="mini-btn accept-request" type="button" data-request-name="${escapeHtml(request.name)}">รับเพื่อน</button>
        <button class="mini-btn delete-request" type="button" data-request-name="${escapeHtml(request.name)}">ลบ</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.accept-request').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.getAttribute('data-request-name');
      if (acceptFriendRequest(name)) {
        renderPendingRequests(container);
        renderFriendList(document.getElementById('friendsList'));
      }
    });
  });

  container.querySelectorAll('.delete-request').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.getAttribute('data-request-name');
      removeRequestForUser(getSession(), name);
      renderPendingRequests(container);
    });
  });
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

function renderFriendList(container) {
  if (!container) return;

  const list = getFriendsForCurrentUser();

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
        <button class="mini-btn delete-friend" type="button" data-friend-name="${escapeHtml(friend.name)}">ลบเพื่อน</button>
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
    button.addEventListener('click', () => {
      const friendName = button.getAttribute('data-friend-name');
      if (deleteFriend(friendName)) {
        renderFriendList(container);
        renderPendingRequests(document.getElementById('pendingRequests'));
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

  renderFriendList(friendList);

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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = addFriendByValue(input.value);
    showMessage(message, result.message, result.success);
    if (result.success) {
      input.value = '';
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
  renderPendingRequests(pendingEl);
  renderFriendList(listEl);
}

function getTrades() {
  const trades = readStorage(KEY_TRADES);
  return Array.isArray(trades) ? trades : [];
}

function getTradeRooms() {
  const rooms = readStorage(KEY_TRADE_ROOMS);
  return Array.isArray(rooms) ? rooms : [];
}

function saveTradeRooms(rooms) {
  return writeStorage(KEY_TRADE_ROOMS, rooms);
}

function getTradeRoom(roomId) {
  return getTradeRooms().find((room) => room.id === roomId) || null;
}

function setupTradePage() {
  if (!requireAuth()) return;

  const currentName = getSession();
  const currentUserEl = document.getElementById('currentUser');
  const logoutButton = document.getElementById('logoutBtn');
  const friendSelect = document.getElementById('tradeFriend');
  const createRoomButton = document.getElementById('createTradeRoom');
  const message = document.getElementById('tradeRoomMessage');
  const roomsList = document.getElementById('tradeRooms');

  if (currentUserEl) currentUserEl.textContent = currentName;
  attachLogoutButton(logoutButton, 'login.html');

  const friends = getFriendsForCurrentUser();
  if (friendSelect) {
    friendSelect.innerHTML = friends.length
      ? friends.map((friend) => `<option value="${escapeHtml(friend.name)}">${escapeHtml(friend.name)}</option>`).join('')
      : '<option value="">ยังไม่มีเพื่อนในรายชื่อ</option>';
  }

  createRoomButton.addEventListener('click', () => {
    const guest = friendSelect.value;
    if (!friends.some((friend) => friend.name === guest)) {
      showMessage(message, 'กรุณาเลือกเพื่อนก่อนส่งคำเชิญ');
      return;
    }

    const rooms = getTradeRooms();
    const existing = rooms.find((room) => room.host === currentName && room.guest === guest && room.status !== 'closed');
    if (existing) {
      window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(existing.id)}`;
      return;
    }

    const room = {
      id: `ROOM-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      host: currentName,
      guest,
      status: 'invited',
      ready: {},
      createdAt: Date.now()
    };
    rooms.push(room);
    if (!saveTradeRooms(rooms)) {
      showMessage(message, 'สร้างห้องไม่สำเร็จ กรุณาตรวจสอบพื้นที่จัดเก็บ');
      return;
    }
    window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(room.id)}`;
  });

  renderTradeRooms(roomsList, currentName);
  window.addEventListener('storage', () => renderTradeRooms(roomsList, currentName));
}

function renderTradeRooms(container, currentName) {
  if (!container) return;

  const rooms = getTradeRooms().filter((room) =>
    (room.host === currentName || room.guest === currentName) && room.status !== 'closed'
  ).sort((first, second) => second.createdAt - first.createdAt);

  if (!rooms.length) {
    container.innerHTML = '<p class="empty-friend">ยังไม่มีห้องเทรด</p>';
    return;
  }

  container.innerHTML = rooms.map((room) => {
    const incoming = room.guest === currentName && room.status === 'invited';
    const friend = room.host === currentName ? room.guest : room.host;
    const state = room.status === 'joined' ? 'เพื่อนเข้าห้องแล้ว' : incoming ? 'มีคำเชิญใหม่' : 'รอเพื่อนเข้าห้อง';
    return `
      <article class="trade-request">
        <div><strong>ห้องกับ ${escapeHtml(friend)}</strong><span>${state}</span></div>
        <button class="mini-btn open-trade-room" type="button" data-room-id="${escapeHtml(room.id)}">${incoming ? 'เข้าห้อง' : 'เปิดห้อง'}</button>
      </article>
    `;
  }).join('');

  container.querySelectorAll('.open-trade-room').forEach((button) => {
    button.addEventListener('click', () => {
      const roomId = button.dataset.roomId;
      const rooms = getTradeRooms();
      const room = rooms.find((item) => item.id === roomId);
      if (!room || room.guest !== currentName || room.status !== 'invited') {
        window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(roomId)}`;
        return;
      }
      room.status = 'joined';
      room.joinedAt = Date.now();
      saveTradeRooms(rooms);
      window.location.href = `${resolvePagePath('trade-room.html')}?room=${encodeURIComponent(roomId)}`;
    });
  });
}

function setupTradeRoomPage() {
  if (!requireAuth()) return;

  const currentName = getSession();
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

  if (currentUserEl) currentUserEl.textContent = currentName;
  attachLogoutButton(logoutButton, 'login.html');

  const render = () => {
    const room = getTradeRoom(roomId);
    if (!room || ![room.host, room.guest].includes(currentName)) {
      roomState.textContent = 'ไม่พบห้องนี้ หรือคุณไม่ได้รับเชิญ';
      readyButton.hidden = true;
      actions.hidden = true;
      return;
    }

    const isJoined = room.status === 'joined' || room.status === 'trading';
    const everyoneReady = Boolean(room.ready?.[room.host] && room.ready?.[room.guest]);
    roomState.textContent = room.status === 'invited'
      ? `กำลังรอ ${room.guest} เข้าห้อง`
      : everyoneReady ? 'ทั้งสองฝ่ายพร้อมแล้ว' : 'ยืนยันความพร้อมเมื่อทั้งสองคนอยู่ในห้อง';
    members.innerHTML = [room.host, room.guest].map((name) => {
      const inRoom = name === room.host || isJoined;
      const ready = Boolean(room.ready?.[name]);
      return `<div class="trade-member"><strong>${escapeHtml(name)}${name === currentName ? ' (คุณ)' : ''}</strong><span>${!inRoom ? 'รอเข้าห้อง' : ready ? 'พร้อมแล้ว' : 'อยู่ในห้อง'}</span></div>`;
    }).join('');
    readyButton.hidden = !isJoined || everyoneReady;
    readyButton.disabled = !isJoined || everyoneReady;
    readyButton.textContent = room.ready?.[currentName] ? 'ยกเลิกความพร้อม' : 'ตกลง พร้อมเทรด';
    actions.hidden = !everyoneReady;
    renderRoomTrades(document.getElementById('roomTradeHistory'), room);
  };

  if (!roomId) {
    roomState.textContent = 'ไม่พบรหัสห้อง';
    readyButton.hidden = true;
    return;
  }

  readyButton.addEventListener('click', () => {
    const rooms = getTradeRooms();
    const room = rooms.find((item) => item.id === roomId);
    if (!room || room.status !== 'joined' || ![room.host, room.guest].includes(currentName)) return;
    room.ready = room.ready || {};
    room.ready[currentName] = !room.ready[currentName];
    if (room.ready[room.host] && room.ready[room.guest]) room.status = 'trading';
    else room.status = 'joined';
    saveTradeRooms(rooms);
    render();
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const room = getTradeRoom(roomId);
    const details = document.getElementById('roomTradeDetails').value.trim();
    if (!room || room.status !== 'trading' || !details) {
      showMessage(formMessage, 'ทั้งสองฝ่ายต้องอยู่ในห้องและยืนยันความพร้อมก่อน');
      return;
    }
    if (/https?:\/\/|www\.|password|passwd|passcode|otp|cookie|token|access.?key|login|รหัสผ่าน|พาสเวิร์ด|รหัสผู้ใช้|ชื่อผู้ใช้|อั่งเปา|ทรูมันนี่|ลิงก์|link|บัญชี/i.test(details)) {
      showMessage(formMessage, 'รายละเอียดนี้มีลิงก์หรือข้อมูลอ่อนไหว กรุณาระบุเฉพาะรายการทั่วไป');
      return;
    }
    const trades = getTrades();
    trades.push({
      id: `ITEM-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      roomId,
      from: currentName,
      to: room.host === currentName ? room.guest : room.host,
      role: roleInput.value,
      category: document.getElementById('roomTradeCategory').value,
      details,
      confirmedBy: [],
      createdAt: Date.now()
    });
    if (!writeStorage(KEY_TRADES, trades)) {
      showMessage(formMessage, 'บันทึกรายการไม่สำเร็จ กรุณาตรวจสอบพื้นที่จัดเก็บ');
      return;
    }
    form.reset();
    form.hidden = true;
    roomMessage.textContent = 'เพิ่มรายการในห้องแล้ว';
    render();
  });

  window.addEventListener('storage', render);
  render();
}

function renderRoomTrades(container, room) {
  if (!container) return;

  const trades = getTrades().filter((trade) => trade.roomId === room.id)
    .sort((first, second) => first.createdAt - second.createdAt);
  if (!trades.length) {
    container.innerHTML = '<p class="empty-friend">ยังไม่มีรายการในห้อง</p>';
    return;
  }

  container.innerHTML = trades.map((trade) => {
    const confirmed = Array.isArray(trade.confirmedBy) ? trade.confirmedBy : [];
    const done = confirmed.includes(room.host) && confirmed.includes(room.guest);
    const isParticipant = [room.host, room.guest].includes(getSession());
    return `
      <article class="trade-request">
        <div><strong>${trade.role === 'offer' ? 'ผู้ให้' : 'ผู้รับ'} · ${escapeHtml(trade.category)}</strong>
          <span>${escapeHtml(trade.from)} · ${done ? 'ยืนยันครบสองฝ่าย' : `ยืนยันแล้ว ${confirmed.length}/2`}</span>
          <p>${escapeHtml(trade.details)}</p>
        </div>
        ${isParticipant && !confirmed.includes(getSession())
          ? `<button class="mini-btn confirm-room-trade" type="button" data-trade-id="${escapeHtml(trade.id)}">ยืนยันรายการ</button>`
          : ''}
      </article>
    `;
  }).join('');

  container.querySelectorAll('.confirm-room-trade').forEach((button) => {
    button.addEventListener('click', () => {
      const trades = getTrades();
      const trade = trades.find((item) => item.id === button.dataset.tradeId && item.roomId === room.id);
      if (!trade) return;
      trade.confirmedBy = Array.isArray(trade.confirmedBy) ? trade.confirmedBy : [];
      const currentName = getSession();
      if (![room.host, room.guest].includes(currentName) || trade.confirmedBy.includes(currentName)) return;
      trade.confirmedBy.push(currentName);
      writeStorage(KEY_TRADES, trades);
      renderRoomTrades(container, room);
    });
  });
}

function setupTradeHistoryPage() {
  if (!requireAuth()) return;

  const currentName = getSession();
  const currentUserEl = document.getElementById('currentUser');
  const logoutButton = document.getElementById('logoutBtn');
  const historyList = document.getElementById('tradeHistory');
  if (currentUserEl) currentUserEl.textContent = currentName;
  attachLogoutButton(logoutButton, 'login.html');

  const render = () => {
    const rooms = getTradeRooms();
    const roomMap = new Map(rooms.map((room) => [room.id, room]));
    const history = getTrades().filter((trade) => trade.from === currentName || trade.to === currentName)
      .sort((first, second) => second.createdAt - first.createdAt);
    if (!history.length) {
      historyList.innerHTML = '<p class="empty-friend">ยังไม่มีประวัติรายการ</p>';
      return;
    }
    historyList.innerHTML = history.map((trade) => {
      const room = roomMap.get(trade.roomId);
      const confirmed = Array.isArray(trade.confirmedBy) ? trade.confirmedBy : [];
      const done = room && confirmed.includes(room.host) && confirmed.includes(room.guest);
      const other = trade.from === currentName ? trade.to : trade.from;
      return `<article class="trade-history-item">
        <div class="trade-history-top"><strong>${trade.role === 'offer' ? 'ผู้ให้' : 'ผู้รับ'} · ${escapeHtml(trade.category)}</strong><time>${new Date(trade.createdAt).toLocaleString('th-TH')}</time></div>
        <p>${escapeHtml(trade.details)}</p>
        <span>${trade.from === currentName ? 'ส่งให้' : 'ได้รับจาก'} ${escapeHtml(other)} · ${done ? 'ยืนยันครบสองฝ่าย' : `ยืนยันแล้ว ${confirmed.length}/2`}</span>
      </article>`;
    }).join('');
  };

  render();
  window.addEventListener('storage', render);
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
