/* Claude artifact only: keep each person's picks in their own Claude account, so they follow them across devices.
   Uses the artifact's db and user capabilities (window.claude). Without them the page simply keeps picks in the
   browser. scripts/build.mjs adds this file to the single-file artifact build, never to the website. */
(() => {
  const FP = window.FP;
  const EVT = window.FP_EVENT;
  const c = window.claude;
  if (!FP || !c || typeof c.use !== 'function') return;

  const TEXT = {
    syncing: '同步到你的 Claude 帳號中…',
    synced: '團序已同步到你的 Claude 帳號，換手機或電腦登入打開都還在。',
    error: '暫時連不上，團序先存在這台裝置，下次修改時會再同步。',
  };
  const cloud = { ref: null, writing: false, dirty: false, timer: null };
  const set = (s) => FP.setSync(s, TEXT[s]);

  async function flush() {
    if (!cloud.ref) return;
    if (cloud.writing) { cloud.dirty = true; return; }
    cloud.writing = true;
    set('syncing');
    try {
      await cloud.ref.set({ v: 1, ...FP.snapshot() });
      set('synced');
    } catch (e) {
      const code = e && e.code;
      if (['invalid_argument', 'revoked', 'not_granted', 'capability_disabled', 'capability_removed'].includes(code)) {
        cloud.ref = null;
        FP.setSync('local');
      } else {
        console.warn('[fp] sync failed, will retry on the next change', e);
        set('error');
      }
    }
    cloud.writing = false;
    if (cloud.dirty) { cloud.dirty = false; flush(); }
  }

  FP.onCommit(() => {
    if (!cloud.ref) return;
    clearTimeout(cloud.timer);
    cloud.timer = setTimeout(flush, 700);
  });

  (async () => {
    let db = null;
    let user = null;
    try { [db, user] = await Promise.all([c.use('db'), c.use('user')]); } catch (e) { return; }
    if (!db || !user) return;
    let uid = null;
    try { uid = await user.id(); } catch (e) { uid = null; }
    if (!uid) return;
    let ref;
    try { ref = db.doc(`data/users/${uid}/${EVT.slug}`); } catch (e) { return; }
    let body = null;
    try {
      const snap = await ref.get();
      body = snap.exists ? snap.data() : null;
    } catch (e) {
      console.warn('[fp] could not read picks from the account, keeping this device\'s copy', e);
      return;
    }
    cloud.ref = ref;
    const mine = FP.snapshot();
    const ct = body && typeof body.t === 'number' ? body.t : -1;
    if (body && Array.isArray(body.picks) && ct > mine.t) {
      FP.adopt(body.picks, ct, body.prefs);
      set('synced');
    } else if (mine.picks.length && ct < mine.t) {
      await flush();
    } else {
      set('synced');
    }
    if (!cloud.ref) return;
    ref.onSnapshot((snap) => {
      if (!snap.exists || snap.metadata.hasPendingWrites) return;
      const b = snap.data();
      if (b && Array.isArray(b.picks) && typeof b.t === 'number' && b.t > FP.snapshot().t) FP.adopt(b.picks, b.t, b.prefs);
    }, () => { set('error'); });
  })();
})();
