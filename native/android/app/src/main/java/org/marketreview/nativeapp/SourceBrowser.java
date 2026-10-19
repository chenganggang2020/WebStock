package org.marketreview.nativeapp;

import android.net.http.SslError;
import android.os.Build;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import org.json.JSONObject;

/**
 * Restricted official source session only. No JavascriptInterface and no
 * native business UI.
 */
final class SourceBrowser extends FrameLayout implements AutoCloseable {
  interface Listener {
    void loaded(String url);
    void captured(JSONObject page);
    void error(String message);
  }
  static Boolean processTesting;
  final WebView view;
  final Listener listener;
  final String mobileAgent;
  String ready = "", target = "", script;
  long generation;
  boolean failed, closed;
  SourceBrowser(MainActivity owner, Listener listener) {
    super(owner);
    this.listener = listener;
    if (processTesting == null) {
      if (Build.VERSION.SDK_INT >= 28)
        WebView.setDataDirectorySuffix(owner.testing ? "source-review-tests"
                                                     : "source-session-v1");
      processTesting = owner.testing;
    }
    BusinessStore.require(processTesting == owner.testing,
                          "来源会话模式不一致，请关闭重开");
    view = new WebView(owner);
    addView(view, new LayoutParams(-1, -1));
    WebSettings settings = view.getSettings();
    mobileAgent = settings.getUserAgentString();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(view, false);
    view.setDownloadListener(
        (url, ua, disposition, type,
         length) -> failure("网页下载未执行；请使用已核验作品的本机采集按钮"));
    view.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(PermissionRequest request) {
        request.deny();
      }
      @Override
      public void onGeolocationPermissionsShowPrompt(
          String origin, GeolocationPermissions.Callback cb) {
        cb.invoke(origin, false, false);
      }
      @Override
      public boolean onShowFileChooser(
          WebView v, ValueCallback<android.net.Uri[]> cb, FileChooserParams p) {
        cb.onReceiveValue(null);
        return true;
      }
      @Override
      public boolean onJsAlert(WebView v, String u, String m, JsResult r) {
        r.cancel();
        return true;
      }
      @Override
      public boolean onJsConfirm(WebView v, String u, String m, JsResult r) {
        r.cancel();
        return true;
      }
      @Override
      public boolean onJsPrompt(WebView v, String u, String m, String d,
                                JsPromptResult r) {
        r.cancel();
        return true;
      }
    });
    view.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v,
                                              WebResourceRequest request) {
        if (closed)
          return true;
        if (SourceCapture.allowed(request.getUrl().toString()))
          return false;
        if (request.isForMainFrame())
          failure("已阻止未允许的来源跳转（" + request.getUrl().getScheme() +
                  "://" + request.getUrl().getHost() + "）；未打开外部应用");
        return true;
      }
      @Override
      public void onPageStarted(WebView v, String url,
                                android.graphics.Bitmap icon) {
        if (closed || !url.equals(v.getUrl()))
          return;
        target = url;
        generation++;
        ready = "";
        failed = false;
        if (!SourceCapture.allowed(url))
          failure("来源URL不在允许范围");
      }
      @Override
      public void onPageFinished(WebView v, String url) {
        if (closed || failed || !SourceCapture.allowed(url) ||
            !url.equals(v.getUrl()) || !url.equals(target))
          return;
        ready = url;
        listener.loaded(url);
      }
      @Override
      public void onReceivedError(WebView v, WebResourceRequest request,
                                  WebResourceError error) {
        if (current(request))
          failure("官方来源加载失败（" + error.getErrorCode() +
                  "），未记录零作品成功");
      }
      @Override
      public void onReceivedHttpError(WebView v, WebResourceRequest request,
                                      WebResourceResponse response) {
        if (current(request))
          failure("官方来源HTTP " + response.getStatusCode() +
                  "；请检查会话和网络");
      }
      @Override
      public void onReceivedSslError(WebView v, SslErrorHandler handler,
                                     SslError error) {
        handler.cancel();
        if (!closed && target.equals(error.getUrl()))
          failure("来源TLS证书验证未通过，已停止");
      }
    });
  }
  void desktopSite(boolean enabled) {
    stop();
    WebSettings settings = view.getSettings();
    settings.setUserAgentString(
        enabled ? mobileAgent.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
                      .replace(" Mobile", "")
                : mobileAgent);
    settings.setUseWideViewPort(enabled);
    settings.setLoadWithOverviewMode(enabled);
    settings.setSupportZoom(true);
    settings.setBuiltInZoomControls(true);
    settings.setDisplayZoomControls(false);
  }
  boolean current(WebResourceRequest request) {
    return !closed && request.isForMainFrame() &&
        request.getUrl().toString().equals(target);
  }
  void failure(String message) {
    if (closed)
      return;
    failed = true;
    stop();
    listener.error(message);
  }
  void navigate(String url) {
    BusinessStore.require(!closed && SourceCapture.allowed(url),
                          "仅支持抖音官方HTTPS来源页");
    stop();
    target = url;
    failed = false;
    view.loadUrl(url);
  }
  void capture() {
    BusinessStore.require(!closed && !ready.isEmpty() &&
                              ready.equals(view.getUrl()),
                          "页面尚未加载完成");
    long run = generation;
    String url = ready;
    try {
      if (script == null)
        try (InputStream in =
                 getContext().getAssets().open("douyin-snapshot.js");
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
          byte[] bytes = new byte[8192];
          int n;
          while ((n = in.read(bytes)) != -1) {
            out.write(bytes, 0, n);
            if (out.size() > 2000000)
              throw new IOException("来源脚本过大");
          }
          script = out.toString("UTF-8");
        }
      view.evaluateJavascript(script, raw -> {
        if (closed || run != generation || !url.equals(ready) ||
            !url.equals(view.getUrl()))
          return;
        try {
          BusinessStore.require(raw != null && raw.length() <= 2000000,
                                "来源快照过大或为空");
          JSONObject page = new JSONObject(raw);
          BusinessStore.require(page.optString("pageUrl").equals(url),
                                "读取期间来源已改变");
          listener.captured(page);
        } catch (Exception e) {
          failure("来源读取失败：" + e.getMessage());
        }
      });
    } catch (Exception e) {
      failure("来源脚本读取失败：" + e.getMessage());
    }
  }
  void stop() {
    generation++;
    ready = "";
    target = "";
    if (!closed)
      view.stopLoading();
  }
  public void close() {
    if (closed)
      return;
    stop();
    closed = true;
    removeView(view);
    view.destroy();
  }
}
