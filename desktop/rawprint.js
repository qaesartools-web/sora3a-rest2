// ويندوز: نعرف تعريف كل طابعة، ونرسل أوامر ESC/POS «خام» (RAW) للطابعة مباشرة — بدون ما يمر على التعريف
// نستخدم PowerShell الموجود بكل ويندوز (ما نحتاج مكتبات ثانية). اسم الطابعة والملف يوصلون بمتغيرات البيئة
// (مو داخل الأمر) حتى أي اسم طابعة — حتى بالعربي أو بيه علامات — ما يخرب الأمر
'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// التعريف اللي يحوّل الورقة لكتابة بس (العربي يطلع رموز) — هذا نطبعله صورة ESC/POS
const TEXT_ONLY = /generic\s*\/\s*text\s*only|generic text|text only/i;
const isTextOnlyDriver = (driver) => TEXT_ONLY.test(String(driver || ''));
// تعريفات طابعات الفواتير الحرارية (ESC/POS) المعروفة: تعريفها بالويندوز يطبع الورقة بعرض 80 كامل (تنكص الكتابة من اليمين)
//  وبطول ورقة ثابت (297 ملم فارغة) — الصورة المباشرة أدق: بعرض الطابعة بالضبط وتنقص على قد الكتابة
const THERMAL = /sam4s|giant-?\d|ellix|pos[- ]?(80|58)|xp-?\d{2,3}|xprinter|(80|58)\s*mm\s*series|rongta|\brp-?\d{2,3}|thermal\s*receipt/i;
const isThermalDriver = (driver) => !isTextOnlyDriver(driver) && THERMAL.test(String(driver || ''));

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');
function runPs(script, env = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
      { env: { ...process.env, ...env }, windowsHide: true, timeout, maxBuffer: 4 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message || err).trim().slice(0, 300))) : resolve(String(stdout || '').trim())));
  });
}

// أسماء الطابعات وتعريفاتها (Win32_Printer يشتغل من ويندوز 7)
const DRIVERS_PS = `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
try { $p = Get-CimInstance -ClassName Win32_Printer } catch { $p = Get-WmiObject -Class Win32_Printer }
@($p | ForEach-Object { @{ n = [string]$_.Name; d = [string]$_.DriverName; r = [int]$_.HorizontalResolution } }) | ConvertTo-Json -Compress`;

function parseDrivers(out) {
  const map = new Map();
  if (!out) return map;
  let j; try { j = JSON.parse(out); } catch (e) { return map; }
  for (const x of Array.isArray(j) ? j : [j]) if (x && x.n) map.set(String(x.n), { driver: String(x.d || ''), dpi: Number(x.r) > 0 ? Number(x.r) : 0 });
  return map;
}

// يرسل البايتات كما هي للطابعة (نوع البيانات RAW: الويندوز ما يغيّر بيها شي)
const SEND_PS = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class SoraRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int written);
  public static string Send(string printer, byte[] data, string title) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return "ERR open " + Marshal.GetLastWin32Error();
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = title; di.pDataType = "RAW";
      if (StartDocPrinter(h, 1, di) == 0) return "ERR doc " + Marshal.GetLastWin32Error();
      try {
        StartPagePrinter(h);
        int w; bool ok = WritePrinter(h, data, data.Length, out w);
        EndPagePrinter(h);
        if (!ok || w != data.Length) return "ERR write " + Marshal.GetLastWin32Error();
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
    return "OK";
  }
}
'@
$b = [IO.File]::ReadAllBytes($env:SORA_RAW_FILE)
Write-Output ([SoraRaw]::Send($env:SORA_RAW_PRINTER, $b, $env:SORA_RAW_TITLE))`;

function createRaw({ tmpDir, run = runPs, ttlMs = 5 * 60000 } = {}) {
  let cache = null, at = 0, pending = null;
  async function drivers(force) {
    if (!force && cache && Date.now() - at < ttlMs) return cache;
    if (!pending) pending = run(DRIVERS_PS).then(parseDrivers).catch(() => cache || new Map()).then((m) => { cache = m; at = Date.now(); pending = null; return m; });
    return pending;
  }
  return {
    drivers,
    // هل هالطابعة تحتاج طباعة صورة ESC/POS؟ (طابعة جديدة ما بالذاكرة ← نعيد القراءة مرة)
    async info(name) {
      if (!name) return null;
      let m = await drivers(false);
      if (!m.has(name)) m = await drivers(true);
      return m.get(name) || null;
    },
    async isTextOnly(name) { const i = await this.info(name); return !!(i && isTextOnlyDriver(i.driver)); },
    async isThermal(name) { const i = await this.info(name); return !!(i && isThermalDriver(i.driver)); },
    // دقة الطابعة من تعريفها (التعريف النصي ما يعرفها ← 0)
    async dpi(name) { const i = await this.info(name); return i && !isTextOnlyDriver(i.driver) && i.dpi >= 150 && i.dpi <= 600 ? i.dpi : 0; },
    async send(printerName, bytes, title = 'Sora3a') {
      const file = path.join(tmpDir, 'sora3a-raw-' + crypto.randomUUID() + '.bin');
      fs.writeFileSync(file, bytes);
      try {
        const out = await run(SEND_PS, { SORA_RAW_FILE: file, SORA_RAW_PRINTER: printerName, SORA_RAW_TITLE: String(title || 'Sora3a').slice(0, 80) }, 45000);
        if (!/(^|\n)OK\s*$/.test(out)) throw new Error('الطابعة ما استلمت (' + (out.split('\n').pop() || 'بدون رد') + ')');
      } finally { fs.rm(file, () => {}); }
    },
  };
}

module.exports = { createRaw, isTextOnlyDriver, isThermalDriver, parseDrivers, DRIVERS_PS, SEND_PS, runPs };
