// جدار حماية ويندوز: الحكم على القواعد، وعلى حاسبة ويندوز (بناء النسخة) نفحص ونسمح فعلاً ونرجّع كلشي مثل ما كان
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const { createFirewall, judge, checkScript, fixScript, elevateScript, RULE } = require('../firewall');

const PUB = 0, PRIV = 1;
const ON = ['Domain', 'Private', 'Public'];

test('blocked when Windows saved a block rule for the program (Cancel on its question)', () => {
  const r = judge({ rules: [{ a: 'Allow', p: 2 }, { a: 'Block', p: 4 }], cats: [PUB], fw: ON });
  assert.equal(r.ok, false); assert.equal(r.blocked, true); assert.equal(r.pub, true);
});

test('blocked when allowed only on private networks but the WiFi is public', () => {
  assert.equal(judge({ rules: [{ a: 'Allow', p: 2 }], cats: [PUB], fw: ON }).ok, false);
  assert.equal(judge({ rules: [], cats: [PRIV], fw: ON }).ok, false);
  assert.equal(judge({ rules: { a: 'Allow', p: 2 }, cats: PRIV, fw: ON }).ok, true);   // عنصر واحد بدون قائمة (ConvertTo-Json)
});

test('ok with an allow rule for any network, or when the firewall is off for that network', () => {
  assert.equal(judge({ rules: [{ a: 'Allow', p: 0 }], cats: [PUB, PRIV], fw: ON }).ok, true);
  assert.equal(judge({ rules: [{ a: 'Allow', p: 6 }], cats: [PUB], fw: ON }).ok, true);
  assert.equal(judge({ rules: [], cats: [PUB], fw: ['Domain', 'Private'] }).ok, true);
  assert.equal(judge({ rules: [], cats: [], fw: ON }).ok, true);
  assert.equal(judge(null).ok, null);
});

test('program paths with quotes stay inside the PowerShell string', () => {
  const exe = "C:\\Users\\O'Neil\\AppData\\Local\\Programs\\sora3a-cashier\\Sora3a Cashier.exe";
  assert.ok(checkScript(exe).includes("$p='C:\\Users\\O''Neil\\AppData"));
  assert.ok(fixScript(exe).includes("$p='C:\\Users\\O''Neil\\AppData"));
  assert.ok(elevateScript(fixScript(exe)).includes('-Verb RunAs'));
});

test('not Windows: nothing to check', async () => {
  const fw = createFirewall({ win: false, run: () => { throw new Error('should not run'); } });
  assert.equal((await fw.check()).ok, true);
});

test('reads the PowerShell answer and reports a refused approval', async () => {
  const calls = [];
  const fw = createFirewall({ win: true, exe: 'C:\\x.exe', run: async (s) => {
    calls.push(s);
    if (s.includes('-Verb RunAs')) return { code: 5, out: '' };
    return { code: 0, out: 'WARNING: x\r\n{"rules":{"a":"Block","p":4},"cats":0,"fw":["Public"]}\r\n' };
  } });
  assert.deepEqual(await fw.check(), { ok: false, blocked: true, missing: true, pub: true });
  const r = await fw.fix();
  assert.equal(r.refused, true); assert.equal(r.ok, false);
  assert.equal(calls.length, 3);
});

// على حاسبة ويندوز حقيقية (بناء النسخة بـ GitHub): نفحص، نسمح، ونتأكد صار مسموح — بعدين نشيل القواعد
test('Windows: real check, allow and re-check', { skip: process.platform !== 'win32' }, async () => {
  const exe = "C:\\Sora3a Test\\it's cashier.exe";
  const ps = (s) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', s], { encoding: 'utf8' });
  const clean = () => ps(`Remove-NetFirewallRule -DisplayName '${RULE}' -ErrorAction SilentlyContinue; Get-NetFirewallApplicationFilter | Where-Object { $_.Program -eq '${exe.replace(/'/g, "''")}' } | Get-NetFirewallRule | Remove-NetFirewallRule -ErrorAction SilentlyContinue`);
  clean();
  try {
    const fw = createFirewall({ exe, win: true });
    const before = await fw.check();
    assert.notEqual(before.ok, null, 'check script must parse');
    // نفس اللي يسويه ويندوز لما ينضغط «إلغاء»: منع للبرنامج بالشبكات العامة والخاصة
    ps(`New-NetFirewallRule -DisplayName 'sora3a-test-block' -Direction Inbound -Action Block -Program '${exe.replace(/'/g, "''")}' -Profile Any | Out-Null`);
    const blocked = await fw.check();
    const r = await fw.fix();
    assert.equal(r.fixed, true, 'fix script must run');
    assert.equal(r.ok, true);
    const names = ps(`Get-NetFirewallApplicationFilter | Where-Object { $_.Program -eq '${exe.replace(/'/g, "''")}' } | Get-NetFirewallRule | ForEach-Object { $_.DisplayName }`);
    assert.ok(!names.includes('sora3a-test-block'), 'old block rule removed');
    assert.ok(names.includes(RULE));
    console.log('firewall on runner:', JSON.stringify({ before, blocked, after: r }));
  } finally { clean(); }
});
