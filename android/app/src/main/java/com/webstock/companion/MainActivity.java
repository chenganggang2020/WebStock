package com.webstock.companion;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URI;

public final class MainActivity extends Activity {
    private static final String PREFS = "webstock_companion";
    private static final String PREF_SERVER = "server_url";
    private static final String PREF_PAIRING_TOKEN = "pairing_token";

    private WebView webView;
    private LinearLayout connectionPanel;
    private EditText serverInput;
    private TextView connectionStatus;
    private ProgressBar progress;
    private String serverUrl = "";
    private boolean connectionFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(17, 25, 35));
        getWindow().setNavigationBarColor(Color.rgb(17, 25, 35));
        setContentView(buildContent());
        configureWebView();

        SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        String saved = preferences.getString(PREF_SERVER, "");
        if (saved == null || saved.isEmpty()) showConnection("");
        else connect(saved);
    }

    private View buildContent() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(244, 246, 249));

        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        root.addView(shell, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(14), 0, dp(6), 0);
        toolbar.setBackgroundColor(Color.rgb(17, 25, 35));
        shell.addView(toolbar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)));

        TextView title = new TextView(this);
        title.setText("WebStock");
        title.setTextColor(Color.WHITE);
        title.setTextSize(18);
        title.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1));

        Button reload = toolbarButton("↻", getString(R.string.reload));
        reload.setOnClickListener(view -> {
            if (webView.getUrl() == null) connect(serverUrl);
            else webView.reload();
        });
        toolbar.addView(reload);

        Button settings = toolbarButton("⚙", getString(R.string.settings));
        settings.setOnClickListener(view -> showConnection(""));
        toolbar.addView(settings);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        shell.addView(progress, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(2)));

        webView = new WebView(this);
        shell.addView(webView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        connectionPanel = buildConnectionPanel();
        FrameLayout.LayoutParams panelParams = new FrameLayout.LayoutParams(
            Math.min(getResources().getDisplayMetrics().widthPixels - dp(32), dp(520)),
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER
        );
        root.addView(connectionPanel, panelParams);
        return root;
    }

    private Button toolbarButton(String symbol, String tooltip) {
        Button button = new Button(this);
        button.setText(symbol);
        button.setTextSize(20);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setTooltipText(tooltip);
        button.setContentDescription(tooltip);
        button.setMinWidth(0);
        button.setMinimumWidth(0);
        button.setPadding(dp(12), 0, dp(12), 0);
        button.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        return button;
    }

    private LinearLayout buildConnectionPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(20), dp(20), dp(20), dp(20));
        panel.setBackgroundColor(Color.WHITE);
        panel.setElevation(dp(8));

        TextView title = new TextView(this);
        title.setText(R.string.connection_title);
        title.setTextColor(Color.rgb(21, 34, 56));
        title.setTextSize(21);
        panel.addView(title);

        TextView help = new TextView(this);
        help.setText(R.string.connection_help);
        help.setTextColor(Color.rgb(96, 112, 134));
        help.setTextSize(14);
        help.setPadding(0, dp(10), 0, dp(12));
        panel.addView(help);

        serverInput = new EditText(this);
        serverInput.setSingleLine(true);
        serverInput.setHint(R.string.connection_hint);
        serverInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        serverInput.setImeOptions(EditorInfo.IME_ACTION_GO);
        panel.addView(serverInput, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(54)));

        Button connect = new Button(this);
        connect.setText(R.string.connect);
        connect.setAllCaps(false);
        connect.setTextColor(Color.WHITE);
        connect.setBackgroundColor(Color.rgb(23, 105, 224));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48));
        buttonParams.topMargin = dp(12);
        panel.addView(connect, buttonParams);

        connectionStatus = new TextView(this);
        connectionStatus.setTextColor(Color.rgb(181, 43, 57));
        connectionStatus.setTextSize(13);
        connectionStatus.setPadding(0, dp(10), 0, 0);
        panel.addView(connectionStatus);

        View.OnClickListener connectAction = view -> connect(serverInput.getText().toString());
        connect.setOnClickListener(connectAction);
        serverInput.setOnEditorActionListener((view, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                connectAction.onClick(view);
                return true;
            }
            return false;
        });
        return panel;
    }

    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString() + " WebStockAndroid/1.0.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progress.setProgress(newProgress);
                progress.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageStarted(WebView popupView, String url, android.graphics.Bitmap favicon) {
                        handlePopup(Uri.parse(url));
                        popupView.stopLoading();
                        popupView.destroy();
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                        handlePopup(request.getUrl());
                        popupView.destroy();
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isServerNavigation(uri)) return false;
                if (isExternalAuth(uri)) {
                    openExternal(uri);
                    return true;
                }
                if ("http".equalsIgnoreCase(uri.getScheme())) {
                    openExternal(uri);
                    return true;
                }
                return !"https".equalsIgnoreCase(uri.getScheme());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (!connectionFailed && url != null && isServerNavigation(Uri.parse(url))) {
                    connectionPanel.setVisibility(View.GONE);
                }
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    connectionFailed = true;
                    showConnection("无法连接 Windows WebStock，请检查地址、防火墙和局域网。");
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, android.webkit.WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() == 401) {
                    connectionFailed = true;
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(PREF_PAIRING_TOKEN).apply();
                    showConnection("配对信息已失效，请重新输入 Windows 端显示的完整配对地址。");
                }
            }
        });
    }

    private void connect(String input) {
        try {
            SharedPreferences preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
            String normalized = ServerAddress.normalize(input);
            String sanitized = ServerAddress.withoutPairingToken(normalized);
            String providedToken = ServerAddress.pairingToken(normalized);
            String savedServer = preferences.getString(PREF_SERVER, "");
            String savedToken = preferences.getString(PREF_PAIRING_TOKEN, "");
            String token = !providedToken.isEmpty()
                ? providedToken
                : (sanitized.equals(savedServer) && savedToken != null ? savedToken : "");
            serverUrl = sanitized;
            connectionFailed = false;
            SharedPreferences.Editor editor = preferences.edit().putString(PREF_SERVER, serverUrl);
            if (token.isEmpty()) editor.remove(PREF_PAIRING_TOKEN);
            else editor.putString(PREF_PAIRING_TOKEN, token);
            editor.apply();
            serverInput.setText(serverUrl);
            connectionStatus.setText("");
            connectionPanel.setVisibility(View.GONE);
            webView.setVisibility(View.VISIBLE);
            progress.setVisibility(View.VISIBLE);
            webView.loadUrl(ServerAddress.withPairingToken(serverUrl, token));
        } catch (IllegalArgumentException error) {
            showConnection(error.getMessage());
        }
    }

    private void showConnection(String message) {
        serverInput.setText(serverUrl);
        connectionStatus.setText(message == null ? "" : message);
        connectionPanel.setVisibility(View.VISIBLE);
        serverInput.requestFocus();
    }

    private boolean isServerNavigation(Uri uri) {
        if (serverUrl.isEmpty() || uri == null || uri.getHost() == null) return false;
        try {
            URI server = new URI(serverUrl);
            int serverPort = server.getPort() == -1 ? ("https".equals(server.getScheme()) ? 443 : 80) : server.getPort();
            int targetPort = uri.getPort() == -1 ? ("https".equals(uri.getScheme()) ? 443 : 80) : uri.getPort();
            return server.getScheme().equalsIgnoreCase(uri.getScheme()) &&
                server.getHost().equalsIgnoreCase(uri.getHost()) && serverPort == targetPort;
        } catch (Exception error) {
            return false;
        }
    }

    private void openExternal(Uri uri) {
        if (uri == null || !("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, "未找到可打开该链接的应用", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean isExternalAuth(Uri uri) {
        String host = uri == null || uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        return host.equals("chatgpt.com") || host.endsWith(".chatgpt.com") ||
            host.equals("openai.com") || host.endsWith(".openai.com") ||
            host.equals("accounts.google.com");
    }

    private void handlePopup(Uri uri) {
        if (uri == null) return;
        if (isExternalAuth(uri)) openExternal(uri);
        else if ("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) webView.loadUrl(uri.toString());
    }

    @Override
    public void onBackPressed() {
        if (connectionPanel.getVisibility() == View.VISIBLE) {
            connectionPanel.setVisibility(View.GONE);
            return;
        }
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
