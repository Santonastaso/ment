import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures.mjs';

// Reuse the existing auth/app fixture, but run the real history API branches
// against an isolated PostgREST-shaped store. No shared fixture changes.
const source = readFileSync(new URL('../../client/src/api/index.js', import.meta.url), 'utf8');
const getHistory = source.slice(source.indexOf("  if (url === '/discovery/threads'"), source.indexOf("  if (url === '/users/me')"));
const delStart = source.indexOf('async function del(');
const deleteHistory = source.slice(source.indexOf('  if (', delStart), source.indexOf("  if (/^\\/users\\/me\\/skills", delStart));

async function historyFixture(page, { failInitial = false } = {}) {
  await page.route('**/src/api/index.js*', async route => {
    if (new URL(route.request().url()).searchParams.has('history-base')) return route.fallback();
    await route.fulfill({ contentType: 'text/javascript', body: `
      import base from '/src/api/index.js?history-base';
      import { ApiError } from '/src/lib/apiError.mjs';
      const state = window.fixture;
      const stamp = '2026-10-01T10:00:00.123456+00:00';
      state.history = Array.from({length: 33}, (_, i) => ({
        id: '00000000-0000-0000-0000-' + String(100-i).padStart(12, '0'),
        user_id: state.user.id, title: 'Search ' + (i+1), archived: i%2 === 0,
        created_at: stamp, updated_at: stamp, session_id: i === 1 ? 1 : null,
        turns: [{role:'user',content:'Search ' + (i+1)},
          i === 1 ? {role:'assistant',kind:'draft',content:'Saved draft',person:state.peer}
          : {role:'assistant',kind:'clarification',content:'Saved question ' + (i+1)}],
      }));
      state.history.push({...state.history[0], id:'ffffffff-ffff-ffff-ffff-ffffffffffff',user_id:'another-member',title:'Private other member search'});
      state.historyQueries = [];
      state.failHistory = ${failInitial ? 2 : 0};
      const ok = (data, status=200) => ({data,status});
      const supabase = { from(table) {
        if(table !== 'discovery_threads') throw new Error('Unexpected history table ' + table);
        let rows = [...state.history], removing = false;
        const query = {
          select(){return this},
          eq(column,value){rows=rows.filter(row=>row[column]===value);return this},
          order(column,{ascending}){rows.sort((a,b)=>(a[column]<b[column]?-1:a[column]>b[column]?1:0)*(ascending?1:-1));return this},
          or(filter){
            state.historyQueries.push(filter);
            const match = filter.match(/^created_at.lt.(.+),and\\(created_at.eq.(.+),id.lt.([0-9a-f-]+)\\)$/);
            if(!match) throw new Error('Invalid cursor filter '+filter);
            rows=rows.filter(row=>row.created_at<match[1]||(row.created_at===match[2]&&row.id<match[3]));return this;
          },
          async limit(limit){
            state.lastHistoryLimit=limit;
            if(state.failHistory){state.failHistory=Number(state.failHistory)-1;return {error:{message:'offline'}}}
            return {data:rows.slice(0,limit)};
          },
          async single(){
            if(state.failReopen){state.failReopen=false;return {error:{message:'offline'}}}
            return {data:rows[0]};
          },
          delete(){removing=true;return this},
          then(resolve){
            if(state.failDelete){state.failDelete=false;return Promise.resolve({error:{message:'offline'}}).then(resolve)}
            if(removing) state.history=state.history.filter(row=>!rows.includes(row));
            return Promise.resolve({data:null}).then(resolve);
          },
        };
        return query;
      }};
      async function get(url) { const viewer=state.user; ${getHistory} }
      async function del(url) { const viewer=state.user; ${deleteHistory} }
      export default {...base,
        get: url => url.startsWith('/discovery/threads') ? get(url) : base.get(url),
        delete: url => url.startsWith('/discovery/threads') ? del(url) : base.delete(url),
        put: async (url,body) => {
          if(!url.startsWith('/discovery/threads/')) return base.put(url,body);
          const row=state.history.find(row=>row.id===url.split('/')[3]&&row.user_id===state.user.id);
          if(!row) throw new ApiError('not_found',404);
          Object.assign(row,body,{updated_at:new Date().toISOString()});return ok(row);
        },
      };
    ` });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('.discovery-history summary').click();
}

const rows = page => page.locator('.discovery-history-row');
const more = page => page.getByRole('button', { name: 'Load more searches', exact: true });

test('all history pages include archived/active searches, stay stable after deletion, and preserve sessions', async ({ page }) => {
  await historyFixture(page);
  await expect(rows(page)).toHaveCount(8);
  await expect(rows(page).first()).toContainText('Archived');
  await expect(rows(page).nth(1)).toContainText('Active');
  await page.getByRole('button', { name:'Resume search: Search 2', exact:true }).click();
  await expect(page.getByRole('link', {name:'Open chat',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'New chat',exact:true}).click();
  await page.locator('.discovery-history summary').click();
  await page.getByRole('button', {name:'Delete search: Search 8',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Sent requests and messages will be kept.');
  await page.getByRole('dialog').getByRole('button',{name:'Delete search',exact:true}).click();
  await expect(rows(page)).toHaveCount(7);
  await more(page).click(); await expect(rows(page)).toHaveCount(15);
  await more(page).click(); await expect(rows(page)).toHaveCount(23);
  await more(page).click(); await expect(rows(page)).toHaveCount(31);
  await more(page).click(); await expect(rows(page)).toHaveCount(32);
  await expect(more(page)).toHaveCount(0);
  await expect(page.getByText('Private other member search')).toHaveCount(0);
  await page.evaluate(()=>window.fixture.messages['/sessions/1/messages']=[{id:1,body:'Sent message kept'}]);
  await page.getByRole('button',{name:'Delete search: Search 2',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Delete search',exact:true}).click();
  expect(await page.evaluate(()=>({sessions:window.fixture.sessions.length,messages:window.fixture.messages}))).toEqual({sessions:2,messages:{'/sessions/1/messages':[{id:1,body:'Sent message kept'}]}});
  await page.getByRole('button',{name:'Resume search: Search 33',exact:true}).click();
  await expect(page.getByText('Saved question 33', {exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.fixture.history.find(row=>row.title==='Search 33').archived)).toBe(false);
});

test('history load, pagination, reopen and delete failures are retryable without losing rows', async ({ page }) => {
  await historyFixture(page,{failInitial:true});
  await expect(page.getByRole('alert')).toContainText('We could not load your search history.');
  await page.getByRole('button',{name:'Retry loading history'}).click();
  await expect(rows(page)).toHaveCount(8);
  await page.evaluate(()=>window.fixture.failHistory=true);
  await more(page).click();
  await expect(rows(page)).toHaveCount(8);
  await page.getByRole('button',{name:'Retry loading history'}).click();
  await expect(rows(page)).toHaveCount(16);
  await page.evaluate(()=>window.fixture.failReopen=true);
  await page.getByRole('button',{name:'Resume search: Search 1',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('We could not complete');
  await expect(rows(page)).toHaveCount(16);
  await page.evaluate(()=>window.fixture.failDelete=true);
  await page.getByRole('button',{name:'Delete search: Search 1',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Delete search',exact:true}).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('button',{name:'Delete search',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(rows(page)).toHaveCount(15);
  await page.getByRole('button',{name:'Resume search: Search 3',exact:true}).click();
  await expect(page.getByText('Saved question 3',{exact:true})).toBeVisible();
});

test('history API caps pages and rejects malformed cursors before building filters', async ({ page }) => {
  await historyFixture(page);
  const result=await page.evaluate(async()=>{
    const {default:api}=await import('/src/api/index.js');
    const page=await api.get('/discovery/threads?limit=999');
    let invalid;
    try {await api.get('/discovery/threads?cursor='+encodeURIComponent(JSON.stringify({created_at:'2026-10-01T10:00:00Z),id.gt.0',id:'invalid'})))} catch(error){invalid=error.response.status}
    return {length:page.data.length,next:JSON.parse(page.nextCursor),limit:window.fixture.lastHistoryLimit,invalid};
  });
  expect(result.length).toBe(30);
  expect(result.limit).toBe(31);
  expect(result.next.created_at).toBe('2026-10-01T10:00:00.123456+00:00');
  expect(result.invalid).toBe(400);
});
