class Manager {

  constructor (app) {
    this.port = 8090;
    this.isSecondInstance = app.makeSingleInstance(this.handleSecondInstance);
    // Quit app if another instance is already running.
    if (this.isSecondInstance) {
      app.quit();
    }
  }
  
  // Focus the current window if a second instance is opened.
  handleSecondInstance (argv, workingDirectory) {
    if (this.appWindow) {
      if (this.appWindow.isMinimized()) {
        this.appWindow.restore();
      }
      this.appWindow.focus();
    }
  }
}

module.exports = Manager;