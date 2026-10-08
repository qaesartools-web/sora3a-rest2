// جسر شاشة محاكي الطابعات
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('Sim', {
  onPaper: (cb) => { ipcRenderer.on('sim:paper', (_e, p) => { try { cb(p); } catch (e) {} }); },
  clear: () => ipcRenderer.invoke('sim:clear'),
  openFolder: () => ipcRenderer.invoke('sim:folder'),
  openPdf: (f) => ipcRenderer.invoke('sim:pdf', String(f || '')),
});
