import { test as base, expect } from '@playwright/test';

const user = { id: 'viewer', name: 'Viewer Student', email: 'student@example.test', role: 'student', onboarding_complete: true };
const peer = { id: 'peer', name: 'Peer Mentor', department: 'Finance', job_title: 'Financial Analyst', skills: ['Financial modelling'] };

// Only the network boundary is replaced. Router, auth gates, layout and screens are real.
function fixtureApi(state) {
  const payload = session => ({ ...session, isMentor: session.mentor_id === state.user.id, isMentee: session.mentee_id === state.user.id });
  const call = async (method, path, body) => {
    state.calls.push({ method, path, body });
    if (method === 'post' && state.failNext === path) { state.failNext = null; throw new Error('Fixture network failure'); }
    if (method === 'get') {
      if (path === '/sessions') return state.sessions.map(payload);
      if (path === '/groups') return state.groups;
      if (path.startsWith('/discovery/threads')) return [];
      if (path.startsWith('/skills/suggest')) return [];
      if (/^\/(sessions|groups)\/\d+\/messages/.test(path)) {
        const rows = state.messages[path] || [];
        return path.startsWith('/groups') ? rows : { messages: rows, hasMore: false };
      }
    }
    if (method === 'post') {
      if (path.endsWith('/read')) {
        const [, kind, id] = path.split('/');
        delete state.unread[kind === 'groups' ? 'groupMessages' : 'sessionMessages'][id];
        return {};
      }
      if (path.endsWith('/acknowledge')) { state.sessions.find(s => s.id === Number(path.split('/')[2])).mentee_acknowledged_at = new Date().toISOString(); return {}; }
      if (path === '/users/me/onboarding') return { ...state.user, ...body, onboarding_complete: true };
      if (path === '/discovery/matches') {
        if (state.calls.filter(c => c.path === path).length === 1) return { thread_id: 'thread', matches: [], clarification: 'Which finance skill would you like help with?' };
        return { thread_id: 'thread', resolved_request: 'Financial modelling', matches: [{ ...state.peer, expertise: ['Financial modelling'], reasons: ['Teaches financial modelling.'] }] };
      }
      if (path === '/discovery/draft') return { thread_id: 'thread', draft: 'Hi Peer, I would appreciate your advice on financial modelling.' };
      if (path === '/sessions') {
        const row = { ...body, id: 3, status: 'pending', mentor: state.peer, mentee: state.user, mentee_id: state.user.id, request_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() };
        state.sessions.push(row);
        state.messages['/sessions/3/messages'] = [{ id: 1, sender_id: state.user.id, body: body.message, created_at: new Date().toISOString() }];
        return payload(row);
      }
      if (path === '/groups') { const row = { ...body, id: 2, joined: true, is_owner: true, member_count: 1 }; state.groups.push(row); return row; }
      if (/^\/(sessions|groups)\/\d+\/messages$/.test(path)) {
        const send = () => {
          const row = { id: ++state.nextMessageId, sender_id: state.user.id, body: body.body, created_at: new Date().toISOString() };
          state.messages[path] = [...(state.messages[path] || []), row];
          return row;
        };
        return state.delaySends ? new Promise(resolve => state.pending.push(() => resolve(send()))) : send();
      }
    }
    if (method === 'put') {
      if (path.startsWith('/discovery/threads')) return {};
      if (/^\/sessions\/\d+$/.test(path)) {
        const session = state.sessions.find(s => s.id === Number(path.split('/')[2]));
        Object.assign(session, body, body.status === 'completed' ? { status: 'scheduled', viewer_completed: true } : {});
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
        user, peer, calls: [], pending: [], nextMessageId: 10, messages: {},
        unread: { sessions: 0, groups: 1, sessionMessages: {}, groupMessages: { 1: 2 } },
        groups: [{ id: 1, name: 'Test Group', joined: true, member_count: 3 }],
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
          const updateUser = next => {window.fixture.user = next; setUser(next)};
          window.fixture.setUser = updateUser;
          const value = { user, session: {user: {email:user.email}}, loading:false, pendingAcceptanceCount:0, unreadCounts,
            updateUser, logout:async()=>{}, refreshPendingAcceptances:async()=>{},
            refreshUnreadCounts:async()=>setUnread(structuredClone(window.fixture.unread)) };
          return React.createElement(Context.Provider, {value}, children);
        }
        export const useAuth = () => React.useContext(Context);
      ` });
      if (url.pathname === '/src/lib/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: `
        const listeners = [];
        window.fixture.emit = (table, row) => listeners.filter(l => l.filter.table === table).forEach(l => l.callback({new:row}));
        export const supabase = {channel:()=>{
          const own=[]; return {on(event,filter,callback){const l={filter,callback};own.push(l);listeners.push(l);return this},subscribe(){return this},own};
        }, removeChannel:channel=>channel.own.forEach(l=>listeners.splice(listeners.indexOf(l),1)), rpc:async()=>({data:{name:'Peer'}})};
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
