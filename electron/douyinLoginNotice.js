// One native notice per shared-session failure episode, not per author or poll.
function createDouyinLoginNotice({ dialog, getParentWindow = () => null, openLogin, log = () => {} }) {
  let needsLogin = false, showing = false, disposed = false;
  async function handle(state) {
    if (disposed || !state) return;
    if (state.status === 'authenticated') { needsLogin = false; return; }
    if (state.status !== 'login_required' || needsLogin) return;
    needsLogin = true;
    if (showing) return;
    showing = true;
    try {
      const options = {
        type: 'warning', title: '采集登录需要更新',
        message: '抖音采集登录已失效或需要验证',
        detail: '在线采集暂时受阻，已有资料仍保留。请打开登录窗口，亲自完成登录或验证码；稍后也可从“采集 → 登录 / 检查账号”进入。',
        buttons: ['去登录', '稍后'], defaultId: 0, cancelId: 1, noLink: true
      };
      const parent = getParentWindow();
      const result = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (result.response === 0 && needsLogin && !disposed) await openLogin();
    } catch (error) {
      needsLogin = false;
      log('Douyin login notice failed', error);
    } finally { showing = false; }
  }
  return { handle, dispose() { disposed = true; } };
}

module.exports = { createDouyinLoginNotice };
