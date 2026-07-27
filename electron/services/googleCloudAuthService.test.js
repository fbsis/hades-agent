import { describe, expect, it } from 'vitest';
import authModule from './googleCloudAuthService.js';

const { GoogleCloudAuthService, friendlyAuthError } = authModule;

describe('GoogleCloudAuthService', () => {
  it('uses the browser-based ADC login command on macOS', () => {
    const service = new GoogleCloudAuthService({
      platform: 'darwin',
      shell: '/bin/zsh',
      clientFactory: () => ({})
    });

    expect(service.loginCommand()).toEqual({
      command: '/bin/zsh',
      args: ['-lc', 'exec gcloud auth application-default login --quiet']
    });
  });

  it('uses gcloud.cmd directly on Windows', () => {
    const service = new GoogleCloudAuthService({
      platform: 'win32',
      clientFactory: () => ({})
    });

    expect(service.loginCommand()).toEqual({
      command: 'gcloud.cmd',
      args: ['auth', 'application-default', 'login', '--quiet']
    });
  });

  it('configures the ADC quota project after login', () => {
    const macService = new GoogleCloudAuthService({
      platform: 'darwin',
      shell: '/bin/zsh',
      clientFactory: () => ({})
    });
    const windowsService = new GoogleCloudAuthService({
      platform: 'win32',
      clientFactory: () => ({})
    });

    expect(macService.quotaProjectCommand('my-project')).toEqual({
      command: '/bin/zsh',
      args: [
        '-lc',
        'exec gcloud "auth" "application-default" "set-quota-project" "my-project" "--quiet"'
      ]
    });
    expect(windowsService.quotaProjectCommand('my-project')).toEqual({
      command: 'gcloud.cmd',
      args: [
        'auth',
        'application-default',
        'set-quota-project',
        'my-project',
        '--quiet'
      ]
    });
  });

  it('turns invalid grants into an actionable status message', () => {
    expect(friendlyAuthError(new Error('invalid_grant: Account has been deleted')))
      .toContain('conta removida');
  });

  it('turns quota permission failures into an actionable message', () => {
    expect(friendlyAuthError(new Error('missing serviceusage.services.use permission')))
      .toContain('Service Usage Consumer');
  });

  it('does not report ADC as ready without a quota project', async () => {
    const service = new GoogleCloudAuthService({
      clientFactory: () => ({
        auth: {
          getAccessToken: async () => 'token',
          getClient: async () => ({ credentials: {} })
        },
        close: async () => {}
      })
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      authenticated: false,
      error: expect.stringContaining('quota project')
    });
  });
});
