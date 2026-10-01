#!/usr/bin/env node
// Redeems Genshin Impact codes via HoYoverse's gift API, using the COOKIE
// secret (same `ltuid_v2=...; ltoken_v2=...` header the daily check-in uses).
// Triggered by workflow_dispatch with a space-separated CODES input.
// Prints one JSON object per line: { code, status, retcode, message }.
// Exit codes: 0 = done, 2 = auth failed (cookie expired), 3 = setup problem.

const cookieHeader = (process.env.COOKIE || '').split('\n').map(s => s.trim()).find(Boolean);
if (!cookieHeader) {
  console.log(JSON.stringify({ ok: false, error: 'COOKIE environment variable not set!' }));
  process.exit(3);
}
const codes = (process.env.CODES || '').split(/\s+/).map(s => s.trim()).filter(Boolean);
if (!codes.length) {
  console.log(JSON.stringify({ ok: false, error: 'CODES environment variable not set!' }));
  process.exit(3);
}

const GAME_BIZ = 'hk4e_global';
const REGION = 'os_asia';

const STATUS = {
  0: 'redeemed',
  '-2001': 'expired',
  '-2003': 'invalid',
  '-2017': 'already',
  '-2016': 'already',
  '-1071': 'auth_error',
  '-100': 'auth_error',
};

const baseHeaders = {
  'accept': 'application/json, text/plain, */*',
  'origin': 'https://genshin.hoyoverse.com',
  'referer': 'https://genshin.hoyoverse.com/en/gift',
  'cookie': cookieHeader,
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

async function getJson(url) {
  const res = await fetch(url, { headers: baseHeaders });
  return res.json();
}

async function main() {
  // 1. bound game roles -> uid (Asia / Stella)
  const rolesRes = await getJson(
    `https://api-account-os.hoyoverse.com/account/binding/api/getUserGameRolesByCookie?game_biz=${GAME_BIZ}`);
  if (rolesRes.retcode !== 0) {
    console.log(JSON.stringify({ ok: false, auth_error: true, retcode: rolesRes.retcode, message: rolesRes.message }));
    process.exit(2);
  }
  const roles = (rolesRes.data && rolesRes.data.list) || [];
  const asia = roles.filter(r => r.region === REGION);
  const role = asia.find(r => (r.nickname || '').toLowerCase() === 'stella') || asia[0];
  if (!role) {
    console.log(JSON.stringify({ ok: false, error: `no ${REGION} role found` }));
    process.exit(3);
  }
  console.log(JSON.stringify({ ok: true, role: { uid: role.game_uid, nickname: role.nickname, region: role.region } }));

  // 2. redeem each code
  let authFailed = false;
  for (let i = 0; i < codes.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 2000)); // be polite to the API
    const code = codes[i];
    const url = 'https://sg-hk4e-api.hoyoverse.com/common/apicdkey/api/webExchangeCdkey'
      + `?uid=${role.game_uid}&region=${REGION}&lang=en&cdkey=${encodeURIComponent(code)}&game_biz=${GAME_BIZ}`;
    let res;
    try {
      res = await getJson(url);
    } catch (e) {
      res = { retcode: -9999, message: 'network_error' };
    }
    const status = STATUS[String(res.retcode)] || `unknown_${res.retcode}`;
    console.log(JSON.stringify({ code, status, retcode: res.retcode, message: res.message, uid: role.game_uid }));
    if (status === 'auth_error') { authFailed = true; break; }
  }
  process.exit(authFailed ? 2 : 0);
}

main().catch(e => {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
  process.exit(3);
});
