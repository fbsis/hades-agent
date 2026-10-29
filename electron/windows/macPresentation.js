function configureMacPresentation(app, Menu, platform = process.platform) {
  if (platform !== 'darwin') return;
  app.setActivationPolicy('accessory');
  app.dock?.hide();
  Menu.setApplicationMenu(null);
}
module.exports = { configureMacPresentation };
