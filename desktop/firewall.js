// جدار حماية ويندوز وشبكة المطعم: ويندوز يعتبر أغلب شبكات الواي فاي «عامة» ويمنع أي جهاز يتصل بالبرنامج،
// وإذا انضغط «إلغاء» على سؤاله يحط منع دائم. هنا: نفحص إذا الشاشات ممنوعة توصل، ونسمح بضغطة (ويندوز يطلب موافقة)
// • الفحص يقرا القواعد بطريقتين: أوامر NetSecurity وواجهة ويندوز (HNetCfg.FwPolicy2) اللي تنقرا بدون صلاحية المسؤول —
//   قبل: إذا الأوامر ما رجّعت شي (البرنامج مو مسؤول) الفحص يكول «ممنوع» حتى بعد ما ينسمح، والتنبيه ما يروح أبد
// • مسار البرنامج يتقارن بعد ما نفك متغيرات ويندوز (%LOCALAPPDATA%…) وبدون فرق حروف كبيرة/صغيرة
// • السماح (بصلاحية المسؤول) يكتب نتيجته بملف حتى نعرف شنو صار بالضبط، وإذا أوامر NetSecurity ما اشتغلت نستخدم netsh
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { UDP_PORT, TCP_PORT } = require('./lan');

const RULE = 'Sora3a Cashier LAN';
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
// [int] Profile: Any=0 Domain=1 Private=2 Public=4 — NetworkCategory: Public=0 Private=1 Domain=2
const BIT = { 0: 4, 1: 2, 2: 1 }, NAME = { 0: 'Public', 1: 'Private', 2: 'Domain' };
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

// مسار البرنامج بشكل واحد للمقارنة (يفك %متغيرات% ويصغّر الحروف)
const NORM = "$norm = { param($x) $s = [Environment]::ExpandEnvironmentVariables([string]$x).Trim('\"'); try { $s = [IO.Path]::GetFullPath($s) } catch {}; $s.ToLowerInvariant() }";

// قواعد البرنامج الداخلة + نوع الشبكة المتصلة + الجدار شغّال بأي نوع + «امنع كل الاتصالات الداخلة»
const checkScript = (exe) => [
  "$ErrorActionPreference='SilentlyContinue'",
  NORM,
  '$p=' + q(exe),
  '$pn = & $norm $p',
  '$r = New-Object System.Collections.ArrayList',
  // 1) أوامر NetSecurity (ويندوز 8 وأحدث)
  "@(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object { (& $norm $_.Program) -eq $pn } | Get-NetFirewallRule | Where-Object { [string]$_.Direction -eq 'Inbound' -and [string]$_.Enabled -eq 'True' }) | ForEach-Object { [void]$r.Add(@{a=[string]$_.Action; p=[int]$_.Profile; s='n'}) }",
  // 2) واجهة ويندوز للجدار (تنقرا بدون مسؤول، وتشتغل من ويندوز 7)
  '$fw2 = $null; try { $fw2 = New-Object -ComObject HNetCfg.FwPolicy2 } catch {}',
  "if ($fw2) { foreach ($x in $fw2.Rules) { if ($x.Direction -eq 1 -and $x.Enabled -and $x.ApplicationName -and ((& $norm $x.ApplicationName) -eq $pn)) { $pr = [int]$x.Profiles; if ($pr -ge 7) { $pr = 0 }; [void]$r.Add(@{a=$(if ($x.Action -eq 1) {'Allow'} else {'Block'}); p=$pr; s='c'}) } } }",
  '$c = @(Get-NetConnectionProfile | ForEach-Object { [int]$_.NetworkCategory })',
  'if ($c.Count -eq 0 -and $fw2) { $t = [int]$fw2.CurrentProfileTypes; if ($t -band 4) { $c += 0 }; if ($t -band 2) { $c += 1 }; if ($t -band 1) { $c += 2 } }',
  "$f = @(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object { [string]$_.Enabled -eq 'True' } | ForEach-Object { [string]$_.Name })",
  "$sh = @(Get-NetFirewallProfile -PolicyStore ActiveStore | Where-Object { [string]$_.Enabled -eq 'True' -and [string]$_.AllowInboundRules -eq 'False' } | ForEach-Object { [string]$_.Name })",
  "if ($fw2) { foreach ($k in @(@(1,'Domain'),@(2,'Private'),@(4,'Public'))) { try { if ($fw2.FirewallEnabled($k[0]) -and $f -notcontains $k[1]) { $f += $k[1] }; if ($fw2.FirewallEnabled($k[0]) -and $fw2.BlockAllInboundTraffic($k[0]) -and $sh -notcontains $k[1]) { $sh += $k[1] } } catch {} } }",
  '$adm = $false; try { $adm = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) } catch {}',
  '@{rules=@($r); cats=$c; fw=$f; sh=$sh; adm=$adm} | ConvertTo-Json -Compress -Depth 4',
].join('\n');

// بصلاحية المسؤول: نشيل المنع القديم للبرنامج ونسمح له (والمنفذين) بكل أنواع الشبكات — والنتيجة بملف
const fixScript = (exe, out) => [
  "$ErrorActionPreference='SilentlyContinue'",
  NORM,
  '$p=' + q(exe),
  '$pn = & $norm $p',
  "$res = @{ removed = 0; created = 0; via = ''; err = '' }",
  "$old = @(Get-NetFirewallApplicationFilter | Where-Object { (& $norm $_.Program) -eq $pn } | Get-NetFirewallRule | Where-Object { [string]$_.Direction -eq 'Inbound' })",
  '$res.removed = $old.Count',
  '$old | Remove-NetFirewallRule',
  'Remove-NetFirewallRule -DisplayName ' + q(RULE),
  // نفس الشي بواجهة ويندوز (منع حطّه ويندوز بمسار مكتوب بشكل ثاني)
  'try { $fw2 = New-Object -ComObject HNetCfg.FwPolicy2; $names = @(); foreach ($x in $fw2.Rules) { if ($x.Direction -eq 1 -and $x.ApplicationName -and ((& $norm $x.ApplicationName) -eq $pn)) { $names += $x.Name } }; foreach ($n in $names) { try { $fw2.Rules.Remove($n); $res.removed++ } catch {} } } catch {}',
  'try {',
  "  $ErrorActionPreference='Stop'",
  '  New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Direction Inbound -Action Allow -Program $p -Profile Any -Enabled True | Out-Null',
  '  New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Direction Inbound -Action Allow -Protocol UDP -LocalPort ' + UDP_PORT + ' -Profile Any -Enabled True | Out-Null',
  '  New-NetFirewallRule -DisplayName ' + q(RULE) + ' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ' + TCP_PORT + ' -Profile Any -Enabled True | Out-Null',
  "  $res.created = 3; $res.via = 'net'",
  '} catch {',
  "  $ErrorActionPreference='SilentlyContinue'",
  '  $res.err = [string]$_.Exception.Message',
  // أوامر NetSecurity ما موجودة/ما اشتغلت ← netsh (موجود بكل ويندوز)
  '  $n = ' + q('name=' + RULE),
  '  & netsh advfirewall firewall delete rule $n | Out-Null',
  '  & netsh advfirewall firewall add rule $n dir=in action=allow ("program=" + $p) enable=yes profile=any | Out-Null; if ($LASTEXITCODE -eq 0) { $res.created++ }',
  '  & netsh advfirewall firewall add rule $n dir=in action=allow protocol=UDP localport=' + UDP_PORT + ' enable=yes profile=any | Out-Null; if ($LASTEXITCODE -eq 0) { $res.created++ }',
  '  & netsh advfirewall firewall add rule $n dir=in action=allow protocol=TCP localport=' + TCP_PORT + ' enable=yes profile=any | Out-Null; if ($LASTEXITCODE -eq 0) { $res.created++ }',
  "  $res.via = 'netsh'",
  '}',
  ...(out ? ['try { [IO.File]::WriteAllText(' + q(out) + ', ($res | ConvertTo-Json -Compress)) } catch {}'] : []),
  'if ($res.created -ge 1) { exit 0 } else { exit 3 }',
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
  const rules = arr(j.rules).filter((r) => r && typeof r === 'object'), cats = arr(j.cats).map(Number), on = arr(j.fw).map(String), sh = arr(j.sh).map(String);
  const covers = (p, b) => Number(p) === 0 || (Number(p) & b) !== 0;
  const need = [...new Set(cats)].filter((c) => NAME[c] && on.includes(NAME[c]));
  const shields = need.some((c) => sh.includes(NAME[c]));    // «امنع كل الاتصالات الداخلة» مأشرة بويندوز — حتى المسموح ينمنع
  const blocked = need.some((c) => rules.some((r) => r.a === 'Block' && covers(r.p, BIT[c])));
  const missing = need.some((c) => !rules.some((r) => r.a === 'Allow' && covers(r.p, BIT[c])));
  const out = { ok: !blocked && !missing && !shields, blocked, missing, pub: cats.includes(0) };
  if (shields) out.shields = true;
  if (typeof j.adm === 'boolean') out.admin = j.adm;
  return out;
}

function createFirewall({ exe, run, win, tmpDir } = {}) {
  if (win == null) win = process.platform === 'win32';
  exe = exe || process.execPath;
  tmpDir = tmpDir || os.tmpdir();
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
    const out = path.join(tmpDir, 'sora3a-fw-' + crypto.randomUUID() + '.json');
    const r = await run(elevateScript(fixScript(exe, out)), 180000);
    let res = null;
    try { res = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^﻿/, '')); } catch (e) { res = null; }
    fs.rm(out, () => {});
    const st = await check();
    const o = { ...st, refused: r.code === 5, fixed: r.code === 0 };
    if (res) { o.created = Number(res.created) || 0; o.removed = Number(res.removed) || 0; o.via = String(res.via || ''); if (res.err) o.err = String(res.err).slice(0, 200); }
    return o;
  }
  return { check, fix, last: () => last };
}

module.exports = { createFirewall, judge, checkScript, fixScript, elevateScript, RULE };
