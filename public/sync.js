(() => {
  const api = '/api/gradebook';
  const legacyKey = 'english-gradebook/records/v1';
  const empty = () => ({ classes: [] });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); }
    catch { return null; }
  }
  async function request(path = '', options = {}) {
    const response = await fetch(api + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
      ...options
    });
    if (!response.ok && response.status !== 409) throw new Error(String(response.status));
    return { ...(await response.json()), conflict: response.status === 409 };
  }

  function useGradebook(React) {
    const [data, show] = React.useState(null);
    const [status, setStatus] = React.useState('loading');
    const [conflict, setConflict] = React.useState(false);
    const state = React.useRef({
      active: false, busy: false, ready: false, draft: null, remote: null,
      revision: 0, account: null, data: null, key: '', timer: null, cached: true
    }).current;

    function schedule(delay = 650) {
      clearTimeout(state.timer);
      state.timer = setTimeout(synchronize, delay);
    }
    function persistDraft(data, revision = state.revision) {
      state.draft = { revision, data, id: crypto.randomUUID() };
      try {
        localStorage.setItem(state.key, JSON.stringify(state.draft));
        state.cached = true;
      } catch { state.cached = false; }
    }
    function discardDraft() {
      try {
        if (read(state.key)?.id === state.draft?.id) localStorage.removeItem(state.key);
      } catch {}
      state.draft = null;
    }
    function publishLocal(data) {
      state.data = data;
      show(data);
    }
    function accept(remote) {
      state.revision = remote.revision;
      state.remote = null;
      setConflict(false);
      setStatus('saved');
      publishLocal(remote.data || empty());
    }
    function completeMigration() {
      try { localStorage.setItem(state.key + '/migrated', '1'); } catch {}
    }
    function handleDivergence(remote) {
      state.remote = remote;
      setConflict(true);
      setStatus('error');
    }
    async function synchronize() {
      if (!state.active || state.busy || state.remote) return;
      state.busy = true;
      let needsPush = false;
      try {
        if (!state.ready) {
          const remote = await request();
          if (!state.active) return;
          if (!remote.account || !Number.isInteger(remote.revision)) throw new Error('invalid response');
          state.account = remote.account;
          state.key = 'english-gradebook/cloud/' + encodeURIComponent(remote.account);
          state.ready = true;
          state.revision = remote.revision;
          const pending = read(state.key);
          const migrated = read(state.key + '/migrated');
          const legacy = migrated ? null : read(legacyKey);
          const hasLegacy = Array.isArray(legacy?.classes) && (
            legacy.classes.length || legacy.archives?.length || Object.keys(legacy).some(key => key !== 'classes')
          );
          if (Array.isArray(pending?.data?.classes)) state.draft = pending;
          else if (hasLegacy && !same(legacy, remote.data)) persistDraft(legacy, 0);
          if (state.draft && same(state.draft.data, remote.data)) discardDraft();
          if (!state.draft) {
            completeMigration();
            accept(remote);
          } else {
            publishLocal(state.draft.data);
            if (state.draft.revision === remote.revision) needsPush = true;
            else handleDivergence(remote);
          }
        } else if (state.draft) {
          const sent = state.draft;
          const result = await request('', {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ revision: sent.revision, account: state.account, data: sent.data })
          });
          if (!state.active) return;
          if (result.conflict && !same(result.data, sent.data)) {
            handleDivergence(result);
            return;
          }
          state.revision = result.revision;
          completeMigration();
          if (state.draft === sent) {
            discardDraft();
            setStatus('saved');
          } else {
            persistDraft(state.draft.data);
            needsPush = true;
          }
        } else {
          const remote = await request();
          if (!state.active) return;
          if (remote.account !== state.account) throw new Error('account changed');
          if (state.draft) {
            if (remote.revision !== state.draft.revision) handleDivergence(remote);
            else needsPush = true;
          } else if (state.revision !== remote.revision) accept(remote);
          else setStatus('saved');
        }
        if (needsPush) setStatus('pending');
      } catch {
        if (state.active) setStatus('error');
      } finally {
        state.busy = false;
        if (state.active && needsPush) schedule(0);
      }
    }
    function setData(update) {
      if (!state.ready || !state.data) return;
      const next = typeof update === 'function' ? update(state.data) : update;
      if (next === state.data || same(state.data, next)) return;
      persistDraft(next, state.draft?.revision ?? state.revision);
      publishLocal(next);
      if (!state.remote) {
        setStatus('pending');
        schedule();
      }
    }
    function resolveConflict(useCloud) {
      const remote = state.remote;
      if (!remote) return;
      const question = useCloud
        ? 'تعتمد النسخة المحفوظة بالحساب وتستبعد التعديلات المحلية؟ تگدر تنزّل نسخة Excel منها أولاً.'
        : 'تعتمد نسخة هذا الجهاز؟ النسخة الحالية بالحساب تبقى متاحة ضمن سجل النسخ السابقة.';
      if (!window.confirm(question)) return;
      if (useCloud) {
        discardDraft();
        completeMigration();
        accept(remote);
        schedule(0);
      } else {
        state.revision = remote.revision;
        state.remote = null;
        setConflict(false);
        persistDraft(state.data);
        setStatus('pending');
        schedule(0);
      }
    }
    async function restore(revision) {
      if (state.draft || state.remote) throw new Error('pending draft');
      if (!window.confirm('ترجع إلى هذه النسخة؟ النسخة الحالية تبقى ضمن سجل النسخ السابقة.')) return false;
      const base = state.revision;
      const restored = await request('/history/' + revision);
      if (state.draft || state.remote || state.revision !== base) throw new Error('newer changes');
      setData(restored.data);
      return true;
    }
    React.useEffect(() => {
      state.active = true;
      synchronize();
      const check = () => { if (document.visibilityState === 'visible') synchronize(); };
      const timer = setInterval(check, 10000);
      const warn = event => {
        if (state.draft) { event.preventDefault(); event.returnValue = ''; }
      };
      document.addEventListener('visibilitychange', check);
      window.addEventListener('focus', check);
      window.addEventListener('online', check);
      window.addEventListener('beforeunload', warn);
      return () => {
        state.active = false;
        clearTimeout(state.timer);
        clearInterval(timer);
        document.removeEventListener('visibilitychange', check);
        window.removeEventListener('focus', check);
        window.removeEventListener('online', check);
        window.removeEventListener('beforeunload', warn);
      };
    }, []);
    return {
      data, setData, status, conflict, resolveConflict, restore,
      mode: data ? 'file' : status === 'loading' ? 'loading' : 'blocked',
      publicView: false, retry: synchronize,
      draftCached: state.cached
    };
  }

  function Panel({ React, sync, download }) {
    const h = React.createElement;
    const [versions, setVersions] = React.useState([]);
    const [open, setOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const label = sync.conflict ? 'موجودة نسختان مختلفتان من السجل. راجع النسختين قبل تحديد أي نسخة تعتمد.'
      : sync.status === 'saved' ? 'السجل متزامن مع حسابك. تقدر تفتحه من جهاز آخر بنفس الحساب.'
      : sync.status === 'pending' ? 'جارٍ رفع التعديلات الخاصة إلى حسابك…'
      : sync.draftCached ? 'المزامنة متوقفة مؤقتاً. التعديلات المعلّقة محفوظة في هذا المتصفح.'
      : 'تعذّر حفظ التعديلات. أبقِ الصفحة مفتوحة ونزّل نسخة Excel احتياطية.';
    async function load() {
      setBusy(true);
      setMessage('');
      try { setVersions((await request('/history')).versions); }
      catch { setMessage('تعذّر فتح سجل النسخ. جرّب تحديث القائمة.'); }
      finally { setBusy(false); }
    }
    async function restore(revision) {
      setBusy(true);
      setMessage('');
      try {
        if (await sync.restore(revision)) setOpen(false);
      } catch { setMessage('تعذّرت الاستعادة. تأكد من انتهاء المزامنة وحاول مجدداً.'); }
      finally { setBusy(false); }
    }
    return h('section', {className:'cloud-panel', 'aria-label':'المزامنة والنسخ السابقة'},
      h('p', {role:'status'}, label),
      sync.conflict ? h('div', {className:'cloud-actions'},
        h('button', {type:'button', onClick:download}, 'تنزيل نسخة هذا الجهاز Excel'),
        h('button', {type:'button', onClick:() => sync.resolveConflict(true)}, 'اعتماد نسخة الحساب'),
        h('button', {type:'button', onClick:() => sync.resolveConflict(false)}, 'اعتماد نسخة هذا الجهاز')
      ) : null,
      h('button', {type:'button', 'aria-expanded':open, onClick:() => {
        setOpen(!open);
        if (!open) load();
      }}, open ? 'إخفاء النسخ السابقة' : 'عرض النسخ السابقة'),
      open ? h('div', null,
        h('p', null, 'الحفظ التلقائي يحتفظ بآخر ٣٠ نسخة وبآخر نسخة من كل يوم خلال آخر ٣٠ يوماً.'),
        h('button', {type:'button', disabled:busy, onClick:load}, 'تحديث القائمة'),
        message ? h('p', {role:'alert'}, message) : null,
        busy ? h('p', {role:'status'}, 'جارٍ التحميل…') : null,
        !busy && !message && !versions.length ? h('p', null, 'ماكو نسخ محفوظة بعد.') : null,
        h('ul', {className:'cloud-history'}, versions.map((version, index) => h('li', {key:version.revision},
          h('span', null, 'نسخة ' + new Intl.NumberFormat('ar-IQ').format(version.revision) + ' · ' + new Intl.DateTimeFormat('ar-IQ', {
            dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Baghdad'
          }).format(new Date(version.savedAt))),
          index === 0 ? h('strong', null, 'أحدث نسخة بالحساب') : h('button', {
            type:'button', disabled:busy || sync.conflict || sync.status !== 'saved',
            onClick:() => restore(version.revision)
          }, 'استعادة هذه النسخة')
        )))
      ) : null
    );
  }
  window.gradebookCloud = { useGradebook, Panel };
})();
