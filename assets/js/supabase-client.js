function getSupabaseClient() {
  const config = window.FLOWLOCK_SUPABASE_CONFIG;
  if (!config || !config.url || !config.anonKey) {
    throw new Error('ยังไม่ได้ตั้งค่า Supabase ใน assets/js/supabase-config.js');
  }
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('โหลด Supabase ไม่สำเร็จ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }
  if (!window.flowlockSupabaseClient) {
    window.flowlockSupabaseClient = window.supabase.createClient(config.url, config.anonKey);
  }
  return window.flowlockSupabaseClient;
}

async function getSupabaseAuthEmail(username) {
  const normalized = String(username || '').trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const localPart = Array.from(new Uint8Array(digest))
    .slice(0, 30)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `u-${localPart}@users.flowlock.invalid`;
}

async function getSupabaseProfile(client, userId) {
  const { data, error } = await client
    .from('flowlock_profiles')
    .select('username, uid')
    .eq('id', userId)
    .single();

  if (error) {
    throw new Error(`อ่านข้อมูลสมาชิกไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าฐานข้อมูล (${error.message})`);
  }
  return data;
}

function cacheSupabaseProfile(profile) {
  const users = getUsers();
  users[String(profile.username).trim().toLowerCase()] = {
    name: profile.username,
    uid: profile.uid
  };
  saveUsers(users);
  setSession(profile.username);
}

async function loadMemberCount() {
  const countElement = document.getElementById('memberCount');
  if (!countElement) return;

  try {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('get_flowlock_user_count');
    if (error) throw error;

    const count = Number(data);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('ระบบส่งจำนวนสมาชิกกลับมาในรูปแบบที่ไม่ถูกต้อง');
    }
    countElement.textContent = count.toLocaleString('th-TH');
    countElement.removeAttribute('title');
  } catch (error) {
    countElement.textContent = '—';
    countElement.title = error.message || 'ไม่สามารถโหลดจำนวนสมาชิกได้';
  }
}
