package org.marketreview.nativeapp;

import android.app.*;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.content.res.Configuration;
import android.graphics.Rect;
import android.view.*;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import org.json.*;

/** UI-only follow-up: reuse the isolated v61 named archive; do not rerun model/SQLite cases. */
final class ThemeUiChecks {
  final FlowInstrumentation f;final JSONArray shots=new JSONArray();
  ThemeUiChecks(FlowInstrumentation flow){f=flow;}
  LocalCandidateScreen page(){return f.activity.candidateScreen;}
  @SuppressWarnings("unchecked") void fixtureRoster(JSONObject fixture)throws Exception {
    java.lang.reflect.Field field=MainActivity.class.getDeclaredField("instruments");field.setAccessible(true);
    List<JSONObject> roster=(List<JSONObject>)field.get(f.activity);roster.clear();JSONArray selected=fixture.getJSONArray("selected");
    for(int i=0;i<selected.length();i++)roster.add(new JSONObject(selected.getJSONObject(i).toString()));
  }
  void ui(ThemeHostChecks.Call call){f.ui(()->{try{call.run();}catch(Exception e){throw new RuntimeException(e);}});}
  void tap(String tag){ThemeHostChecks.button(f,tag);}
  void waitFor(java.util.function.BooleanSupplier ready,String why)throws Exception {ThemeHostChecks.await(f,ready,why);}
  String orientation(){return f.activity.getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE?"landscape":"portrait";}
  void rotate(boolean wide)throws Exception {ui(()->f.activity.setRequestedOrientation(wide?ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE:ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));waitFor(()->orientation().equals(wide?"landscape":"portrait")&&f.activity.hasWindowFocus(),"actual requested orientation");f.waitForIdleSync();}
  void shot(String stage)throws Exception {
    String name="v52-theme-"+stage+"-"+orientation();f.shot(name);
    android.graphics.BitmapFactory.Options size=new android.graphics.BitmapFactory.Options();size.inJustDecodeBounds=true;
    android.graphics.BitmapFactory.decodeFile(new File(new File(f.activity.getExternalFilesDir(null),f.shotFolder),name+".png").getPath(),size);
    f.check(size.outWidth>0&&size.outHeight>0&&(size.outWidth>size.outHeight)==orientation().equals("landscape"),"screenshot direction agrees with actual orientation");
    shots.put(new JSONObject().put("file",name+".png").put("width",size.outWidth).put("height",size.outHeight));
  }
  void readerMarker(TextView reader,String marker)throws Exception {
    waitFor(()->reader.getLayout()!=null,"native full reader layout");
    ui(()->{String text=reader.getText().toString();int at=text.indexOf(marker);f.check(at>=0,"full reader retains "+marker);int line=reader.getLayout().getLineForOffset(at);reader.requestRectangleOnScreen(new Rect(0,reader.getLayout().getLineTop(line),reader.getWidth(),reader.getLayout().getLineBottom(line)+f.activity.dp(8)),true);});
    f.waitForIdleSync();
    ui(()->{Rect visible=new Rect();f.check(reader.getGlobalVisibleRect(visible)&&visible.height()>=f.activity.dp(100),"full reader has usable viewport");int line=reader.getLayout().getLineForOffset(reader.getText().toString().indexOf(marker));int[] xy=new int[2];reader.getLocationOnScreen(xy);int top=xy[1]+reader.getTotalPaddingTop()+reader.getLayout().getLineTop(line)-reader.getScrollY();int bottom=xy[1]+reader.getTotalPaddingTop()+reader.getLayout().getLineBottom(line)-reader.getScrollY();f.check(Math.max(top,visible.top)<Math.min(bottom,visible.bottom),"requested evidence actually visible");});
  }
  void run()throws Exception {
    int before=f.assertions;Throwable caught=null;
    try {
      f.check(f.activity.testing&&f.activity.feed==null,"actual offline Main only");
      JSONObject fixture=ThemeHostChecks.fixture(f);
      ui(()->{fixtureRoster(fixture);f.activity.localCandidates();page().backgroundMode.setChecked(true);});
      rotate(false);tap("candidateHistory");waitFor(()->!page().busy&&page().historyLoaded&&page().history.length()==1,"prior isolated named theme archive");
      ui(()->page().list.performItemClick(page().list.getChildAt(0),0,0));waitFor(()->!page().busy&&page().currentBundle!=null,"saved full archive loaded");
      final String anchor=page().anchor,digest=HostCandidateBackground.digest(page().currentBundle);
      ui(()->page().list.performItemClick(page().list.getChildAt(0),0,0));readerMarker(page().detail,"正文尾部_V61_不得截断");shot("history-tail");rotate(true);readerMarker(page().detail,"正文尾部_V61_不得截断");shot("history-tail");
      MainActivity old=f.activity;Instrumentation.ActivityMonitor monitor=f.addMonitor(MainActivity.class.getName(),null,false);
      try {ui(()->f.activity.recreate());Activity next=monitor.waitForActivityWithTimeout(15000);f.check(next instanceof MainActivity&&next!=old,"actual Main recreation");f.activity=(MainActivity)next;f.waitForIdleSync();f.awaitCollectionService();waitFor(()->page()!=null&&!page().busy&&page().currentBundle!=null&&f.activity.hasWindowFocus(),"private saved archive restored without rerun");}finally{f.removeMonitor(monitor);}
      ui(()->f.check(page().anchor.equals(anchor)&&HostCandidateBackground.digest(page().currentBundle).equals(digest),"recreation retains original full archive identity"));readerMarker(page().detail,"正文尾部_V61_不得截断");shot("history-recreated");rotate(false);readerMarker(page().detail,"正文尾部_V61_不得截断");shot("history-recreated");
      ui(()->{fixtureRoster(fixture);page().chosen.clear();page().chosen.add("SH:stock:600001");page().backgroundAccounts.clear();page().backgroundAccounts.add("account-A");});
      ThemeHostChecks.choices(f);shot("preview-top");
      ui(()->{View action=page().findViewWithTag("candidateThemeCompute");Rect rect=new Rect();f.check(action.getGlobalVisibleRect(rect)&&rect.height()>=f.activity.dp(40),"preview confirmation stays visible without scrolling through full JSON");});
      readerMarker(page().findViewWithTag("candidateThemeFullPreview"),"正文尾部_V61_不得截断");shot("preview-tail");rotate(true);readerMarker(page().findViewWithTag("candidateThemeFullPreview"),"正文尾部_V61_不得截断");shot("preview-tail");
      final View oldCompute=page().findViewWithTag("candidateThemeCompute");final String head=page().background.head(null);
      f.check(f.getUiAutomation().performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_HOME),"emulator actual background transition");
      waitFor(()->!page().visible,"Main onPause suspends preview");
      f.getTargetContext().startActivity(new Intent(f.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
      waitFor(()->f.activity.hasWindowFocus()&&page().visible&&page().isShown(),"same Main returns from background");
      ui(()->{f.check(page().list.isShown()&&!page().accountScroll.isShown()&&!page().accountActions.isShown()&&page().backgroundMode.isShown(),"cancelled preview restores usable range with no stale action bar");long generation=page().generation;oldCompute.performClick();f.check(page().generation==generation&&!page().busy,"backgrounded old confirmation remains inactive");});
      f.check(page().background.head(null).equals(head),"background/resume does not compute or write");shot("resumed-range");
      ui(()->{f.activity.goHome();f.check(f.activity.findViewById(R.id.home).isShown(),"back to real home after cancel without extra history");});
    }catch(Throwable e){caught=e;try{shot("failure");}catch(Exception ignored){}}
    finally {File folder=new File(f.activity.getExternalFilesDir(null),f.shotFolder);folder.mkdirs();Files.write(new File(folder,"theme-ui.json").toPath(),new JSONObject().put("passed",caught==null).put("assertions",f.assertions-before).put("error",caught==null?"":caught.toString()).put("screenshots",shots).put("oldSuitesRerun",false).put("realNetwork",false).toString(2).getBytes(StandardCharsets.UTF_8));}
    if(caught!=null){if(caught instanceof Exception)throw (Exception)caught;throw new AssertionError(caught);}
  }
  static void run(FlowInstrumentation f)throws Exception{new ThemeUiChecks(f).run();}
}
