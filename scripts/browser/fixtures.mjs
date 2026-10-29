import { test as base, expect } from '@playwright/test';

const user = { id: 'viewer', name: 'Viewer Student', email: 'student@example.test', role: 'student', onboarding_complete: true };
const peer = { id: 'peer', name: 'Peer Mentor', department: 'Finance', job_title: 'Financial Analyst', skills: ['Financial modelling'] };

// Only the network boundary is replaced. Router, auth gates, layout and screens are real.
// Failures are thrown as the app's own ApiError, so a test sees what production sees:
//   failNext / failPut / failGet = path   uncertain (500), nothing saved
//   failAfterCommit = path                uncertain (500), but the write went through
//   refuseNext = { path, code }           refused (400), nothing saved
function fixtureApi(state, ApiError) {
  // Aggregated fixture data mirrors the privacy-safe RPC contract: there are
  // no person nodes or person-level edges, and every released cell is >= 5.
  function sampleKnowledgeGraph() {
    const departments = ['Finance', 'Marketing', 'Consulting', 'Operations', 'Strategy', 'Data & Analytics', 'Human Resources', 'Public Policy', 'Luxury & Retail', 'Sustainability'];
    const departmentNodes = departments.map((label, index) => ({ id: `d:${index}`, kind: 'department', label, count: 6 }));
    const skills = ['Financial modelling', 'Valuation', 'Brand strategy', 'SQL', 'Python', 'Negotiation', 'Public speaking', 'Supply chain']
      .map((label, i) => ({ id: `s:${i}`, kind: 'skill', label, teachers: 8, learners: 7 }));
    const edges = [];
    departmentNodes.forEach((department, index) => {
      edges.push({ source: department.id, target: 's:1', type: index % 2 ? 'wants_to_learn' : 'can_teach', count: 6 });
      if (index < skills.length) edges.push({ source: department.id, target: `s:${index}`, type: 'can_teach', count: 6 });
      if (index > 0) edges.push({ source: 'd:0', target: department.id, type: 'session', count: 8 });
    });
    edges.push({ source: 'd:0', target: 'd:1', type: 'connection', count: 6 });
    return { nodes: [...departmentNodes, ...skills], edges, meta: { organizations: [{ id: 'org', name: 'ESSEC' }], languages: ['en', 'fr'] } };
  }

  const dropped = () => new ApiError('TypeError: Failed to fetch', 500);
  const payload = session => {
    const latest = state.messages[`/sessions/${session.id}/messages`]?.at(-1);
    return { ...session, isMentor: session.mentor_id === state.user.id, isMentee: session.mentee_id === state.user.id,
      latest_message: latest?.body || null, latest_message_kind: latest?.kind || null };
  };
  const call = async (method, path, body) => {
    state.calls.push({ method, path, body });
    if (method === 'get' && state.holdLoads?.some(held => held.endsWith('*') ? path.startsWith(held.slice(0, -1)) : path === held)) {
      state.heldLoadStartedAt.push(Date.now());
      await new Promise(resolve => state.pendingLoads.push(resolve));
    }
    if (state.refuseNext?.path === path) { const { code } = state.refuseNext; state.refuseNext = null; throw new ApiError(code, 400); }
    if (method === 'post' && state.failNext === path) { state.failNext = null; throw dropped(); }
    if (method === 'put' && state.failPut === path) { state.failPut = null; throw dropped(); }
    if (method === 'get') {
      if (state.failGet === path) throw dropped();
      if (path === '/users/me') return state.profile || { ...state.user, skills: [], career: [] };
      if (path === '/users/me/skill-evidence') return [];
      if (path === '/users/me/capacity') return state.capacity || {};
      if (path === '/users/me/export') return { format: 'ment-export-1', profile: state.user, consents: state.consents || [] };
      if (path === '/reflections') return { entries: state.reflections || [], dueForCheckIn: !!state.reflectionDue, lastEntryDays: state.reflectionDue ? 4 : null };
      if (path === '/sessions') return state.sessions.map(payload);
      if (path === '/groups') return state.groups.map(group => ({ ...group, latest_message: state.messages[`/groups/${group.id}/messages`]?.at(-1)?.body || null }));
      if (path.startsWith('/directory?')) {
        // With a crowd configured, the fixture pages like the real directory.
        if (!state.directoryCrowd) return { people: [state.peer], total: state.directoryTotal ?? 1, facets: { languages: ['fr', 'it'] } };
        const query = new URLSearchParams(path.split('?')[1]);
        const limit = Math.min(Number(query.get('limit')), state.directoryCap ?? 100);
        const offset = Number(query.get('offset'));
        const people = Array.from({ length: state.directoryCrowd }, (_, index) => ({ ...state.peer, id: `crowd-${index + 1}`, name: `Person ${String(index + 1).padStart(3, '0')}` }));
        return { people: people.slice(offset, offset + limit), total: people.length, ...(state.directoryCap ? {} : { limit }), facets: { languages: ['fr', 'it'] } };
      }
      // A saved conversation and a peer profile, for the view-profile round trip.
      // threadDraft adds an invite drafted for the peer; threadSession is the request the search produced, if any.
      if (path === '/discovery/threads/thread') return { id: 'thread', session_id: state.threadSession ?? null, turns: [
        { role: 'user', content: 'Financial modelling' },
        { role: 'assistant', kind: 'matches', framed: true, content: 'I found someone who could be a great fit.', search_request: 'Financial modelling',
          matches: [{ ...state.peer, expertise: ['Financial modelling'], reasons: ['Teaches financial modelling.'] }] },
        ...(state.threadDraft ? [{ role: 'assistant', kind: 'draft', content: 'Hi Peer, a drafted invite.', search_request: 'Financial modelling',
          person: { ...state.peer, expertise: ['Financial modelling'], reasons: [] } }] : []),
      ] };
      if (path === `/users/${state.peer.id}`) return { ...state.peer, skills: [], career: [] };
      if (path.startsWith('/discovery/threads')) return [];
      if (path.startsWith('/skills/suggest')) return [];
      if (/^\/(sessions|groups)\/\d+\/messages/.test(path)) {
        const [messagePath] = path.split('?');
        const rows = state.messages[messagePath] || [];
        return { messages: rows, hasMore: false };
      }
    }
    if (method === 'post') {
      if (path === '/users/me/delete') { state.erased = true; return { erased: true }; }
      if (path === '/users/me/consents') {
        const row = { purpose: body.purpose, text_version: 'fixture', accepted_at: new Date().toISOString() };
        state.consents = [...(state.consents || []), row];
        return row;
      }
      if (path === '/reflections') {
        const entry = { ...body, id: 1, created_at: new Date().toISOString(), extracted_gaps: [], extracted_strengths: [] };
        state.reflections = [entry];
        return entry;
      }
      if (path.endsWith('/read')) {
        const [, kind, id] = path.split('/');
        delete state.unread[kind === 'groups' ? 'groupMessages' : 'sessionMessages'][id];
        return {};
      }
      if (path.endsWith('/acknowledge')) { state.sessions.find(s => s.id === Number(path.split('/')[2])).mentee_acknowledged_at = new Date().toISOString(); return {}; }
      if (path === '/profile/ingest') {
        if (state.requireFreshAuth && !state.authReady) throw new Error('auth_required');
        return { draft_id: 1, classifier_source: 'test', proposed: state.ingestProposed || {
        job_title: 'Analyst', department: 'Engineering', bio: 'Built useful systems.', career_history: [], can_teach: [], wants_to_learn: [],
        } };
      }
      if (path === '/profile/ingest/1/accept') return { ok: true };
      if (path === '/users/me/skills/batch') {
        // skillSave = { delay, fail }: a slow save, and one that ends in a dropped connection.
        if (state.skillSave?.delay) await new Promise(resolve => setTimeout(resolve, state.skillSave.delay));
        if (state.skillSave?.fail) throw dropped();
        const current = state.profile || { ...state.user, skills: [], career: [] };
        state.profile = { ...current, skills: [...(current.skills || []).filter(skill => skill.type !== body.type),
          ...body.skills.map((skill, index) => ({ id: skill.id || 100 + index, skill: skill.skill, type: body.type, example_project: skill.example_project || '' }))] };
        return null;
      }
      if (path === '/users/me/onboarding') {
        state.profile = { ...state.user, ...body, skills: [
          ...(body.can_teach || []).map(skill => ({ ...skill, type: 'can_teach' })),
          ...(body.wants_to_learn || []).map(skill => ({ skill, type: 'wants_to_learn' })),
        ], career: body.career || [], onboarding_complete: true };
        return { ...state.profile };
      }
      if (path === '/discovery/matches') {
        if (state.calls.filter(c => c.path === path).length === 1) return { thread_id: 'thread', matches: [], clarification: 'Which finance skill would you like help with?',
          suggestions: [{ label: 'Financial modelling', message: 'Financial modelling' }] };
        return { thread_id: 'thread', resolved_request: 'Financial modelling', matches: [{ ...state.peer, expertise: ['Financial modelling'], reasons: ['Teaches financial modelling.'] }] };
      }
      if (path === '/discovery/draft') return { thread_id: 'thread', draft: 'Hi Peer, I would appreciate your advice on financial modelling.' };
      if (path === '/sessions') {
        // As the database does: the same identifier returns the request it
        // already made, and refuses to stand for different content.
        const same = (a, b) => ['mentor_id', 'title', 'message', 'pre_session_question', 'follow_up_intent'].every(key => a[key] === b[key]);
        let row = state.sessions.find(session => session.idempotency_key && session.idempotency_key === body.idempotency_key);
        if (row && !same(row, body)) throw new ApiError('idempotency_conflict', 400);
        // A search carries one request: another one sent with the same search is refused.
        if (body.thread_id && state.threadSession != null && state.threadSession !== row?.id) throw new ApiError('thread_already_linked', 400);
        if (!row) {
          const id = Math.max(2, ...state.sessions.map(session => session.id)) + 1;
          row = { ...body, outbound_message: body.message, id, status: 'pending', mentor: state.peer, mentee: state.user, mentee_id: state.user.id, request_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() };
          state.sessions.push(row);
          state.messages[`/sessions/${id}/messages`] = [{ id: 1, sender_id: state.user.id, kind: 'request', body: body.message, created_at: new Date().toISOString() }];
        }
        // As the server does: the search is linked in the same step that makes the request.
        if (body.thread_id) state.threadSession = row.id;
        if (state.failAfterCommit === path) { state.failAfterCommit = null; throw dropped(); }
        return payload(row);
      }
      if (path === '/groups') { const row = { ...body, id: 2, joined: true, is_owner: true, member_count: 1 }; state.groups.push(row); state.groupMembers[row.id] = [{ user_id: state.user.id, role: 'owner' }]; return row; }
      if (/^\/(sessions|groups)\/\d+\/messages$/.test(path)) {
        const send = () => {
          const existing = body.client_id && (state.messages[path] || []).find(row => row.client_id === body.client_id);
          if (existing) return existing;
          const row = { id: ++state.nextMessageId, sender_id: state.user.id, body: body.body, client_id: body.client_id, created_at: new Date().toISOString() };
          state.messages[path] = [...(state.messages[path] || []), row];
          sessionStorage.setItem('ment.fixture.messages', JSON.stringify(state.messages));
          return row;
        };
        if (state.failAfterCommit === path) {
          state.failAfterCommit = null;
          send();
          throw dropped();
        }
        return state.delaySends ? new Promise(resolve => state.pending.push(() => resolve(send()))) : send();
      }
    }
    if (method === 'put') {
      if (path === '/admin/retention') { state.retention = { ...body }; return state.retention; }
      if (path.startsWith('/admin/users/')) { state.adminUserUpdates = [...(state.adminUserUpdates || []), { id: path.split('/')[3], ...body }]; return { ok: true }; }
      if (path === '/users/me') {
        state.user = { ...state.user, ...body };
        if (state.profile) state.profile = { ...state.profile, ...body };
        return { ...state.user };
      }
      if (path.startsWith('/discovery/threads')) return {};
      if (/^\/sessions\/\d+$/.test(path)) {
        const session = state.sessions.find(s => s.id === Number(path.split('/')[2]));
        Object.assign(session, body, body.status === 'completed' ? { status: 'scheduled', viewer_completed: true } : {});
        if (body.status === 'cancelled' || body.status === 'declined') {
          const messagePath = `${path}/messages`;
          state.messages[messagePath] = [...(state.messages[messagePath] || []), {
            id: ++state.nextMessageId, sender_id: state.user.id, kind: 'system',
            body: body.status === 'cancelled' ? 'Request withdrawn.' : 'Request declined.', created_at: new Date().toISOString(),
          }];
        }
        return payload(session);
      }
    }
    // A small organisation for the admin screens, read only.
    if (method === 'get' && path.startsWith('/admin/')) {
      const [route] = path.split('?');
      const admin = {
        '/admin/stats': { totalUsers: 4, totalEmployees: 4, onboarded: 3, onboardedOf: 4, onboardingComplete: 3, onboardingRate: 75,
          totalMatches: 5, sessionsRequested: 6, matchPairs: [],
          departmentParticipation: [{ department: 'Finance', members: 8, active_members: null, mentors_active: null }],
          deptActivity: [{ department: 'Finance', session_count: null }],
          sessionsByStatus: [{ status: 'pending', cnt: null }, { status: 'scheduled', cnt: null }, { status: 'completed', cnt: null }] },
        '/admin/users': { users: [
          { id: 'peer', name: 'Peer Mentor', email: 'peer@example.test', role: 'alumnus', department: 'Finance', sessions: 3 },
          { id: 'viewer', name: 'Viewer Student', email: 'student@example.test', role: 'student', department: 'Finance', sessions: 2 },
          { id: 'left', name: 'Former Member', email: 'left@example.test', role: 'student', department: 'Marketing', sessions: 0, deactivated_at: '2026-09-01T00:00:00Z' },
        ], total: 3 },
        '/admin/audit': { entries: [{ id: 1, action: 'profile.update', actor: 'Peer Mentor', target_type: 'profile', target_id: 'peer', created_at: '2026-10-01T09:00:00Z', metadata: {} }], total: 1 },
        '/admin/feedback': [{ id: 1, category: 'bug', status: 'open', message: 'The calendar invite opened twice.', user: { name: 'Viewer Student' }, created_at: '2026-10-02T10:00:00Z', delivery: 'sent' }],
        '/admin/request-settings': { weekly: 3, pending: 2, cooldown: 7 },
        '/admin/retention': state.retention || { conversation_days: null, search_days: null, reflection_days: null, audit_log_days: null, deactivated_account_days: null },
        '/admin/privacy-status': { peerVisibleFields: ['name', 'department', 'skills'], hiddenFields: ['email'], minTeamDashboardSize: 5 },
        '/admin/kpis': null,
        '/admin/ai-runs': [],
        '/admin/knowledge-graph': sampleKnowledgeGraph(),
        '/admin/programme': {
          headline: { students: 180, students_new: 12, alumni_available: 64, alumni_new: null, meetings: 52, meetings_new: 9, acceptance_rate: 33, requests: 52 },
          funnel: [{ step: 'invited', count: 320 }, { step: 'joined', count: 289 }, { step: 'profile', count: 236 }, { step: 'talking', count: 70 }, { step: 'met', count: 41 }],
          recruit: [{ skill: 'Python', wanted: 18, offered: null }, { skill: 'Venture capital', wanted: 11, offered: 6 }],
        },
        '/admin/fields-of-study': {
          students: 180, alumni: 109,
          fields: [{ field: 'Finance', members: 12, active: true }, { field: 'Marketing', members: 6, active: false }, { field: null, members: 7, active: true }],
          skills: [
            { skill: 'Valuation', offered: ['Finance'], wanted: ['Marketing', null], sessions: ['Finance'] },
            { skill: 'Brand strategy', offered: ['Marketing'], wanted: [], sessions: [] },
          ],
        },
        '/admin/owner-stats': { organizations: [
          { organizationId: '10000000-0000-0000-0000-000000000001', organizationName: 'ESSEC' },
          { organizationId: '10000000-0000-0000-0000-000000000002', organizationName: 'Test School' },
        ] },
      };
      if (route in admin) return admin[route];
    }
    throw new Error(`Unmocked API: ${method} ${path}`);
  };
  return Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (path, body) => ({ data: structuredClone(await call(method, path, body)) })]));
}

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ user, peer }) => {
      localStorage.setItem('ment.lang', 'en');
      window.fixture = {
        user: JSON.parse(sessionStorage.getItem('ment.fixture.auth') || 'null') || user,
        persistAuth: sessionStorage.getItem('ment.fixture.persistAuth') === '1',
        peer, calls: [], pending: [], pendingLoads: [], holdLoads: [], heldLoadStartedAt: [], nextMessageId: 10, profile: null, messages: JSON.parse(sessionStorage.getItem('ment.fixture.messages') || '{}'),
        unread: { sessions: 0, groups: 1, sessionMessages: {}, groupMessages: { 1: 2 } },
        groups: [{ id: 1, name: 'Test Group', description: 'A group for testing', joined: true, is_owner: true, member_count: 3 }],
        groupMembers: { 1: [
          { user_id: user.id, role: 'owner' },
          { user_id: peer.id, role: 'member' },
          { user_id: 'another-peer', role: 'member' },
        ] },
        groupProfiles: { [peer.id]: peer, 'another-peer': { id: 'another-peer', name: 'Another Member' } },
        sessions: [1, 2].map(id => ({ id, status: 'scheduled', scheduled_at: '2026-01-01T12:00:00Z', title: `Meeting ${id}`, mentor_id: `peer-${id}`, mentee_id: user.id, mentor: { id: `peer-${id}`, name: `Peer ${id}` }, mentee: user })),
      };
    }, { user, peer });
    let reactImport;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
      // The public skills taxonomy: one known suggestion, so choosing it can be tested.
      if (url.origin === 'https://ec.europa.eu') {
        const results = (url.searchParams.get('text') || '').startsWith('lead') ? [{ title: 'leadership', uri: 'esco:leadership', preferredLabel: { en: 'leadership' } }] : [];
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ _embedded: { results } }) });
      }
      if (url.origin !== baseURL) { externalRequests.push(url.origin); return route.abort(); }
      if (url.pathname === '/src/main.jsx') {
        const response = await route.fetch();
        const source = await response.text();
        reactImport = source.match(/from\s+"([^"]*\/react\.js[^"\n]*)"/)[1];
        return route.fulfill({ response, body: source });
      }
      if (url.pathname === '/src/context/AuthContext.jsx') return route.fulfill({ contentType: 'text/javascript', body: `
        import React from '${reactImport}';
        const Context = React.createContext(null);
        export function AuthProvider({children}) {
          const [user, setUser] = React.useState(window.fixture.user);
          const [unreadCounts, setUnread] = React.useState(window.fixture.unread);
          const updateUser = next => {
            window.fixture.user = next;
            if (window.fixture.persistAuth) sessionStorage.setItem('ment.fixture.auth', JSON.stringify(next));
            setUser(next);
          };
          window.fixture.setUser = updateUser;
          const value = { user, session: user ? {user: {email:user.email}} : null, loading:false, pendingAcceptanceCount:0, unreadCounts,
            updateUser, logout:async()=>updateUser(null), signOut:async()=>updateUser(null),
            refreshProfile:async()=>{if(window.fixture.requireFreshAuth&&!window.fixture.authReady)throw new Error('stale_session')},
            signIn:async(email,password)=>{
              const invited = window.fixture.invitedUser;
              if (!invited || email !== invited.email || password !== window.fixture.tempPassword) throw new Error('Invalid credentials');
              window.fixture.authReady=true;
              updateUser(invited);
            },
            refreshUnreadCounts:async()=>setUnread(structuredClone(window.fixture.unread)) };
          return React.createElement(Context.Provider, {value}, children);
        }
        export const useAuth = () => React.useContext(Context);
      ` });
      if (url.pathname === '/src/lib/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: `
        const listeners = [];
        window.fixture.emit = (table, row) => listeners.filter(l => l.filter.table === table).forEach(l => l.callback({new:row}));
        export const supabase = {functions:{invoke:async(name,{body})=>{
          if(name==='admin-create-user') {
            if(body.action==='capabilities') {
              if(window.fixture.adminCapabilitiesUnavailable) return {
                data:null,error:{context:{json:async()=>({error:'storage_path_required'})}},
              };
              return {data:{create_org_admin:true},error:null};
            }
            window.fixture.adminProvisionCalls=[...(window.fixture.adminProvisionCalls||[]),body];
            return {data:{email:body.email,created:true,temp_password:'temporary-test-password',scope:body.action==='create_org_admin'?'org':'none'},error:null};
          }
          if(name!=='complete-password-change') throw new Error('Unexpected function: '+name);
          window.fixture.changedPassword=body.password;
          window.fixture.authReady=false;
          return {data:{ok:true},error:null};
        }},auth:{
          signInWithPassword:async({email,password})=>{
            if(window.fixture.failReauth||email!==window.fixture.invitedUser?.email||password!==window.fixture.changedPassword)return {error:new Error('Invalid credentials')};
            window.fixture.authReady=true;
            window.fixture.reauthenticated=true;
            window.fixture.setUser({...window.fixture.user,must_change_password:false});
            return {error:null};
          },
          resetPasswordForEmail:async(email,options)=>{window.fixture.resetRequest={email,options};return {error:null}},
          setSession:async()=>{window.fixture.setUser({...window.fixture.user,id:'viewer',email:'student@example.test'});return {error:null}},
          updateUser:async()=>({error:null}),
        },channel:()=>{
          const own=[]; return {on(event,filter,callback){const l={filter,callback};own.push(l);listeners.push(l);return this},subscribe(){return this},own};
        }, removeChannel:channel=>channel.own.forEach(l=>listeners.splice(listeners.indexOf(l),1)),
        from:table=>({select:()=>({eq:async(_column,id)=>({data:table==='group_members'?(window.fixture.groupMembers[id]||[]):[],error:null})})}),
        rpc:async(name,args)=>{
          const state=window.fixture;
          if(name==='group_member_directory') {
            const members=state.groupMembers[args.p_group_id]||[];
            const query=args.p_query?.toLowerCase();
            return {data:{
              members:members.map(m=>({id:m.user_id,name:m.user_id===state.user.id?state.user.name:state.groupProfiles[m.user_id]?.name||'Member',is_owner:m.role==='owner'})),
              candidates:query?.length>=2?Object.values(state.groupProfiles).filter(p=>p.name.toLowerCase().includes(query)&&!members.some(m=>m.user_id===p.id)).map(p=>({id:p.id,name:p.name})):[],
            },error:null};
          }
          if(name==='manage_group_member') {
            const members=state.groupMembers[args.p_group_id];
            state.groupMembers[args.p_group_id]=args.p_add?[...members,{user_id:args.p_user_id,role:'member'}]:members.filter(m=>m.user_id!==args.p_user_id);
            return {data:null,error:null};
          }
          return {data:name==='peer_profile'?state.groupProfiles[args.p_user_id]:{name:'Peer'},error:null};
        }};
      ` });
      if (url.pathname === '/src/api/index.js') return route.fulfill({ contentType: 'text/javascript', body: `
        import { ApiError } from '/src/lib/apiError.mjs';
        export default (${fixtureApi.toString()})(window.fixture, ApiError);
        export const invokeUserFunction=async()=>({data:{providers:[],connections:[]}});
      ` });
      await route.continue();
    });
    await use(page);
    expect(externalRequests, 'No test may reach a live service').toEqual([]);
    expect(errors, 'No uncaught browser errors').toEqual([]);
  },
});
export { expect };
