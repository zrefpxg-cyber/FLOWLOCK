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

async function findSupabaseProfileByUidOrUsername(value) {
  const searchValue = String(value || '').trim();
  if (!searchValue) return null;

  const { data, error } = await getSupabaseClient().rpc('find_flowlock_profile', {
    search_value: searchValue
  });
  if (error) {
    throw new Error(`ค้นหาสมาชิกไม่สำเร็จ กรุณาตรวจสอบการตั้งค่าฐานข้อมูล (${error.message})`);
  }

  const profile = Array.isArray(data) ? data[0] : null;
  return profile ? { name: profile.username, uid: profile.uid } : null;
}

async function getFlowlockIdentity() {
  const client = getSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  const profile = await getSupabaseProfile(client, authData.user.id);
  return { id: authData.user.id, name: profile.username, uid: profile.uid };
}

async function loadFlowlockFriends() {
  const { data, error } = await getSupabaseClient().rpc('get_flowlock_friends');
  if (error) throw new Error(`โหลดรายชื่อเพื่อนไม่สำเร็จ (${error.message})`);
  return (data || []).map((friend) => ({
    id: friend.id,
    name: friend.username,
    uid: friend.uid,
    createdAt: friend.created_at
  }));
}

async function loadFlowlockFriendRequests() {
  const { data, error } = await getSupabaseClient().rpc('get_flowlock_friend_requests');
  if (error) throw new Error(`โหลดคำขอเพื่อนไม่สำเร็จ (${error.message})`);
  return (data || []).map((request) => ({
    id: request.request_id,
    direction: request.direction,
    friendId: request.friend_id,
    name: request.username,
    uid: request.uid,
    createdAt: request.created_at
  }));
}

async function respondToFlowlockFriendRequest(requestId, accept) {
  const { data, error } = await getSupabaseClient().rpc('respond_flowlock_friend_request', {
    request_id: requestId,
    accept_request: accept
  });
  if (error) throw new Error(`อัปเดตคำขอเพื่อนไม่สำเร็จ (${error.message})`);
  if (data !== true) throw new Error('คำขอนี้ถูกจัดการแล้วหรือไม่พบคำขอ');
  return true;
}

async function removeFlowlockFriend(friendId) {
  const { data, error } = await getSupabaseClient().rpc('remove_flowlock_friend', {
    friend_id: friendId
  });
  if (error) throw new Error(`ลบเพื่อนไม่สำเร็จ (${error.message})`);
  if (data !== true) throw new Error('ไม่พบเพื่อนในรายชื่อ');
  return true;
}

async function sendFlowlockFriendRequest(value) {
  const { data, error } = await getSupabaseClient().rpc('send_flowlock_friend_request', {
    target_value: String(value || '').trim()
  });
  if (error) throw new Error(`ส่งคำขอเพื่อนไม่สำเร็จ (${error.message})`);
  return data;
}

async function listFlowlockSharedRooms(kind, identity = null) {
  const currentIdentity = identity || await getFlowlockIdentity();
  const { data, error } = await getSupabaseClient()
    .from('flowlock_shared_rooms')
    .select('id, kind, owner_id, participant_ids, payload, created_at, updated_at')
    .eq('kind', kind)
    .contains('participant_ids', [currentIdentity.id])
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`โหลดข้อมูลห้องไม่สำเร็จ (${error.message})`);
  return data || [];
}

async function getFlowlockSharedRoom(roomId) {
  const { data, error } = await getSupabaseClient()
    .from('flowlock_shared_rooms')
    .select('id, kind, owner_id, participant_ids, payload, created_at, updated_at')
    .eq('id', roomId)
    .maybeSingle();
  if (error) throw new Error(`โหลดห้องไม่สำเร็จ (${error.message})`);
  return data;
}

async function createFlowlockSharedRoom(room) {
  const { data, error } = await getSupabaseClient()
    .from('flowlock_shared_rooms')
    .insert({
      id: room.id,
      kind: room.kind,
      owner_id: room.ownerId,
      participant_ids: room.participantIds,
      payload: room.payload
    })
    .select('id, kind, owner_id, participant_ids, payload, created_at, updated_at')
    .single();
  if (error) throw new Error(`สร้างห้องไม่สำเร็จ (${error.message})`);
  return data;
}

async function updateFlowlockSharedRoom(roomId, participantIds, payload, expectedUpdatedAt = null) {
  let query = getSupabaseClient()
    .from('flowlock_shared_rooms')
    .update({
      participant_ids: participantIds,
      payload,
      updated_at: new Date().toISOString()
    })
    .eq('id', roomId);
  if (expectedUpdatedAt) query = query.eq('updated_at', expectedUpdatedAt);

  const { data, error } = await query
    .select('id, kind, owner_id, participant_ids, payload, created_at, updated_at')
    .maybeSingle();
  if (error) throw new Error(`บันทึกข้อมูลห้องไม่สำเร็จ (${error.message})`);
  if (!data) throw new Error('บันทึกห้องไม่ได้ (ข้อมูลอาจเปลี่ยนไปหรือไม่มีสิทธิ์)');
  return data;
}

async function loadFlowlockGameTextStatus(roomCode) {
  const { data, error } = await getSupabaseClient().rpc('get_flowlock_game_text_status', {
    room_code: roomCode
  });
  if (error) throw new Error(`โหลดสถานะข้อความไม่สำเร็จ (${error.message})`);
  if (!data) throw new Error('ไม่พบห้อง หรือคุณไม่ได้เป็นผู้เล่นในห้องนี้');
  return data;
}

async function saveFlowlockGameText(roomCode, text) {
  const { data, error } = await getSupabaseClient().rpc('submit_flowlock_game_text', {
    room_code: roomCode,
    entry_text: text
  });
  if (error) throw new Error(`ส่งข้อความไม่สำเร็จ (${error.message})`);
  if (data !== true) throw new Error('ส่งข้อความไม่ได้ ตรวจสอบว่าห้องยังรอผู้เล่นอยู่');
}

async function declineFlowlockGameInvite(roomCode) {
  const { data, error } = await getSupabaseClient().rpc('decline_flowlock_game_invite', {
    room_code: roomCode
  });
  if (error) throw new Error(`ปฏิเสธคำเชิญไม่สำเร็จ (${error.message})`);
  if (data !== true) throw new Error('คำเชิญนี้หมดอายุ หรือคุณเข้าร่วมห้องไปแล้ว');
}

async function loadFlowlockTradeOffer(roomId) {
  const { data, error } = await getSupabaseClient().rpc('get_flowlock_trade_offer', {
    room_id: roomId
  });
  if (error) throw new Error(`โหลดข้อเสนอไม่สำเร็จ (${error.message})`);
  if (!data) throw new Error('ไม่พบห้องนี้ หรือคุณไม่ได้เป็นสมาชิก');
  return data;
}

async function setFlowlockTradeReady(roomId, isReady) {
  const { data, error } = await getSupabaseClient().rpc('set_flowlock_trade_ready', {
    room_id: roomId,
    is_ready: isReady
  });
  if (error) {
    if (error.code === 'PGRST202' || /Could not find the function public\.set_flowlock_trade_ready/i.test(error.message)) {
      throw new Error('ยังไม่ได้ติดตั้งฟังก์ชันเทรดใน Supabase กรุณารัน supabase/setup.sql ในโปรเจกต์ที่เว็บไซต์เชื่อมต่ออยู่');
    }
    throw new Error(`บันทึกความพร้อมไม่สำเร็จ (${error.message})`);
  }
  if (data !== true) throw new Error('ยืนยันความพร้อมไม่ได้ กรุณาตรวจสอบว่าคุณเข้าห้องแล้ว');
}

async function submitFlowlockTradeOffer(roomId, side, offerType, details) {
  const { data, error } = await getSupabaseClient().rpc('submit_flowlock_trade_offer', {
    room_id: roomId,
    trade_side: side,
    offer_type: offerType,
    offer_details: details
  });
  if (error) throw new Error(`บันทึกข้อเสนอไม่สำเร็จ (${error.message})`);
  if (data !== true) throw new Error('บันทึกข้อเสนอไม่ได้ กรุณาตรวจสอบสถานะห้อง');
}

async function confirmFlowlockTradeOffer(roomId) {
  const { data, error } = await getSupabaseClient().rpc('confirm_flowlock_trade_offer', {
    room_id: roomId
  });
  if (error) throw new Error(`ยืนยันข้อเสนอไม่สำเร็จ (${error.message})`);
  if (data !== true) throw new Error('ยังยืนยันข้อเสนอไม่ได้ กรุณาตรวจสอบว่าทั้งสองฝ่ายส่งข้อมูลแล้ว');
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
