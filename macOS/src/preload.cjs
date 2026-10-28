const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('teacherBridge', {
  postMessage(message) {
    ipcRenderer.send('teacher-shell-message', message);
  },
  addEventListener(type, listener) {
    if (type !== 'message' || typeof listener !== 'function') return;
    ipcRenderer.on('teacher-host-message', (_event, data) => listener({ data }));
  }
});
