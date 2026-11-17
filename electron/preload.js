// 只暴露一个能力：提醒响起时把窗口带到最前面（窗口平时可以收起到托盘）。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('easycare', { focus: () => ipcRenderer.send('ec-focus') });
