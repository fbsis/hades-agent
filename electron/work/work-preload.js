const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('metisWork',{command:(name,args={})=>ipcRenderer.invoke('metis-work:command',name,args)});
