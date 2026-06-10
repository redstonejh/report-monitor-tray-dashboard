const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    name: 'StatusMonitorClient',
    appId: 'com.status-monitor.client',
    asar: true,
    extraResource: ['dashboard'],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'StatusMonitorClient',
        authors: 'Status Monitor',
        setupExe: 'StatusMonitorClient-Setup.exe',
        noMsi: true,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux', 'win32'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          { entry: 'electron/main.js',    config: 'vite.main.config.js',    target: 'main' },
          { entry: 'electron/preload.js', config: 'vite.preload.config.js', target: 'preload' },
          { entry: 'electron/dashboard-preload.js', config: 'vite.preload.config.js', target: 'preload' },
          { entry: 'electron/icons.js',   config: 'vite.main.config.js',    target: 'main' },
        ],
        renderer: [
          { name: 'main_window', config: 'vite.renderer.config.js' },
        ],
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
    }),
  ],
};
