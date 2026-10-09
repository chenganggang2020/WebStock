package com.webstock.companion;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Runs only in the separate instrumentation APK on an isolated emulator. */
public final class StandaloneSmokeInstrumentation extends Instrumentation {
    private final JSONArray checks=new JSONArray();
    private WebView web;
    private String mode="smoke";
    private interface Checked {void run() throws Exception;}
    private void check(String name,Checked test) throws Exception {
        JSONObject row=new JSONObject().put("name",name);
        try {test.run();row.put("pass",true);}catch(Throwable error){row.put("pass",false).put("error",String.valueOf(error));}
        checks.put(row);
    }
    private static void require(boolean value) {if(!value)throw new AssertionError("condition failed");}
    private static JSONObject item(String json) throws Exception {return new JSONObject(json);}
    private String js(String script) throws Exception {
        CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> answer=new AtomicReference<>();
        runOnMainSync(()->web.evaluateJavascript(script,value->{answer.set(value);latch.countDown();}));
        if(!latch.await(15,TimeUnit.SECONDS))throw new AssertionError("WebView callback timeout");return answer.get();
    }
    private void awaitJs(String condition) throws Exception {
        long until=System.currentTimeMillis()+20000;
        while(System.currentTimeMillis()<until){if("true".equals(js(condition)))return;Thread.sleep(100);}
        throw new AssertionError("UI condition timeout: "+condition);
    }
    @Override public void onCreate(Bundle arguments){super.onCreate(arguments);if(arguments!=null)mode=arguments.getString("mode","smoke");start();}
    @Override public void onStart() {
        Bundle result=new Bundle();String dbName="standalone-instrumentation.db";
        try {
            if(mode.equals("seed211")){seed211();return;}
            if(mode.equals("network220")){network220Audit();return;}
            if(mode.equals("upgrade220")){upgrade220Audit();return;}
            if(!mode.equals("smoke")){chartAudit();return;}
            getTargetContext().deleteDatabase(dbName);
            StandaloneStore store=new StandaloneStore(getTargetContext(),dbName);
            check("empty-independent-database",()->require(store.state().getString("mode").equals("independent")&&store.read("watch").length()==0));
            check("watch-persists",()->{store.save("watch",item("{\"id\":\"qa-watch\",\"code\":\"000001\",\"name\":\"平安银行\",\"group\":\"银行\"}"));require(store.read("watch").length()==1);});
            check("duplicate-watch-rejected",()->{try{store.save("watch",item("{\"code\":\"000001\",\"group\":\"银行\"}"));throw new AssertionError("duplicate accepted");}catch(IllegalArgumentException expected){}require(store.read("watch").length()==1);});
            check("ledger-fees-and-account-isolation",()->{store.save("accounts",item("{\"id\":\"second\",\"name\":\"另一个账户\"}"));store.save("trades",item("{\"id\":\"buy\",\"accountId\":\"local\",\"code\":\"000001\",\"date\":\"2026-09-29\",\"side\":\"buy\",\"quantity\":100,\"price\":10,\"fee\":5}"));require(StandaloneCore.ledger(store.read("trades"),new JSONObject(),"local").getDouble("cost")==1005);require(StandaloneCore.ledger(store.read("trades"),new JSONObject(),"second").getJSONArray("positions").length()==0);});
            check("oversell-rolls-back",()->{try{store.save("trades",item("{\"id\":\"bad\",\"accountId\":\"local\",\"code\":\"000001\",\"date\":\"2026-09-30\",\"side\":\"sell\",\"quantity\":101,\"price\":11,\"fee\":0}"));throw new AssertionError("oversell accepted");}catch(IllegalArgumentException expected){}require(store.read("trades").length()==1);});
            check("sell-and-invalid-delete-rollback",()->{store.save("trades",item("{\"id\":\"sell\",\"accountId\":\"local\",\"code\":\"000001\",\"date\":\"2026-09-30\",\"side\":\"sell\",\"quantity\":40,\"price\":12,\"fee\":2}"));try{store.remove("trades","buy");throw new AssertionError("invalid history accepted");}catch(IllegalArgumentException expected){}require(store.read("trades").length()==2);});
            check("import-is-atomic",()->{JSONObject backup=store.backup();backup.getJSONArray("watch").put(item("{\"id\":\"new\",\"code\":\"000002\",\"group\":\"其他\"}")).put(item("{\"id\":\"invalid\",\"code\":\"garbage\",\"group\":\"其他\"}"));try{store.importBackup(backup);throw new AssertionError("invalid import accepted");}catch(IllegalArgumentException expected){}require(store.read("watch").length()==1);});
            check("valid-backup-merge-validates-final-ledger",()->{JSONObject backup=store.backup();backup.getJSONArray("trades").getJSONObject(0).put("quantity",30);backup.getJSONArray("trades").getJSONObject(1).put("quantity",20);store.importBackup(backup);require(StandaloneCore.ledger(store.read("trades"),new JSONObject(),"local").getJSONArray("positions").getJSONObject(0).getInt("quantity")==10);});
            check("recent-reopened-moves-to-end",()->{store.save("recent",item("{\"id\":\"000001\",\"code\":\"000001\"}"));store.save("recent",item("{\"id\":\"000002\",\"code\":\"000002\"}"));store.save("recent",item("{\"id\":\"000001\",\"code\":\"000001\"}"));require(store.read("recent").getJSONObject(1).getString("code").equals("000001"));});
            check("backup-excludes-keys-and-cache",()->{JSONObject backup=store.backup();require(!backup.has("key")&&!backup.has("settings")&&!backup.has("recent")&&!backup.has("quotes"));});
            store.close();StandaloneStore reopened=new StandaloneStore(getTargetContext(),dbName);
            check("sqlite-survives-close-reopen",()->require(reopened.read("watch").length()==1&&reopened.read("trades").length()==2));reopened.close();
            StandaloneSecret secret=new StandaloneSecret(getTargetContext());
            check("android-keystore-encryption",()->{secret.save("qa-test-key");require(secret.hasKey()&&secret.read().equals("qa-test-key"));String saved=getTargetContext().getSharedPreferences("independent-secrets",0).getAll().toString();require(!saved.contains("qa-test-key"));secret.save("");require(!secret.hasKey());});
            StandaloneBackend backend=new StandaloneBackend(getTargetContext());
            check("no-computer-configuration",()->{require(backend.request("GET","/state",new JSONObject()).getString("mode").equals("independent"));require(!backend.request("GET","/settings",new JSONObject()).has("serverUrl"));});
            check("unmigrated-api-is-explicit-error",()->{try{backend.request("GET","/auction",new JSONObject());throw new AssertionError("fake success");}catch(IllegalArgumentException expected){require(expected.getMessage().contains("尚未迁移"));}});
            Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
            check("packaged-ui-boots-with-local-bridge",()->awaitJs("!!window.StandaloneApp && StandaloneApp.getState().accounts.length>0"));
            check("webview-avoids-system-bars",()->{AtomicReference<Boolean> safe=new AtomicReference<>(false);runOnMainSync(()->{android.widget.FrameLayout.LayoutParams layout=(android.widget.FrameLayout.LayoutParams)web.getLayoutParams();safe.set(layout.topMargin>0&&layout.bottomMargin>0);});require(safe.get());});
            check("native-watch-form",()->{js("StandaloneApp.navigate('watch');document.querySelector('[data-action=add-watch]').click();document.querySelector('#f-code').value='000001';document.querySelector('#f-group').value='QA本机';document.querySelector('#editForm [type=submit]').click();");awaitJs("!document.querySelector('#editor').open && StandaloneApp.getState().watch.some(r=>r.group==='QA本机')");});
            check("native-document-form",()->{js("StandaloneApp.navigate('docs');document.querySelector('[data-action=add-doc]').click();document.querySelector('#f-title').value='QA研究资料';document.querySelector('textarea[name=text]').value='来源待核验';document.querySelector('#editForm [type=submit]').click();");awaitJs("!document.querySelector('#editor').open && StandaloneApp.getState().docs.some(r=>r.title==='QA研究资料')");});
            check("native-trade-form",()->{js("StandaloneApp.navigate('trades');document.querySelector('[data-action=add-trade]').click();document.querySelector('#f-code').value='000001';document.querySelector('#f-date').value='2026-09-29';document.querySelector('#f-quantity').value='100';document.querySelector('#f-price').value='10';document.querySelector('#f-fee').value='5';document.querySelector('#editForm [type=submit]').click();");awaitJs("!document.querySelector('#editor').open && StandaloneApp.getState().trades.length===1");});
            check("native-oversell-form-keeps-data",()->{js("document.querySelector('[data-action=add-trade]').click();document.querySelector('#f-code').value='000001';document.querySelector('#f-date').value='2026-09-30';document.querySelector('[name=side]').value='sell';document.querySelector('#f-quantity').value='101';document.querySelector('#f-price').value='12';document.querySelector('#editForm [type=submit]').click();");awaitJs("document.querySelector('.form-error').textContent.includes('超过') && StandaloneApp.getState().trades.length===1");js("document.querySelector('[data-close]').click()");});
            check("independent-real-quote-request",()->{JSONObject response=backend.request("GET","/quotes?symbols=sz000001,sh000001",new JSONObject());JSONObject quote=response.getJSONObject("quotes").getJSONObject("sz000001");require(quote.getDouble("price")>0&&quote.getString("tradeDate").matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")&&!quote.optBoolean("cached"));});
            check("independent-real-kline-request",()->require(backend.request("GET","/kline?code=000001&period=day",new JSONObject()).getJSONArray("rows").length()>10));
            check("independent-real-minute-request",()->require(backend.request("GET","/minute?code=000001",new JSONObject()).getJSONArray("rows").length()>10));
            check("independent-real-news-request",()->require(backend.request("GET","/news",new JSONObject()).getJSONArray("rows").length()>0));
            int passed=0;for(int i=0;i<checks.length();i++)if(checks.getJSONObject(i).getBoolean("pass"))passed++;
            result.putString("summary",new JSONObject().put("checks",checks).put("pass",passed).put("total",checks.length()).toString());
            finish(passed==checks.length()?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
        }catch(Throwable error){result.putString("fatal",String.valueOf(error));result.putString("checks",checks.toString());finish(Activity.RESULT_CANCELED,result);}
        finally {getTargetContext().deleteDatabase(dbName);}
    }
    private void capture(String name) throws Exception {
        android.graphics.Bitmap bitmap=getUiAutomation().takeScreenshot();
        java.io.File file=new java.io.File(getTargetContext().getExternalFilesDir(null),name+".png");
        try(java.io.FileOutputStream stream=new java.io.FileOutputStream(file)){bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,stream);}bitmap.recycle();
    }
    private void seed211() throws Exception {
        require(android.os.Build.FINGERPRINT.contains("generic") || android.os.Build.MODEL.contains("sdk_gphone"));
        StandaloneBackend backend=new StandaloneBackend(getTargetContext());
        require(backend.request("GET","/state",new JSONObject()).getString("version").equals("2.1.1"));
        JSONObject original=backend.request("GET","/backup",new JSONObject());
        for(String key:new String[]{"watch","trades","docs","reports"})require(original.getJSONArray(key).length()==0);
        String[][] records={
            {"watch","{\"id\":\"qa-upgrade-watch\",\"code\":\"000001\",\"name\":\"平安银行\",\"group\":\"QA升级保留\"}"},
            {"trades","{\"id\":\"qa-upgrade-trade\",\"accountId\":\"local\",\"code\":\"000001\",\"date\":\"2026-09-29\",\"side\":\"buy\",\"quantity\":100,\"price\":10,\"fee\":5}"},
            {"docs","{\"id\":\"qa-upgrade-doc\",\"title\":\"QA升级资料\",\"text\":\"仅用于独立模拟器测试，非真实研究或持仓。\"}"},
            {"reports","{\"id\":\"qa-upgrade-report\",\"title\":\"QA升级报告\",\"text\":\"覆盖升级必须保留此测试记录。\"}"}
        };
        for(String[] record:records)backend.request("POST","/record",new JSONObject().put("kind",record[0]).put("item",item(record[1])));
        Bundle result=new Bundle();result.putString("summary","Seeded isolated empty emulator with four QA records on version 2.1.1; no production data.");finish(Activity.RESULT_OK,result);
    }
    private void network220Audit() throws Exception {
        StandaloneBackend backend=new StandaloneBackend(getTargetContext());
        JSONObject now=backend.request("GET","/kline?code=000001&period=day",new JSONObject());
        JSONObject report=new JSONObject(now.toString());report.remove("rows");report.put("rowCount",now.optJSONArray("rows")==null?0:now.getJSONArray("rows").length());
        if(!now.optBoolean("stale")&&now.getJSONArray("rows").length()>15){String before=now.getJSONArray("rows").getJSONObject(15).getString("date");JSONObject old=backend.request("GET","/kline-history?code=000001&period=day&before="+before,new JSONObject());JSONObject page=new JSONObject(old.toString());page.remove("rows");page.put("rowCount",old.getJSONArray("rows").length()).put("first",old.getJSONArray("rows").getJSONObject(0).getString("date")).put("last",old.getJSONArray("rows").getJSONObject(old.getJSONArray("rows").length()-1).getString("date"));report.put("history",page);}
        Bundle result=new Bundle();result.putString("summary",report.toString());finish(now.optBoolean("stale")?Activity.RESULT_CANCELED:Activity.RESULT_OK,result);
    }
    private void upgrade220Audit() throws Exception {
        StandaloneBackend backend=new StandaloneBackend(getTargetContext());
        java.io.File before=new java.io.File(getTargetContext().getFilesDir(),"qa-upgrade-before.json");
        check("upgrade-211-to-220-preserves-qa-records",()->{
            JSONObject old=new JSONObject(new String(java.nio.file.Files.readAllBytes(before.toPath()),java.nio.charset.StandardCharsets.UTF_8));
            JSONObject now=backend.request("GET","/backup",new JSONObject());
            for(String key:new String[]{"watch","accounts","trades","docs","reports"})require(old.getJSONArray(key).toString().equals(now.getJSONArray(key).toString()));
        });
        check("native-version-is-220",()->require(backend.request("GET","/state",new JSONObject()).getString("version").equals("2.2.0")));
        Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
        check("new-packaged-chart-engine-loads",()->awaitJs("!!window.SequentialSignalModel && !!window.PhoneChartModel && !!window.StandaloneApp && StandaloneApp.getState().accounts.length>0"));
        AtomicReference<JSONObject> fresh=new AtomicReference<>();
        check("actual-public-daily-bars-not-cache",()->{JSONObject value=backend.request("GET","/kline?code=000001&period=day",new JSONObject());require(!value.optBoolean("stale")&&value.getJSONArray("rows").length()>180);fresh.set(value);JSONObject proof=new JSONObject().put("source",value.getString("source")).put("adjustment",value.getString("adjustment")).put("checkedAt",value.getString("checkedAt")).put("count",value.getJSONArray("rows").length()).put("first",value.getJSONArray("rows").getJSONObject(0).getString("date")).put("last",value.getJSONArray("rows").getJSONObject(value.getJSONArray("rows").length()-1).getString("date"));checks.put(new JSONObject().put("name","public-daily-evidence").put("pass",true).put("evidence",proof));});
        check("actual-public-history-page-merges",()->{JSONObject current=fresh.get();require(current!=null);String end=current.getJSONArray("rows").getJSONObject(15).getString("date");JSONObject older=backend.request("GET","/kline-history?code=000001&period=day&before="+end,new JSONObject());require(!older.optBoolean("stale"));String expression="PhoneChartModel.mergeHistory("+current.toString()+","+older.toString()+").rows.length>"+current.getJSONArray("rows").length();require("true".equals(js(expression)));});
        js("StandaloneApp.navigate('watch');document.querySelector('[data-stock=\\\"000001\\\"]').click()");
        check("actual-native-chart-renders",()->awaitJs("!!document.querySelector('#chart') && !!echarts.getInstanceByDom(document.querySelector('#chart')) && echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].data.length>180"));
        check("quote-refresh-preserves-native-chart-instance",()->{js("window.__qaInstance=echarts.getInstanceByDom(document.querySelector('#chart'));document.querySelector('#refresh').click()");Thread.sleep(1200);require("true".equals(js("window.__qaInstance===echarts.getInstanceByDom(document.querySelector('#chart'))")));});
        check("native-disk-cache-bypasses-blocked-network-workers",()->{
            java.lang.reflect.Field workers=MainActivity.class.getDeclaredField("executor");workers.setAccessible(true);
            java.util.concurrent.ExecutorService queue=(java.util.concurrent.ExecutorService)workers.get(activity);
            CountDownLatch started=new CountDownLatch(3),release=new CountDownLatch(1);
            for(int i=0;i<3;i++)queue.execute(()->{started.countDown();try{release.await(25,TimeUnit.SECONDS);}catch(InterruptedException ignored){Thread.currentThread().interrupt();}});
            try{require(started.await(20,TimeUnit.SECONDS));js("window.__qaCache=null;StandaloneApp.call('/chart-cache?code=000001&type=kline&period=day').then(v=>window.__qaCache=v).catch(e=>window.__qaCache={error:e.message})");long start=System.nanoTime();awaitJs("!!window.__qaCache");require((System.nanoTime()-start)/1000000<2500);require("true".equals(js("window.__qaCache.available && window.__qaCache.rows.length>180")));}finally{release.countDown();}
        });
        check("native-signal-dialog-back-closes-it",()->{js("if(document.querySelector('[data-action=chart-nine]').getAttribute('aria-pressed')!=='true')document.querySelector('[data-action=chart-nine]').click()");awaitJs("!!document.querySelector('.signal-explain')");js("document.querySelector('.signal-explain').click()");awaitJs("document.querySelector('#chartSignalDialog').open");require("true".equals(js("WebStockPhoneBack() && !document.querySelector('#chartSignalDialog').open && document.body.dataset.page==='stock'")));});
        js("document.querySelector('[data-action=expand-chart]').click()");
        awaitJs("document.body.classList.contains('chart-expanded') && document.querySelector('#chart').clientHeight>150");Thread.sleep(500);capture("upgrade220-kline");
        runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));Thread.sleep(1400);
        check("native-landscape-chart-fits",()->awaitJs("innerWidth>innerHeight && document.documentElement.scrollWidth<=innerWidth && document.querySelector('#chart').clientHeight>140 && Math.abs(echarts.getInstanceByDom(document.querySelector('#chart')).getHeight()-document.querySelector('#chart').clientHeight)<=1"));Thread.sleep(500);capture("upgrade220-landscape");
        runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
        int passed=0;for(int i=0;i<checks.length();i++)if(checks.getJSONObject(i).getBoolean("pass"))passed++;
        Bundle result=new Bundle();result.putString("summary",new JSONObject().put("checks",checks).put("pass",passed).put("total",checks.length()).toString());finish(passed==checks.length()?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
    }
    private void chartAudit() throws Exception {
        StandaloneBackend backend=new StandaloneBackend(getTargetContext());
        java.io.File before=new java.io.File(getTargetContext().getFilesDir(),"qa-upgrade-before.json");
        if(mode.equals("before-upgrade")){
            JSONObject backup=backend.request("GET","/backup",new JSONObject());
            require(backup.getJSONArray("watch").length()>0&&backup.getJSONArray("trades").length()>0&&backup.getJSONArray("docs").length()>0);
            java.nio.file.Files.write(before.toPath(),backup.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
            Bundle result=new Bundle();result.putString("summary","Saved independent records before upgrade; version="+backend.request("GET","/state",new JSONObject()).getString("version"));finish(Activity.RESULT_OK,result);return;
        }
        check("upgrade-retains-records",()->{JSONObject old=new JSONObject(new String(java.nio.file.Files.readAllBytes(before.toPath()),java.nio.charset.StandardCharsets.UTF_8)),now=backend.request("GET","/backup",new JSONObject());for(String key:new String[]{"watch","accounts","trades","docs","reports"})require(old.getJSONArray(key).toString().equals(now.getJSONArray(key).toString()));});
        check("version-is-2.1.1",()->require(backend.request("GET","/state",new JSONObject()).getString("version").equals("2.1.1")));
        Activity activity=startActivitySync(new Intent(getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        java.lang.reflect.Field field=MainActivity.class.getDeclaredField("web");field.setAccessible(true);web=(WebView)field.get(activity);
        check("packaged-shared-chart-scripts-load",()->awaitJs("!!window.PhoneChartModel && !!window.PhoneCharts && !!window.StandaloneApp && StandaloneApp.getState().accounts.length>0"));
        js("StandaloneApp.navigate('watch');document.querySelector('[data-stock=\\\"000001\\\"]').click()");
        check("native-candles-macd-volume",()->{awaitJs("!!document.querySelector('#chart') && !!echarts.getInstanceByDom(document.querySelector('#chart'))");require("true".equals(js("(()=>{const o=echarts.getInstanceByDom(document.querySelector('#chart')).getOption();return o.series[0].type==='candlestick'&&o.series[0].data.length>180&&o.series.some(s=>s.name==='MACD柱')&&o.series.some(s=>s.name==='成交量(手)')})()")));});
        if(mode.equals("offline"))check("offline-chart-labels-cache",()->awaitJs("document.querySelector('#chartSource').textContent.includes('缓存')"));
        check("native-zoom-survives-theme",()->{js("echarts.getInstanceByDom(document.querySelector('#chart')).dispatchAction({type:'dataZoom',start:60,end:90});document.querySelector('#theme').click()");require("true".equals(js("echarts.getInstanceByDom(document.querySelector('#chart')).getOption().dataZoom[0].start===60")));});
        check("native-kdj-control",()->{js("const select=document.querySelector('#indicator');select.value='kdj';select.dispatchEvent(new Event('change',{bubbles:true}))");awaitJs("echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series.some(s=>s.name==='J')");});
        check("native-minute-average-and-volume",()->{js("document.querySelector('#chartType').value='minute';document.querySelector('#chartType').dispatchEvent(new Event('change',{bubbles:true}))");awaitJs("!!echarts.getInstanceByDom(document.querySelector('#chart')) && echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series.some(s=>s.name==='均价')");require("true".equals(js("(()=>{const o=echarts.getInstanceByDom(document.querySelector('#chart')).getOption();return o.xAxis[0].data.length===242&&o.series[1].data.some(v=>v>0)&&o.series[2].data.some(v=>v.value>0)})()")));});
        js("document.querySelector('[data-action=expand-chart]').click()");Thread.sleep(400);capture(mode+"-minute");
        js("document.querySelector('#chartType').value='kline';document.querySelector('#chartType').dispatchEvent(new Event('change',{bubbles:true}));");awaitJs("!!echarts.getInstanceByDom(document.querySelector('#chart')) && echarts.getInstanceByDom(document.querySelector('#chart')).getOption().series[0].type==='candlestick'");
        js("document.querySelector('#indicator').value='macd';document.querySelector('#indicator').dispatchEvent(new Event('change',{bubbles:true}));PhoneCharts.range(65)");
        Thread.sleep(400);
        check("native-canvas-follows-source-wrapping",()->awaitJs("(()=>{const el=document.querySelector('#chart'),c=echarts.getInstanceByDom(el);return Math.abs(c.getHeight()-el.clientHeight)<=1&&el.getBoundingClientRect().bottom<=document.querySelector('.chart-actions').getBoundingClientRect().top})()"));
        capture(mode+"-kline-dark");
        check("native-fullscreen-fits",()->require("true".equals(js("document.querySelector('#chart').clientHeight>150 && document.documentElement.scrollWidth<=innerWidth"))));
        runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));Thread.sleep(1500);
        check("native-landscape-fits",()->awaitJs("innerWidth>innerHeight && document.documentElement.scrollWidth<=innerWidth && document.querySelector('#chart').clientHeight>140 && Math.abs(echarts.getInstanceByDom(document.querySelector('#chart')).getHeight()-document.querySelector('#chart').clientHeight)<=1"));Thread.sleep(400);capture(mode+"-landscape");
        runOnMainSync(()->activity.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));Thread.sleep(900);
        check("native-back-closes-fullscreen",()->require("true".equals(js("WebStockPhoneBack() && !document.body.classList.contains('chart-expanded')"))));
        js("document.querySelector('#theme').click();document.querySelector('[data-action=expand-chart]').click()");Thread.sleep(300);capture(mode+"-kline-light");
        int passed=0;for(int i=0;i<checks.length();i++)if(checks.getJSONObject(i).getBoolean("pass"))passed++;
        Bundle result=new Bundle();result.putString("summary",new JSONObject().put("checks",checks).put("pass",passed).put("total",checks.length()).toString());finish(passed==checks.length()?Activity.RESULT_OK:Activity.RESULT_CANCELED,result);
    }
}

