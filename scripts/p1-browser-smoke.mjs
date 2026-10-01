// Isolated UI regressions: actual components, fixture-only API, no live account or email.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const base = process.env.E2E_BASE || 'http://127.0.0.1:3010';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => localStorage.setItem('ment.lang', 'en'));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  if (url.pathname === '/src/main.jsx') {
    const original = await (await route.fetch()).text();
    const dependency = name => original.match(new RegExp('"([^"\\n]*' + name.replaceAll('.', '\\.') + '[^"\\n]*)"'))[1];
    return route.fulfill({ contentType: 'text/javascript', body: `
    import React from '${dependency('react.js')}';
    import ReactDOM from '${dependency('react-dom_client.js')}';
    import {BrowserRouter} from '${dependency('react-router-dom.js')}';
    import {LanguageProvider} from '/src/i18n/index.jsx';
    import Conversations from '/src/pages/Conversations.jsx';
    import '/src/index.css';
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter, {}, React.createElement(LanguageProvider, {}, React.createElement(Conversations))));
  ` });
  }
  if (url.pathname === '/src/context/AuthContext.jsx') return route.fulfill({ contentType: 'text/javascript', body: `
    export const useAuth = () => ({user:{id:'viewer',name:'Viewer'},unreadCounts:{sessionMessages:{},groupMessages:{}},refreshPendingAcceptances:async()=>{},refreshUnreadCounts:async()=>{}});
  ` });
  if (url.pathname === '/src/lib/supabase.js') return route.fulfill({ contentType: 'text/javascript', body: `
    const channel = {on(){return this},subscribe(){return this}};
    export const supabase = {channel:()=>channel,removeChannel:()=>{},rpc:async()=>({data:{name:'Peer'}})};
  ` });
  if (url.pathname === '/src/api/index.js') return route.fulfill({ contentType: 'text/javascript', body: `
    const sessions = [1,2].map(id=>({id,status:'scheduled',scheduled_at:'2026-01-01T12:00:00Z',title:'Meeting '+id,mentor_id:'peer-'+id,mentee_id:'viewer',isMentee:true,isMentor:false,mentor:{id:'peer-'+id,name:'Peer '+id},mentee:{id:'viewer',name:'Viewer'}}));
    window.fixture={pending:[],saves:[],sessions,messages:{}};
    export const invokeUserFunction=async()=>({data:{providers:[],connections:[]}});
    export default {
      get:async path=>({data:path==='/sessions'?sessions.map(s=>({...s})):path==='/groups'?[{id:1,name:'Test Group',joined:true}]:path.startsWith('/groups/')?(window.fixture.messages[path]||[]):{messages:window.fixture.messages[path]||[],hasMore:false}}),
      post:async(path,body)=>{
        if(path.endsWith('/read')||path.endsWith('/acknowledge'))return {data:{}};
        return new Promise(resolve=>window.fixture.pending.push(()=>{
          const row={id:Date.now(),sender_id:'viewer',body:body.body,created_at:new Date().toISOString()};
          window.fixture.messages[path]=[...(window.fixture.messages[path]||[]),row];resolve({data:row});
        }));
      },
      put:async(path,body)=>{
        window.fixture.saves.push({...body});
        const session=sessions.find(s=>s.id===Number(path.split('/')[2]));
        Object.assign(session,body,body.status==='completed'?{status:'scheduled',viewer_completed:true}:{});
        return {data:{...session}};
      }
    };
  ` });
  await route.continue();
});
try {
  await page.goto(base + '/conversations?session=1');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await composer.fill('Sent from A');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: /Peer 2/ }).click();
  assert.equal(await composer.inputValue(), '');
  await composer.fill('Draft for B');
  await page.evaluate(() => window.fixture.pending.shift()());
  await page.waitForFunction(() => window.fixture.messages['/sessions/1/messages']?.length === 1);
  assert.equal(await composer.inputValue(), 'Draft for B');
  assert.equal(await page.locator('.conversation-messages').getByText('Sent from A', { exact: true }).count(), 0);
  await page.getByRole('button', { name: /Test Group/ }).click();
  await composer.fill('Group message');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByRole('button', { name: /Peer 2/ }).click();
  await page.evaluate(() => window.fixture.pending.shift()());
  assert.equal(await composer.inputValue(), 'Draft for B');
  assert.equal(await page.locator('.conversation-messages').getByText('Group message', { exact: true }).count(), 0);
  console.log('PASS: delayed direct and group sends cannot corrupt another thread');

  await page.getByRole('button', { name: 'Mark as completed' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('Useful conversation');
  await dialog.getByRole('radio').nth(3).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.fixture.saves[0]), { status: 'completed', reflection: 'Useful conversation', mentee_rating: 4 });
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await dialog.getByRole('textbox').inputValue(), 'Useful conversation');
  await dialog.getByRole('textbox').fill('Updated reflection');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.fixture.saves[1]), { reflection: 'Updated reflection', mentee_rating: 4 });
  console.log('PASS: completion, private rating and reflection editing remain reachable');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('PASS: mobile layout and no uncaught browser errors');
} catch (error) {
  console.error('Browser diagnostics:', errors, await page.locator('body').innerText());
  throw error;
} finally { await browser.close(); }
