const { spawn } = require('node:child_process');
const speech = require('@google-cloud/speech');
const logger = require('./logger');

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function friendlyAuthError(error) {
  const message = String(error?.message || error || '');
  if (/invalid_grant|account has been deleted/i.test(message)) {
    return 'A credencial atual expirou ou pertence a uma conta removida.';
  }
  if (/default credentials|could not load/i.test(message)) {
    return 'Google Cloud ainda nao esta conectado.';
  }
  if (/quota project|serviceusage\.services\.use|service usage consumer/i.test(message)) {
    return 'O projeto nao pode ser usado para quota. Conceda Service Usage Consumer a sua conta nesse projeto.';
  }
  return message || 'Nao foi possivel validar o Google Cloud.';
}

class GoogleCloudAuthService {
  constructor(options = {}) {
    this.spawnImpl = options.spawnImpl || spawn;
    this.clientFactory = options.clientFactory || (() => new speech.SpeechClient());
    this.platform = options.platform || process.platform;
    this.shell = options.shell || process.env.SHELL || '/bin/sh';
    this.loginPromise = null;
  }

  async getStatus() {
    const client = this.clientFactory();
    try {
      const accessToken = await client.auth.getAccessToken();
      const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;
      if (!token) {
        return { authenticated: false, error: 'Google Cloud ainda nao esta conectado.' };
      }

      const authClient = await client.auth.getClient();
      const quotaProjectId = authClient?.quotaProjectId
        || authClient?.credentials?.quota_project_id
        || '';
      if (!quotaProjectId) {
        return {
          authenticated: false,
          error: 'Credencial encontrada, mas o quota project ainda nao foi configurado.'
        };
      }

      let projectId = quotaProjectId;
      try {
        projectId = await client.getProjectId() || quotaProjectId;
      } catch {
        // The quota project from ADC is sufficient for client-based APIs.
      }
      return { authenticated: true, projectId: projectId || '' };
    } catch (error) {
      return { authenticated: false, error: friendlyAuthError(error) };
    } finally {
      try {
        await client.close?.();
      } catch {
        // Auth status is already known; ignore client cleanup failures.
      }
    }
  }

  loginCommand() {
    if (this.platform === 'win32') {
      return {
        command: 'gcloud.cmd',
        args: ['auth', 'application-default', 'login', '--quiet']
      };
    }
    return {
      command: this.shell,
      args: ['-lc', 'exec gcloud auth application-default login --quiet']
    };
  }

  quotaProjectCommand(projectId) {
    const args = [
      'auth',
      'application-default',
      'set-quota-project',
      projectId,
      '--quiet'
    ];
    if (this.platform === 'win32') {
      return { command: 'gcloud.cmd', args };
    }
    return {
      command: this.shell,
      args: ['-lc', `exec gcloud ${args.map(value => JSON.stringify(value)).join(' ')}`]
    };
  }

  async login(projectId) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
      return { authenticated: false, error: 'Informe o Project ID do Google Cloud.' };
    }
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.runLogin(normalizedProjectId).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  runCommand(commandSpec) {
    return new Promise(resolve => {
      const child = this.spawnImpl(commandSpec.command, commandSpec.args, {
        env: process.env,
        stdio: 'ignore',
        windowsHide: true
      });
      child.once('error', error => resolve({ success: false, error }));
      child.once('exit', code => resolve({ success: code === 0, code }));
    });
  }

  runLogin(projectId) {
    const { command, args } = this.loginCommand();
    logger.info('GOOGLE CLOUD AUTH', 'Starting Application Default Credentials login');

    return new Promise(resolve => {
      let settled = false;
      let timeout;
      const child = this.spawnImpl(command, args, {
        env: process.env,
        stdio: 'ignore',
        windowsHide: true
      });

      const finish = async result => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (result) {
          resolve(result);
          return;
        }
        const status = await this.getStatus();
        resolve(status);
      };

      timeout = setTimeout(() => {
        child.kill();
        finish({
          authenticated: false,
          error: 'O login do Google Cloud expirou. Tente novamente.'
        });
      }, LOGIN_TIMEOUT_MS);

      child.once('error', error => {
        logger.error('GOOGLE CLOUD AUTH', 'Could not start gcloud login', error);
        finish({
          authenticated: false,
          error: this.platform === 'win32'
            ? 'Google Cloud CLI nao foi encontrado no PATH.'
            : 'Google Cloud CLI nao foi encontrado no shell do usuario.'
        });
      });
      child.once('exit', async code => {
        if (code === 0) {
          logger.info('GOOGLE CLOUD AUTH', 'Application Default Credentials login completed');
          const quotaResult = await this.runCommand(this.quotaProjectCommand(projectId));
          if (!quotaResult.success) {
            logger.warn(
              'GOOGLE CLOUD AUTH',
              `Could not set ADC quota project ${projectId} (code ${quotaResult.code ?? 'spawn error'})`
            );
            finish({
              authenticated: false,
              error: quotaResult.error
                ? friendlyAuthError(quotaResult.error)
                : 'Nao foi possivel usar esse projeto para quota. Verifique o Project ID e a permissao Service Usage Consumer.'
            });
            return;
          }
          logger.info('GOOGLE CLOUD AUTH', `ADC quota project configured: ${projectId}`);
          finish();
          return;
        }
        logger.warn('GOOGLE CLOUD AUTH', `Login exited with code ${code}`);
        finish({
          authenticated: false,
          error: 'O login foi cancelado ou nao foi concluido.'
        });
      });
    });
  }
}

module.exports = new GoogleCloudAuthService();
module.exports.GoogleCloudAuthService = GoogleCloudAuthService;
module.exports.friendlyAuthError = friendlyAuthError;
