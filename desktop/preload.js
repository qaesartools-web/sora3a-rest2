// الجسر بين صفحة الكاشير وبرنامج الويندوز — يشتغل بس على روابط سرعة
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const allowed = arg('sora-origins').split(',').filter(Boolean);

if (allowed.includes(location.origin)) {
  contextBridge.exposeInMainWorld('SoraDesktop', {
    version: arg('sora-version'),
    platform: arg('sora-platform'),
    canAutoStart: true,
    printers: () => ipcRenderer.invoke('sora:printers'),
    print: (html, opts) => ipcRenderer.invoke('sora:print', String(html || ''), opts || {}),
    jobs: () => ipcRenderer.invoke('sora:jobs'),
    reprint: (id) => ipcRenderer.invoke('sora:reprint', Number(id)),
    getTestMode: () => ipcRenderer.invoke('sora:testmode:get'),
    setTestMode: (on) => ipcRenderer.invoke('sora:testmode:set', !!on),
    openSimulator: () => ipcRenderer.invoke('sora:simulator:open'),
    getAutoStart: () => ipcRenderer.invoke('sora:autostart:get'),
    setAutoStart: (on) => ipcRenderer.invoke('sora:autostart:set', !!on),
    onUpdate: (cb) => { ipcRenderer.on('sora:update', (_e, v) => { try { cb(String(v)); } catch (e) {} }); },
  });
  // شبكة المطعم: الحاسبة «مركز» — نفس الواجهة بتطبيق الأندرويد (window.SoraLan)
  contextBridge.exposeInMainWorld('SoraLan', {
    role: 'hub',
    start: (c) => ipcRenderer.invoke('sora:lan:start', c || {}),
    stop: () => ipcRenderer.invoke('sora:lan:stop'),
    status: () => ipcRenderer.invoke('sora:lan:status'),
    send: (to, m) => ipcRenderer.send('sora:lan:send', String(to || '*'), m),
    broadcast: (m) => ipcRenderer.send('sora:lan:broadcast', m),
    fw: () => ipcRenderer.invoke('sora:lan:fw'),
    fwFix: () => ipcRenderer.invoke('sora:lan:fwfix'),
    on: (cb) => { ipcRenderer.on('sora:lan', (_e, v) => { try { cb(v); } catch (e) {} }); },
  });
}
