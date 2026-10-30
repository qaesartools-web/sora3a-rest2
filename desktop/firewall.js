// جدار حماية ويندوز وشبكة المطعم: ويندوز يعتبر أغلب شبكات الواي فاي «عامة» ويمنع أي جهاز يتصل بالبرنامج،
// وإذا انضغط «إلغاء» على سؤاله يحط منع دائم. هنا: نفحص إذا الشاشات ممنوعة توصل، ونسمح بضغطة (ويندوز يطلب موافقة)
'use strict';
const { execFile } = require('child_process');
const { UDP_PORT, TCP_PORT } = require('./lan');

const RULE = 'Sora3a Cashier LAN';
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// [int] Profile: Any=0 Domain=1 Private=2 Public=4 — NetworkCategory: Public=0 Private=1 Domain=2
const BIT = { 0: 4, 1: 2, 2: 1 }, NAME = { 0: 'Public', 1: 'Private', 2: 'Domain' };
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// قواعد البرنامج الداخلة + نوع الشبكة المتصلة + الجدار شغّال بأي نوع
const checkScript = (exe) => [
  "$ErrorActionPreference='SilentlyContinue'",
  '$p=' + q(exe),
  "$r=@(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object { $_.Program -eq $p } | Get-NetFirewallRule | Where-Object { [string]$_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' } | ForEach-Object { @{a=[string]$_.Action; p=[int]$_.Profile} })",
  '$c=@(Get-NetConnectionProfile | ForEach-Object { [int]$_.NetworkCategory })',
  "$f=@(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object { [string]$_.Enabled -eq 'True' } | ForEach-Object { [string]$_.Name })",
  '@{rules=$r; cats=$c; fw=$f} | ConvertTo-Json -Compress -Depth 4',
].join('\n');

// بصلاحية المسؤول: نشيل المنع القديم للبرنامج ونسمح له (والمنفذين) بكل أنواع الشبكات
const fixScript = (exe) => [
  "$ErrorActionPreference='SilentlyContinue'",
  '$p=' + q(exe),
  "Get-NetFirewallApplicationFilter | Where-Object { $_.Program -eq $p } | Get-NetFirewallRule | Where-Object { [string]$_.Direction -eq 'Inbound' } | Remove-NetFirewallRule",
  'Remove-NetFirewallRule -DisplayName ' + q(RULE),
  "$ErrorActionPreference='Stop'",
  'New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Direction Inbound -Action Allow -Program $p -Profile Any -Enabled True | Out-Null',
  'New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ' + UDP_PORT + ' -Profile Any -Enabled True | Out-Null',
  'New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ' + TCP_PORT + ' -Profile Any -Enabled True | Out-Null',
].join('\n');
const enc = (s) => Buffer.from(s, 'utf16le').toString('base64');
// نافذة ويندوز «هل تسمح لهذا التطبيق بإجراء تغييرات؟» — إذا انضغط «لا» يرجع 5
const elevateScript = (inner) => [
  'try {',
  "  $x = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','" + enc(inner) + "'",
  '  exit $x.ExitCode',
  '} catch { exit 5 }',
].join('\n');

// الحكم: ok=true تكدر الشاشات توصل، false ممنوعة، null ما نعرف
function judge(j) {
  if (!j || typeof j !== 'object') return { ok: null };
  const rules = arr(j.rules).filter((r) => r && typeof r === 'object'), cats = arr(j.cats).map(Number), on = arr(j.fw).map(String);
  const covers = (p, b) => Number(p) === 0 || (Number(p) & b) !== 0;
  const need = cats.filter((c) => NAME[c] && on.includes(NAME[c]));
  const blocked = need.some((c) => rules.some((r) => r.a === 'Block' && covers(r.p, BIT[c])));
  const missing = need.some((c) => !rules.some((r) => r.a === 'Allow' && covers(r.p, BIT[c])));
  return { ok: !blocked && !missing, blocked, missing, pub: cats.includes(0) };
}

function createFirewall({ exe, run, win } = {}) {
  if (win == null) win = process.platform === 'win32';
  exe = exe || process.execPath;
  run = run || ((script, timeout) => new Promise((res) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc(script)],
      { windowsHide: true, timeout }, (err, out) => res({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: String(out || '') }));
  }));
  let last = null, busy = null;
  async function check() {
    if (!win) return { ok: true, na: true };
    if (busy) return busy;
    busy = run(checkScript(exe), 30000).then((r) => {
      let j = null;
      try { j = JSON.parse(r.out.trim().split(/\r?\n/).pop() || 'null'); } catch (e) { j = null; }
      last = r.code === 0 ? judge(j) : { ok: null };
      return last;
    }).finally(() => { busy = null; });
    return busy;
  }
  async function fix() {
    if (!win) return { ok: true, na: true };
    const r = await run(elevateScript(fixScript(exe)), 180000);
    const st = await check();
    return { ...st, refused: r.code === 5, fixed: r.code === 0 };
  }
  return { check, fix, last: () => last };
}

module.exports = { createFirewall, judge, checkScript, fixScript, elevateScript, RULE };
