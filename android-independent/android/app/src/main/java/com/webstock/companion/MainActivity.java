package com.webstock.companion;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.view.View;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.work.WorkManager;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends ComponentActivity {
    private static final String HOST="appassets.androidplatform.net";
    private WebView web;
    private FrameLayout root;
    private StandaloneBackend backend;
    private final ExecutorService executor=Executors.newFixedThreadPool(3);
    private final ExecutorService localExecutor=Executors.newSingleThreadExecutor();
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        // An in-place upgrade must cancel former companion jobs instead of contacting a PC.
        WorkManager.getInstance(this).cancelAllWork();
        backend=new StandaloneBackend(this); web=new WebView(this); web.setBackgroundColor(Color.rgb(244,246,249));
        root=new FrameLayout(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        root.setOnApplyWindowInsetsListener((view,insets)->{
            FrameLayout.LayoutParams layout=(FrameLayout.LayoutParams)web.getLayoutParams();
            if(Build.VERSION.SDK_INT>=30) {android.graphics.Insets safe=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout()|android.view.WindowInsets.Type.ime());layout.setMargins(safe.left,safe.top,safe.right,safe.bottom);}
            else layout.setMargins(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            web.setLayoutParams(layout);
            return insets;
        });
        setContentView(root);applyTheme(false);root.requestApplyInsets();
        web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void theme(boolean dark) {runOnUiThread(()->{if(!isDestroyed())applyTheme(dark);});}
            @JavascriptInterface public void request(String id,String payload) {
                if(id==null || !id.matches("[0-9]{1,15}") || payload==null || payload.length()>8*1024*1024) return;
                String address;
                try {address=new JSONObject(payload).optString("path");} catch(Exception invalid) {address="";}
                (StandaloneRequests.isLocal(address)?localExecutor:executor).execute(()->{
                    String answer;
                    try {JSONObject request=new JSONObject(payload);JSONObject data=backend.request(request.optString("method","GET"),request.getString("path"),request.optJSONObject("body")==null?new JSONObject():request.getJSONObject("body"));answer=StandaloneCore.success(data).toString();}
                    catch(Exception error) {try {answer=StandaloneCore.failure(StandaloneCore.friendlyError(error)).toString();} catch(Exception impossible) {return;}}
                    String script="window.WebStockNativeDone("+JSONObject.quote(id)+","+JSONObject.quote(answer)+")";
                    runOnUiThread(()->{if(!isDestroyed()) web.evaluateJavascript(script,null);});
                });
            }
        },"WebStockNative");
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public void save(String mime,String encoded) {
                if(encoded==null || encoded.length()>14_000_000) {runOnUiThread(()->Toast.makeText(MainActivity.this,"单次导出上限为 10 MB",Toast.LENGTH_LONG).show());return;}
                runOnUiThread(()->{
                    try {
                        pendingExport=Base64.decode(encoded,Base64.DEFAULT);if(pendingExport.length>10*1024*1024) throw new IllegalArgumentException();
                        String type=mime!=null && mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")?mime:"application/octet-stream";
                        Intent create=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type);
                        create.putExtra(Intent.EXTRA_TITLE,"webstock-android-"+System.currentTimeMillis()+(type.contains("json")?".json":type.contains("csv")?".csv":".txt"));startActivityForResult(create,2003);
                    } catch(Exception error) {pendingExport=null;Toast.makeText(MainActivity.this,"无法打开文件保存窗口",Toast.LENGTH_LONG).show();}
                });
            }
        },"WebStockExport");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView view,String url,String message,android.webkit.JsResult result) {
                new android.app.AlertDialog.Builder(MainActivity.this).setTitle("确认操作").setMessage(message)
                    .setPositiveButton("确认",(dialog,which)->result.confirm()).setNegativeButton("取消",(dialog,which)->result.cancel())
                    .setOnCancelListener(dialog->result.cancel()).show();return true;
            }
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params) {
                if(fileCallback!=null) fileCallback.onReceiveValue(null);fileCallback=callback;
                try {startActivityForResult(params.createIntent(),2002);} catch(Exception error) {callback.onReceiveValue(null);fileCallback=null;}return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();if(!HOST.equals(uri.getHost()) || !"https".equals(uri.getScheme())) return response(403,"text/plain",new byte[0]);
                String path=uri.getPath();if(path==null || path.equals("/")) path="/index.html";
                if(path.contains("..") || !path.matches("^/(index\\.html|app(?:-flow)?\\.js|chart-model\\.js|phone-charts\\.js|shared/(indicators|marketSignalModel|sequentialSignalModel|auctionRules)\\.js|(?:app|chart-ui|flow)\\.css|stocks\\.json|funds\\.json|vendor/(echarts\\.min|tiny-pinyin)\\.js)$")) return response(404,"text/plain",new byte[0]);
                try {String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".json")?"application/json":"text/html";
                    return new WebResourceResponse(mime,"UTF-8",getAssets().open("web"+path));
                } catch(Exception error) {return response(404,"text/plain",new byte[0]);}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();if(HOST.equals(uri.getHost()) && "/index.html".equals(uri.getPath())) return false;
                if("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) try {startActivity(new Intent(Intent.ACTION_VIEW,uri));} catch(Exception ignored) {}
                return true;
            }
        });
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {web.evaluateJavascript("window.WebStockPhoneBack?WebStockPhoneBack():false",value->{if(!"true".equals(value)) finish();});}
        });
        web.loadUrl("https://"+HOST+"/index.html");
    }
    private WebResourceResponse response(int status,String mime,byte[] bytes) {return new WebResourceResponse(mime,"UTF-8",status,status==403?"Forbidden":"Not Found",Collections.emptyMap(),new ByteArrayInputStream(bytes));}
    private void applyTheme(boolean dark) {
        root.setBackgroundColor(dark?Color.rgb(14,22,34):Color.WHITE);
        if(Build.VERSION.SDK_INT>=30) {android.view.WindowInsetsController controller=getWindow().getInsetsController();if(controller!=null){int flags=android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;controller.setSystemBarsAppearance(dark?0:flags,flags);}}
        else {int flags=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;View decor=getWindow().getDecorView();decor.setSystemUiVisibility((decor.getSystemUiVisibility()&~flags)|(dark?0:flags));}
    }
    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==2002 && fileCallback!=null) {fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileCallback=null;}
        if(request==2003 && pendingExport!=null) {
            byte[] bytes=pendingExport;pendingExport=null;
            if(result==Activity.RESULT_OK && data!=null && data.getData()!=null) {
                Uri target=data.getData();executor.execute(()->{
                    try(java.io.OutputStream output=getContentResolver().openOutputStream(target,"wt")) {if(output==null) throw new java.io.IOException();output.write(bytes);runOnUiThread(()->Toast.makeText(this,"文件已保存",Toast.LENGTH_SHORT).show());}
                    catch(Exception error) {runOnUiThread(()->Toast.makeText(this,"文件保存失败",Toast.LENGTH_LONG).show());}
                });
            }
        }
    }
    @Override protected void onDestroy() {executor.shutdownNow();localExecutor.shutdownNow();if(fileCallback!=null) fileCallback.onReceiveValue(null);if(web!=null) web.destroy();super.onDestroy();}
}
