// Browser end-to-end test: drives the real helper page and real phones in
// Chrome, decodes the QR codes the helper page draws, and shows them to a
// "phone" through a fake camera so the real scanner pipeline runs.
//
// DESTRUCTIVE: resets the game before and after. Never run during an event.
// Needs Google Chrome installed. Run against the dev server or the live site:
//   npm run test:browser                                   (http://localhost:3000)
//   E2E_BASE=https://famine-ace23.web.app npm run test:browser

import fs from 'fs';
import os from 'os';
import path from 'path';

import puppeteer from 'puppeteer-core';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import jwt from 'jsonwebtoken';
import { doc, getDoc, setDoc, terminate } from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';

import { db, auth } from '../src/database/firebase.js';
import { secret, helperPath } from '../src/components/secret/Secret.js';
import { STAGES, STATIONS, stationsForStage } from '../src/game/catalog.js';
import { resetGame, setGroupCount } from '../src/game/firestore.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'lifemon-e2e-'));

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

async function launch(video) {
  const args = ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--window-size=430,1000'];
  if (video) args.push(`--use-file-for-fake-video-capture=${video}`);
  return puppeteer.launch({ executablePath: CHROME, headless: 'new', args, defaultViewport: { width: 430, height: 1000 } });
}

// Expected noise: the QR library logs every frame it cannot decode, and a
// phone deliberately taken offline logs connection errors.
const NOISE = /NotFoundException|No MultiFormat Readers|ChecksumException|FormatException|ERR_INTERNET_DISCONNECTED|Could not reach Cloud Firestore backend|WebChannelConnection RPC/;
function watchErrors(page, label) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(`${label} console: ${m.text()}`);
  });
}

async function waitText(page, text, timeout = 25000) {
  // innerText reflects CSS text-transform (MUI uppercases tabs and buttons)
  await page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t.toLowerCase()), { timeout }, text);
}

// MUI select: open the field whose label matches, click the option.
async function choose(page, label, option) {
  const opened = await page.evaluate((lbl) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.replace('*', '').trim() === lbl);
    const ctl = l?.closest('.MuiFormControl-root')?.querySelector('[role="combobox"], [aria-haspopup="listbox"]');
    if (!ctl) return false;
    ctl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  }, label);
  if (!opened) throw new Error(`no select labelled "${label}"`);
  await page.waitForSelector('li[role="option"]', { timeout: 5000 });
  const clicked = await page.evaluate((opt) => {
    const li = [...document.querySelectorAll('li[role="option"]')].find((x) => x.textContent.trim() === opt);
    if (!li) return false;
    li.click();
    return true;
  }, option);
  if (!clicked) throw new Error(`no option "${option}" in "${label}"`);
  await page.waitForFunction(() => !document.querySelector('li[role="option"]'), { timeout: 5000 });
}

async function optionsOf(page, label) {
  await page.evaluate((lbl) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.replace('*', '').trim() === lbl);
    l.closest('.MuiFormControl-root').querySelector('[role="combobox"], [aria-haspopup="listbox"]')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, label);
  await page.waitForSelector('li[role="option"]');
  const opts = await page.evaluate(() => [...document.querySelectorAll('li[role="option"]')].map((li) => li.textContent.trim()));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('li[role="option"]'));
  return opts;
}

async function typeInto(page, label, value) {
  const handle = await page.evaluateHandle((lbl) => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.replace('*', '').trim() === lbl);
    return l?.closest('.MuiFormControl-root')?.querySelector('input');
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error(`no input labelled "${label}"`);
  await el.click({ clickCount: 3 });
  await el.type(String(value));
}

async function clickButton(page, text) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll('button, [role="tab"], [role="button"]')]
      .find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text);
  if (!ok) throw new Error(`no enabled button "${text}"`);
}

async function openHelper(page) {
  await page.goto(`${BASE}/${helperPath}`, { waitUntil: 'networkidle2' });
  await waitText(page, 'Station QR');
}

// Decode the QR the helper page actually drew.
async function readQR(page) {
  const el = await page.waitForSelector('.qrcode svg', { timeout: 10000 });
  const png = PNG.sync.read(Buffer.from(await el.screenshot({ type: 'png' })));
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) throw new Error('QR did not decode');
  return { token: code.data, payload: jwt.verify(code.data, secret) };
}

// Signed token -> YUV4MPEG2 video for Chrome's fake camera. A real camera
// never shows one frozen, pixel-perfect frame (a single static frame made the
// in-browser reader fail on some codes every time), so the video cycles the
// code at several sizes and positions on a grey background.
async function writeVideo(token, file) {
  const W = 640;
  const H = 480;
  const UV = Buffer.alloc((W / 2) * (H / 2), 128);
  const frames = [];
  for (const [scale, dx, dy] of [[5, 0, 0], [6, -20, 10], [7, 15, -10], [4, 30, 20], [6, 0, 0], [5, -25, -15]]) {
    const png = PNG.sync.read(await QRCode.toBuffer(token, { scale, margin: 4, errorCorrectionLevel: 'L' }));
    if (png.width > W || png.height > H) continue;
    const ox = Math.max(0, Math.min(W - png.width, Math.floor((W - png.width) / 2) + dx));
    const oy = Math.max(0, Math.min(H - png.height, Math.floor((H - png.height) / 2) + dy));
    const Y = Buffer.alloc(W * H, 225);
    for (let y = 0; y < png.height; y++) {
      for (let x = 0; x < png.width; x++) {
        Y[(oy + y) * W + (ox + x)] = png.data[(y * png.width + x) * 4] < 128 ? 25 : 235;
      }
    }
    const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, UV, UV]);
    frames.push(frame, frame, frame);
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`), ...frames]));
}

// A phone of team 1.1 whose camera sees `token`.
async function scannerPhone(token, name) {
  const video = path.join(OUT, `${name}.y4m`);
  await writeVideo(token, video);
  const br = await launch(video);
  const pg = await br.newPage();
  watchErrors(pg, name);
  await pg.goto(BASE, { waitUntil: 'networkidle2' });
  await pg.evaluate(() => localStorage.setItem('group', '1.1'));
  await pg.reload({ waitUntil: 'networkidle2' });
  await waitText(pg, 'TEAM 1.1');
  const toggle = () => pg.evaluate(() => document.querySelector('input[type="checkbox"]').click());
  const scannerClosed = () => pg.waitForFunction(() => !document.querySelector('video'), { timeout: 10000 }).catch(() => {});
  return { br, pg, toggle, scannerClosed };
}

async function until(fn, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(500);
  }
  return false;
}

const groupDoc = async (t) => (await getDoc(doc(db, 'groups', t))).data();
const money = (n) => `$${n.toLocaleString('en-US')}`;

// ---------------------------------------------------------------- run ---

await signInAnonymously(auth);
await resetGame(db);
await setGroupCount(db, 10);
console.log(`Testing ${BASE} (screenshots in ${OUT})`);

// 1. Every station's helper form draws a QR that decodes to the right payload.
const helperBrowser = await launch();
const helper = await helperBrowser.newPage();
watchErrors(helper, 'helper');
let stationsOk = 0;
for (const stage of STAGES) {
  for (const station of stationsForStage(stage.id)) {
    try {
      await openHelper(helper);
      await choose(helper, 'Stage', stage.label);
      await choose(helper, 'Station', station.label + (station.custom ? ' (enter amounts)' : ''));
      for (const f of station.fields) {
        if (f.type === 'select') await choose(helper, f.label, f.options[0].label);
        if (f.type === 'number' && f.default == null) await typeInto(helper, f.label, 100);
      }
      const { payload } = await readQR(helper);
      if (payload.s === station.id && payload.h === 'lifemon-v2' && typeof payload.q === 'string') stationsOk += 1;
      else check(false, `${station.id}: payload ${JSON.stringify(payload)}`);
    } catch (e) {
      check(false, `${station.id}: ${e.message}`);
    }
  }
}
check(stationsOk === STATIONS.length, `helper page draws a valid, decodable QR for all ${STATIONS.length} stations (${stationsOk})`);

// 2. A participant joins group 1 / team 1.1.
const p1Browser = await launch();
const p1 = await p1Browser.newPage();
watchErrors(p1, 'participant');
await p1.goto(BASE, { waitUntil: 'networkidle2' });
await waitText(p1, 'Choose your group');
const groupOptions = await optionsOf(p1, 'Group');
check(groupOptions.length === 10 && groupOptions[9] === 'Group 10', `join list offers Groups 1-10 (${groupOptions.length})`);
await choose(p1, 'Group', 'Group 1');
await choose(p1, 'Team', 'Team 1.1');
await clickButton(p1, 'Join');
await waitText(p1, 'TEAM 1.1');
// The header shows straight away; the account is created a moment later.
await until(async () => !!(await groupDoc('1.1')), 15000);
const joined = await groupDoc('1.1');
check(!!joined && joined.team === '1.1' && joined.group === 1, 'joining created team 1.1');
await setDoc(doc(db, 'groups', '1.1'), { ...joined, money: 100, food: 5, happiness: 10, charity: 0, education: 2 });
await waitText(p1, '$100');
check(true, 'passport updates live when the team document changes');

// 3. Real camera scan of a police QR; a repeat of the same QR is refused.
await openHelper(helper);
await choose(helper, 'Stage', 'Jobs - Secondary');
await choose(helper, 'Station', 'Police (shift)');
await typeInto(helper, 'Smugglers caught this shift', 2);
const police = await readQR(helper);
check(police.payload.i.smugglers === 2, 'police QR carries smugglers=2');
{
  const cam = await scannerPhone(police.token, 'police');
  await cam.toggle();
  try {
    await waitText(cam.pg, '+$350', 30000);
    check(true, 'scanning the police QR through the camera shows "+$350"');
  } catch (e) {
    check(false, 'police scan: success message never appeared');
  }
  const after = await groupDoc('1.1');
  check(after.money === 450 && after.food === 4 && after.happiness === 9, `scan applied exactly: $${after.money} 🍎${after.food} 😄${after.happiness} (want 450/4/9)`);
  await waitText(p1, '$450');
  check(true, "another phone of the team shows the new money without reloading");
  await waitText(p1, 'Police (shift) again in 15 min');
  check(true, 'passport shows the 15-minute police cooldown');
  await cam.scannerClosed();
  await cam.toggle();
  try {
    await waitText(cam.pg, 'already used this QR code', 30000);
    check(true, 'a second scan of the same QR is refused with a clear message');
  } catch (e) {
    check(false, 'no "already used" message on a repeat scan');
  }
  check((await groupDoc('1.1')).money === 450, 'the repeat scan changed nothing');
  await cam.br.close();
}

// 4. Team 1.2 plays its own profile; the group total and leaderboard add up.
await setDoc(doc(db, 'groups', '1.2'), { ...joined, team: '1.2', money: 1000, food: 3, happiness: 4, charity: 2, education: 0 });
await waitText(p1, 'GROUP 1 TOTAL · TEAM 1.1 + TEAM 1.2');
await waitText(p1, '$1,450');
check((await groupDoc('1.1')).money === 450, "team 1.2's money did not touch team 1.1");
check(true, 'passport shows the group total of both teams ($450 + $1,000)');
await clickButton(p1, 'LEADERBOARD');
await waitText(p1, 'Overall');
await waitText(p1, '★ Group 1');
const boardRow = await p1.evaluate(() => [...document.querySelectorAll('.MuiDataGrid-row')].map((r) => r.innerText.replace(/\s+/g, ' ')));
check(boardRow.length === 1 && ['$1,450', '× 13', '7/16', '100.0'].every((x) => boardRow[0].includes(x)),
  `leaderboard: teams 1.1 + 1.2 count as one group, with overall score and charity (${JSON.stringify(boardRow)})`);
await p1.screenshot({ path: path.join(OUT, 'leaderboard.png'), fullPage: true });

// 5. Announcement from the helper page reaches the phone.
await openHelper(helper);
await clickButton(helper, 'Live events');
await waitText(helper, 'Announcement to every phone');
await clickButton(helper, '🚨 Robbery started');
await waitText(p1, 'bank robbery is in progress');
check(true, 'robbery announcement appears on the phone');

// 6. The Final Will: one vote per team, never for your own or sister team.
await clickButton(helper, 'Open voting');
await waitText(p1, 'Vote for the team you think deserves');
const voteOptions = await optionsOf(p1, 'Vote for');
check(voteOptions.length === 18 && !voteOptions.includes('Team 1.1') && !voteOptions.includes('Team 1.2'),
  `vote list: 18 teams, not your own team or your sister team (${voteOptions.length})`);
await choose(p1, 'Vote for', 'Team 2.1');
await clickButton(p1, 'Vote');
await waitText(p1, 'Your team is voting for Team 2.1');
await waitText(helper, '1 team voted (1.1)');
await waitText(helper, 'Team 2.1: 1 vote');
check(true, 'the helper sees the vote and the tally live');
await clickButton(helper, 'Close voting');
await waitText(p1, 'Voting has closed');
await typeInto(helper, 'Room to collect the prize', 'RSM 1.31');
await clickButton(helper, 'Announce winner');
await waitText(p1, 'The Final Will went to Team 2.1');
await waitText(p1, 'send someone to RSM 1.31');
check(true, 'the winning team and the room are announced on every phone');

// 7. Wedding: the helper names both teams; one scan marries both.
await setDoc(doc(db, 'groups', '2.1'), { ...joined, team: '2.1', group: 2, money: 500, food: 2, happiness: 3, charity: 0, married: false, marriageId: null });
await openHelper(helper);
await choose(helper, 'Stage', 'Wedding and bank');
await choose(helper, 'Station', 'Wedding');
await choose(helper, 'First team', 'Team 1.1');
await choose(helper, 'Second team', 'Team 2.1');
await waitText(helper, 'Marries Team 1.1 and Team 2.1');
const wedding = await readQR(helper);
{
  const happyBefore = (await groupDoc('1.1')).happiness;
  const cam = await scannerPhone(wedding.token, 'wedding');
  await cam.toggle();
  const ok = await until(async () => (await groupDoc('2.1')).married === true);
  await cam.br.close();
  const [a, b] = [await groupDoc('1.1'), await groupDoc('2.1')];
  check(ok && a.married && b.married && a.marriageId === b.marriageId, 'one camera scan married BOTH teams');
  check(a.happiness === happyBefore + 5 && b.happiness === 8, `+5 happiness each (1.1: ${a.happiness}, 2.1: ${b.happiness})`);
  await waitText(p1, 'MARRIED TO TEAM 2.1');
  check(true, "team 1.1's other phone shows MARRIED TO TEAM 2.1 without reloading");
}

// 8. A supermarket QR is reusable: the same code scanned twice buys twice.
await openHelper(helper);
await choose(helper, 'Stage', 'Supermarket');
await choose(helper, 'Station', 'Buy apples');
await typeInto(helper, 'Price per apple today ($50 - $200)', 50);
await waitText(helper, 'reusable: teams can scan it again');
const shop = await readQR(helper);
{
  const before = await groupDoc('1.1');
  const cam = await scannerPhone(shop.token, 'shop');
  const results = [];
  for (let i = 0; i < 2; i++) {
    await cam.toggle();
    results.push(await until(async () => (await groupDoc('1.1')).food === before.food + i + 1));
    await cam.scannerClosed();
  }
  await cam.br.close();
  const after = await groupDoc('1.1');
  check(results.every(Boolean) && after.food === before.food + 2 && after.money === before.money - 100,
    `the same supermarket QR scanned twice = two purchases (🍎 ${before.food}->${after.food}, $${before.money}->$${after.money})`);
}

// 8b. Robbery: the helper sets today's money limit before showing the QR.
await openHelper(helper);
await choose(helper, 'Stage', 'Secret tasks');
await choose(helper, 'Station', 'Robbery (success)');
await waitText(helper, 'Only teams with less than $500');
await typeInto(helper, 'Only teams with less than ($)', 1000);
await waitText(helper, 'Only teams with less than $1,000');
const robbery = await readQR(helper);
check(robbery.payload.i.limit === 1000, `the robbery QR carries the $1000 limit typed on the helper page (${robbery.payload.i.limit})`);

// 9. Pandemic through the confirm dialog.
await openHelper(helper);
await clickButton(helper, 'Live events');
await waitText(helper, 'Announcement to every phone');
const beforePandemic = await groupDoc('1.1');
await helper.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply to all groups').click());
await typeInto(helper, 'Type PANDEMIC to confirm', 'PANDEMIC');
await clickButton(helper, 'Apply Pandemic');
await waitText(helper, 'Applied to 3 teams');
const afterPandemic = await groupDoc('1.1');
check(afterPandemic.money === beforePandemic.money - 200 && afterPandemic.food === beforePandemic.food - 2,
  `pandemic from the helper page: $${beforePandemic.money}->$${afterPandemic.money}, 🍎${beforePandemic.food}->${afterPandemic.food}`);

// 10. Groups tab: table, activity log, hand marriage fix, raffle, fixes.
await clickButton(helper, 'Groups');
await waitText(helper, 'Teams (3)');
await waitText(helper, 'Police');
check(true, 'the groups tab lists the teams and the activity log shows the police scan');

await choose(helper, 'Marry team', 'Team 1.2 (single)');
await choose(helper, 'with team', 'Team 2.1 (married)');
await waitText(helper, 'that marriage will end first');
await clickButton(helper, 'Marry these teams');
await waitText(helper, 'Team 1.2 and Team 2.1 are now married');
{
  const [a, b, c] = [await groupDoc('1.1'), await groupDoc('1.2'), await groupDoc('2.1')];
  check(!a.married && b.married && c.married && b.marriageId === c.marriageId, 'hand marriage: 1.2 + 2.1 married, 1.1 freed');
}
await waitText(p1, 'SINGLE');
check(true, "team 1.1's phone shows SINGLE after the hand fix, no reload");
await choose(helper, 'End the marriage of team', 'Team 1.2');
await clickButton(helper, 'End marriage');
await waitText(helper, 'Marriage ended: Team 1.2 and Team 2.1 are single again');
check(!(await groupDoc('1.2')).married && !(await groupDoc('2.1')).married, 'ending a marriage by hand frees both teams');

await setDoc(doc(db, 'groups', '1.1'), { ...(await groupDoc('1.1')), raffleTickets: 2 });
await setDoc(doc(db, 'groups', '2.1'), { ...(await groupDoc('2.1')), raffleTickets: 1 });
await waitText(helper, 'Raffle - 3 tickets · prize pool $150');
{
  const before = (await groupDoc('1.1')).money + (await groupDoc('2.1')).money;
  await clickButton(helper, 'Draw the winner');
  await waitText(helper, ': $150');
  await clickButton(helper, 'Pay the prizes');
  await waitText(helper, 'Paid: Team');
  const after = (await groupDoc('1.1')).money + (await groupDoc('2.1')).money;
  check(after === before + 150, `raffle: the whole $150 pool is paid to one winner (${before} -> ${after})`);
}

const fixBefore = (await groupDoc('1.1')).money;
await choose(helper, 'Team', 'Team 1.1');
await typeInto(helper, '± $', 77);
await clickButton(helper, 'Apply');
await waitText(helper, 'Team 1.1: +$77');
await waitText(p1, money(fixBefore + 77), 15000);
check(true, `"Fix a mistake" shows on the phone with no reload (${money(fixBefore + 77)})`);
await p1.setOfflineMode(true);
await choose(helper, 'Team', 'Team 1.1');
await typeInto(helper, '± $', 23);
await clickButton(helper, 'Apply');
await waitText(helper, 'Team 1.1: +$23');
await sleep(4000);
await p1.setOfflineMode(false);
try {
  await waitText(p1, money(fixBefore + 100), 30000);
  check(true, `a phone that was offline during a fix catches up on reconnect (${money(fixBefore + 100)})`);
} catch (e) {
  check(false, 'the offline phone did not catch up after reconnecting');
}

// 11. A reset sends every phone back to the join screen.
await clickButton(helper, 'Reset game...');
await typeInto(helper, 'Type RESET to confirm', 'RESET');
await clickButton(helper, 'Reset everything');
await waitText(helper, 'Reset complete');
await waitText(p1, 'Choose your group', 30000);
check(true, 'after a reset the phone returns to the join screen');

await Promise.all([helperBrowser.close(), p1Browser.close()]);
check(errors.length === 0, `no page errors or console errors${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL UI CHECKS PASS');
await resetGame(db);
await terminate(db);
process.exit(failures ? 1 : 0);
