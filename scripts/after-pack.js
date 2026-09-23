const path = require('path');
const { rcedit } = require('rcedit');

module.exports = async function applyWindowsResources(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (process.env.WEBSTOCK_SKIP_EXTRA_RCEDIT === '1') return;

  const appInfo = context.packager.appInfo;
  const executable = path.join(context.appOutDir, appInfo.productFilename + '.exe');
  const icon = path.join(context.packager.projectDir, 'icons', 'webstock.ico');

  await rcedit(executable, {
    'version-string': {
      CompanyName: 'chenganggang2020',
      FileDescription: appInfo.productName,
      InternalName: appInfo.productFilename,
      OriginalFilename: appInfo.productFilename + '.exe',
      ProductName: appInfo.productName
    },
    'file-version': appInfo.shortVersion || appInfo.buildVersion,
    'product-version': appInfo.shortVersionWindows || appInfo.getVersionInWeirdWindowsForm(),
    icon,
    'requested-execution-level': 'asInvoker'
  });
};
