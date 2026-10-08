// الجسر بين صفحة الكاشير وبرنامج الويندوز — يشتغل بس على روابط سرعة
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);
const allowed = arg('sora-origins').split(',').filter(Boolean);

if (allowed.includes(location.origin)) {
  contextBridge.exposeInMainWorld('SoraDesktop', {
    version: arg('sora-version'),
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
}
