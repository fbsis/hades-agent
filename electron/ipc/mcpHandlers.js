const { ipcMain } = require('electron');
const mcpClientService = require('../services/mcpClientService');
const logger = require('../services/logger');
const store = require('../store/jsonStore');

function assertTrustedSender(event) {
  const rawUrl = event.senderFrame?.url || event.sender.getURL();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Origem IPC MCP invalida.');
  }
  const trusted = url.protocol === 'file:'
    || (url.protocol === 'http:' && url.hostname === 'localhost' && url.port === '3000');
  if (!trusted) throw new Error('Origem IPC MCP nao autorizada.');
}

function registerMcpHandlers() {
  ipcMain.handle('mcp-get-status', async (event) => {
    try {
      assertTrustedSender(event);
      return { success: true, data: await mcpClientService.getStatus() };
    } catch (error) {
      logger.error('MCP', 'status error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('mcp-test-server', async (event, serverId) => {
    try {
      assertTrustedSender(event);
      const server = (store.getSettings()?.mcp?.servers || []).find(item => item.id === serverId);
      if (!server) throw new Error('Salve o servidor MCP antes de testar a conexao.');
      return { success: true, data: await mcpClientService.testServer(server) };
    } catch (error) {
      logger.error('MCP', 'server test error', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('mcp-reload', async (event) => {
    try {
      assertTrustedSender(event);
      return { success: true, data: await mcpClientService.reload() };
    } catch (error) {
      logger.error('MCP', 'reload error', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = registerMcpHandlers;
