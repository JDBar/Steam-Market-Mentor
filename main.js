const electron = require('electron');
const {app, BrowserWindow, webContents, ipcMain} = electron;
const manager = new (require('./manager.js'))(app);
const express = require('express')();

// // Start the local server.
// const server = express.listen(manager.port, function () {
//   console.log(`Steam Market Mentor is listening on port ${manager.port}.`);
// })

// Open main app window and load index.html
app.on('ready', function () {
  manager.appWindow = new BrowserWindow({width: 1024, height: 768});
  manager.appWindow.loadURL(`file://${__dirname}/index.html`);
  manager.appWindow.webContents.on('dom-ready', function () {
    // anything that needs done when window opens
  })
})

// Quit the app when all windows are closed.
app.on('window-all-closed', function () {
  app.quit();
})