import { test as base, expect } from '@playwright/test';

const user = { id: 'viewer', name: 'Viewer Student', email: 'student@example.test', role: 'student', onboarding_complete: true };
const peer = { id: 'peer', name: 'Peer Mentor', department: 'Finance', job_title: 'Financial Analyst', skills: ['Financial modelling'] };

// Only the network boundary is replaced. Router, auth gates, layout and screens are real.
function fixtureApi(state) {
  const payload = session => {
    const latest = state.messages[`/sessions/${session.id}/messages`]?.at(-1);
    return { ...session, isMentor: session.mentor_id === state.user.id, isMentee: session.mentee_id === state.user.id,
      latest_message: latest?.body || null, latest_message_kind: latest?.kind || null };
  };
  const call = async (method, path, body) => {
    state.calls.push({ method, path, body });
    if (method === 'post' && state.failNext === path) { state.failNext = null; throw new Error('Fixture network failure'); }
    if (method === 'get') {
      if (state.failGet === path) throw new Error('Fixture history load failed');
      if (path === '/users/me') return { ...state.user, skills: [], career: [] };
      if (path === '/users/me/skill-evidence') return [];
      if (path === '/users/me/capacity') return {};
      if (path === '/reflections') return { entries: state.reflections || [] };
      if (path === '/sessions') return state.sessions.map(payload);
      if (path === '/groups') return state.groups.map(group => ({ ...group, latest_message: state.messages[`/groups/${group.id}/messages`]?.at(-1)?.body || null }));
      if (path.startsWith('/directory?')) return { people: [state.peer], total: 1, facets: { languages: ['fr', 'it'] } };
      // A saved conversation and a peer profile, for the view-profile round trip.
      if (path === '/discovery/threads/thread') return { id: 'thread', turns: [
        { role: 'user', content: 'Financial modelling' },
        { role: 'assistant', kind: 'matches', framed: true, content: 'I found someone who could be a great fit.', search_request: 'Financial modelling',
          matches: [{ ...state.peer, expertise: ['Financial modelling'], reasons: ['Teaches financial modelling.'] }] },
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
      if (path === '/users/me/onboarding') return { ...state.user, ...body, onboarding_complete: true };
      if (path === '/discovery/matches') {
        if (state.calls.filter(c => c.path === path).length === 1) return { thread_id: 'thread', matches: [], clarification: 'Which finance skill would you like help with?',
          suggestions: [{ label: 'Financial modelling', message: 'Financial modelling' }] };
        return { thread_id: 'thread', resolved_request: 'Financial modelling', matches: [{ ...state.peer, expertise: ['Financial modelling'], reasons: ['Teaches financial modelling.'] }] };
      }
      if (path === '/discovery/draft') return { thread_id: 'thread', draft: 'Hi Peer, I would appreciate your advice on financial modelling.' };
      if (path === '/sessions') {
        const row = { ...body, id: 3, status: 'pending', mentor: state.peer, mentee: state.user, mentee_id: state.user.id, request_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() };
        state.sessions.push(row);
        state.messages['/sessions/3/messages'] = [{ id: 1, sender_id: state.user.id, kind: 'request', body: body.message, created_at: new Date().toISOString() }];
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
          throw new Error('Fixture response lost after commit');
        }
        return state.delaySends ? new Promise(resolve => state.pending.push(() => resolve(send()))) : send();
      }
    }
    if (method === 'put') {
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
        peer, calls: [], pending: [], nextMessageId: 10, messages: JSON.parse(sessionStorage.getItem('ment.fixture.messages') || '{}'),
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
        export default (${fixtureApi.toString()})(window.fixture);
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
