package org.marketreview.nativeapp;
import android.content.*;
import android.content.pm.ActivityInfo;
import android.os.SystemClock;
import android.widget.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
final class CffexHostChecks {
 static File file(Context c){return new File(c.getFilesDir(),"cffex-disclosure-tests-v38.json");}
 static void isolate(Context c)throws Exception{File p=file(c);if(p.exists())Files.move(p.toPath(),new File(p+".previous-"+UUID.randomUUID()).toPath());}
 static byte[] fixture(FlowInstrumentation f)throws Exception{try(InputStream in=f.getContext().getAssets().open("cffex-constructed.xml");ByteArrayOutputStream b=new ByteArrayOutputStream()){byte[] bytes=new byte[4096];int n;while((n=in.read(bytes))!=-1)b.write(bytes,0,n);return b.toByteArray();}}
 static void waitDone(FlowInstrumentation f)throws Exception{long until=SystemClock.elapsedRealtime()+7000;boolean[] done={false};while(SystemClock.elapsedRealtime()<until){f.ui(()->done[0]=f.activity.cffexScreen.activeToken().isEmpty());if(done[0])return;Thread.sleep(25);}throw new AssertionError("CFFEX callback timeout");}
 static void guards(FlowInstrumentation f,byte[] raw)throws Exception{
  File dir=new File(f.activity.getCacheDir(),"cffex-guards-"+System.nanoTime());if(!dir.mkdirs())throw new IOException("guard directory");
  File missing=new File(dir,"absent/history.json");new CffexDisclosureStore(missing).read();f.check(!missing.getParentFile().exists(),"read does not create directory");
  JSONObject q=CffexDisclosureModel.request("2026-08-28","IF");File p=new File(dir,"history.json");CffexDisclosureStore store=new CffexDisclosureStore(p);
  byte[] bom=("\uFEFF"+new String(raw,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8);
  JSONObject bomReport=CffexDisclosureModel.parse(bom,q,q.getString("url"),"2026-10-13T08:00:00Z","fixture-constructed");
  f.check(CffexDisclosureModel.equal(CffexDisclosureModel.validate(bomReport),bomReport),"UTF8 BOM round trip preserves original hash");
  boolean encodingRejected=false;try{CffexDisclosureModel.parse(("<?xml version=\"1.0\" encoding=\"GBK\"?>"+new String(raw,StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8),q,q.getString("url"),"2026-10-13T08:00:00Z","fixture-constructed");}catch(Exception e){encodingRejected=true;}
  f.check(encodingRejected,"conflicting XML encoding rejected");
  for(int i=0;i<20;i++)store.save(CffexDisclosureModel.parse(raw,q,q.getString("url"),String.format(Locale.ROOT,"2026-10-13T08:00:%02dZ",i),"fixture-constructed"),i);
  byte[] before=Files.readAllBytes(p.toPath());boolean refused=false;try{store.save(CffexDisclosureModel.parse(raw,q,q.getString("url"),"2026-10-13T08:01:00Z","fixture-constructed"),20);}catch(Exception e){refused=true;}
  f.check(refused&&Arrays.equals(before,Files.readAllBytes(p.toPath())),"full archive refuses without pruning bytes");
  for(String suffix:new String[]{".bak",".new"}){File side=new File(p+suffix);byte[] keep="unresolved-original".getBytes(StandardCharsets.UTF_8);Files.write(side.toPath(),keep);refused=false;try{store.read();}catch(Exception e){refused=true;}f.check(refused&&Arrays.equals(before,Files.readAllBytes(p.toPath()))&&Arrays.equals(keep,Files.readAllBytes(side.toPath())),"read preserves unresolved "+suffix);Files.move(side.toPath(),new File(side+".held").toPath());}
  File corrupt=new File(dir,"corrupt.json");Files.write(corrupt.toPath(),"original-broken".getBytes(StandardCharsets.UTF_8));refused=false;try{new CffexDisclosureStore(corrupt).read();}catch(Exception e){refused=true;}f.check(refused&&new String(Files.readAllBytes(corrupt.toPath()),StandardCharsets.UTF_8).equals("original-broken"),"corrupt original preserved");
 }
 static void run(FlowInstrumentation f)throws Exception{
  byte[] raw=fixture(f);guards(f,raw);String xml=new String(raw,StandardCharsets.UTF_8);
  LinkedBlockingQueue<EtfMonitorHostChecks.Reply> replies=new LinkedBlockingQueue<>();List<String> urls=new CopyOnWriteArrayList<>();
  f.ui(()->{f.activity.cffexTestOpener=url->{urls.add(url.toString());EtfMonitorHostChecks.Reply r=new EtfMonitorHostChecks.Reply(url);replies.add(r);return r;};f.activity.openCffexDisclosure();f.check(f.activity.cffexScreen.isShown(),"native disclosure internal page");f.check(f.activity.cffexScreen.product.getSelectedItemPosition()==0,"default all four products");f.activity.cffexScreen.product.setSelection(1);});
  CffexDisclosureStore archive=new CffexDisclosureStore(file(f.activity));f.check(urls.isEmpty()&&!file(f.activity).exists(),"opening neither fetches nor creates archive");
  f.ui(()->{((EditText)f.activity.cffexScreen.findViewWithTag("cffexDate")).setText("2026-08-28");((Button)f.activity.cffexScreen.findViewWithTag("cffexFetch")).performClick();});
  EtfMonitorHostChecks.Reply r=replies.poll(3,TimeUnit.SECONDS);f.check(r!=null&&r.getURL().toString().endsWith("/202608/28/IF.xml"),"single exact-date HTTPS");r.deliver(xml,200);waitDone(f);f.check(!file(f.activity).exists(),"fetch does not implicitly save");
  f.ui(()->f.check(f.activity.cffexScreen.saveCurrent(),"explicit save"));JSONArray frames=archive.read().getJSONArray("frames");f.check(frames.length()==1,"independent archive");
  JSONObject stored=new JSONObject(frames.getJSONObject(0).getString("json"));f.check(stored.getString("origin").equals("fixture-constructed"),"test response never labelled real provider");
  f.ui(()->((Button)f.activity.cffexScreen.findViewWithTag("cffexFetch")).performClick());r=replies.poll(3,TimeUnit.SECONDS);f.check(r!=null,"explicit second fetch");f.ui(()->f.activity.goHome());r.deliver(xml,200);Thread.sleep(100);f.check(archive.read().getJSONArray("frames").length()==1,"leave cancels and preserves history");
  f.ui(()->{f.activity.openCffexDisclosure();((Button)f.activity.cffexScreen.findViewWithTag("cffexFetch")).performClick();});r=replies.poll(3,TimeUnit.SECONDS);f.check(r!=null,"explicit retry");r.deliver("",503);waitDone(f);
  f.ui(()->{try{f.check(f.activity.cffexScreen.selectHistory(1),"read saved history");f.activity.cffexScreen.openOriginal();JSONObject state=f.activity.cffexScreen.saveState();f.check(state.toString().length()<4096&&!state.toString().contains("rawXml"),"short state only");f.activity.cffexScreen.restoreState(state);f.check(f.activity.closeInternalReader(),"original closes before home");}catch(Exception e){throw new RuntimeException(e);}});
  f.waitForIdleSync();f.ui(()->{TextView selected=(TextView)f.activity.cffexScreen.product.getSelectedView();f.check(selected!=null&&selected.getLayout()!=null&&selected.getLayout().getEllipsisCount(0)==0,"full product label visible");});f.shot("android-v38-cffex");int count=urls.size();
  f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));Thread.sleep(900);f.waitForIdleSync();f.ui(()->{CffexDisclosureScreen s=f.activity.cffexScreen;f.check(s.reportScroll.getHeight()>=s.dp(80),"landscape table retains readable viewport");s.options.performClick();f.check(s.controlsScroll.isShown(),"landscape condition controls remain reachable");s.options.performClick();f.check(s.reportScroll.isShown(),"return from conditions to report");});f.shot("android-v38-cffex-landscape");
  f.check(urls.size()==count,"rotation no hidden request");f.ui(()->f.activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
  f.ui(()->{f.activity.goHome();f.activity.disposeCffexDisclosure();});
 }
}
