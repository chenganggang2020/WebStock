package org.marketreview.nativeapp;
import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.util.*;import org.json.*;
public final class FocusedStoreProbe {
 static String readText(Path p)throws Exception{return new String(Files.readAllBytes(p),StandardCharsets.UTF_8);}
 static void writeText(Path p,String text)throws Exception{Files.write(p,text.getBytes(StandardCharsets.UTF_8));}
 static int count;static Path root;static JSONObject base;
 interface Action{void run()throws Exception;}
 static void ok(boolean b,String why){if(!b)throw new AssertionError(why);count++;}
 static boolean blocked(Action a){try{a.run();return false;}catch(Exception e){return true;}}
 static JSONObject input(String name,int size)throws Exception{
  JSONObject s=new JSONObject(base.toString());s.put("testTag",name);JSONObject row=s.getJSONArray("rows").getJSONObject(0);row.put("testOnlyPadding","");int overhead=DarkObservation.bytes(s).length;row.put("testOnlyPadding","x".repeat(size-overhead));return s;
 }
 static Map<String,String> files(Path dir)throws Exception{Map<String,String> m=new TreeMap<>();try(var stream=Files.list(dir)){for(Path p:(Iterable<Path>)stream::iterator)m.put(p.getFileName().toString(),DarkObservation.sha(Files.readAllBytes(p)));}return m;}
 public static void main(String[]args)throws Exception{
  root=Paths.get(args[0]);base=new JSONObject(readText(root.resolve("checks/base.json")));
  if(args[1].equals("digests")){
   Object[] values={base,"a\u0000\n中\uD83D\uDE00\uD800",new JSONArray().put(-0.0).put(0.0).put(Double.MIN_VALUE).put(-12.125).put(true).put(JSONObject.NULL),new JSONObject().put("\uFFFF",1).put("\uD800",2).put("a",3)};
   JSONArray hashes=new JSONArray();for(Object v:values)hashes.put(DarkObservation.hash(v));System.out.println(hashes);return;
  }
  Path outputRoot=root;String receipt=run(root.toFile(),base);writeText(outputRoot.resolve("store-memory-receipt.json"),receipt);System.out.println(receipt);
 }
 // Same-package pure entry for instrumentation. Caller supplies a fixture, never app account data.
 // Invoke serially on an instrumentation/worker thread; no View or Flow dependency.
 public static String run(java.io.File parent,JSONObject fixture)throws Exception {
  count=0;base=new JSONObject(fixture.toString());root=Files.createTempDirectory(parent.toPath(),"v50-store-memory-");Files.createDirectory(root.resolve("b"));
  Path dir=Files.createTempDirectory(root.resolve("b"),"bounded-store-").resolve("observations");DarkObservation.Store store=new DarkObservation.Store(dir.toFile());String preparedAt="2026-10-13T01:00:00Z",savedAt="2026-10-13T01:00:01Z",day=base.getString("tradingDay"),key=base.getJSONArray("rows").getJSONObject(0).getString("key");
  JSONObject held=input("first",16*1024*1024);DarkObservation.Prepared first=DarkObservation.prepare(held,preparedAt,null);String initial=store.preview(first,null).getString("expectedRevision");ok(initial.equals("absent")&&!Files.exists(dir),"preview does not create repository");store.append(first,initial,savedAt,null);first=null;held=null;
  JSONObject heldSecond=input("second",16*1024*1024);DarkObservation.Prepared second=DarkObservation.prepare(heldSecond,preparedAt,null);String rev=store.preview(second,null).getString("expectedRevision");store.append(second,rev,savedAt,null);second=null;heldSecond=null;
  // Keep old rendered history while loading its replacement, as the frozen page does.
  JSONObject oldHistory=store.read(key,day,null),newHistory=store.read(key,day,null);ok(oldHistory.getJSONArray("points").length()==2&&newHistory.getJSONArray("points").length()==2,"two exact 16MiB snapshots and two retained histories");oldHistory=null;newHistory=null;
  Map<String,String> before=files(dir);DarkObservation.Prepared tiny=DarkObservation.prepare(base,preparedAt,null);
  ok(blocked(()->store.preview(tiny,null)),"full day preview refuses without eviction");String current=DarkObservation.hash(new JSONObject(readText(dir.resolve("manifest.json"))).getJSONObject("manifest"));
  ok(blocked(()->store.append(tiny,current,savedAt,null))&&files(dir).equals(before),"full day append preserves every file");
  ok(blocked(()->store.append(tiny,"stale",savedAt,null))&&files(dir).equals(before),"stale CAS preserves every file");
  ok(blocked(()->store.read(key,day,()->true))&&files(dir).equals(before),"cancelled read preserves every file");
  Path foreign=dir.resolve("foreign.txt");writeText(foreign,"keep");Map<String,String> withForeign=files(dir);ok(blocked(()->store.read(key,day,null))&&files(dir).equals(withForeign),"foreign file remains and blocks read");
  Path broken=Files.createTempDirectory(root.resolve("b"),"broken-store-");writeText(broken.resolve("manifest.json"),"{broken}");DarkObservation.Store bad=new DarkObservation.Store(broken.toFile());Map<String,String> badBefore=files(broken);ok(blocked(()->bad.preview(tiny,null))&&files(broken).equals(badBefore),"corrupt repository not initialized");
  int[] ticks={0};ok(blocked(()->DarkObservation.prepare(input("cancel",1024*1024),preparedAt,()->++ticks[0]>2)),"streamed hash cancellation");
  JSONObject receipt=new JSONObject().put("assertions",count).put("heapLimit",Runtime.getRuntime().maxMemory()).put("exactPayloadBytesEach",16*1024*1024).put("retainedHistories",2).put("fixtureDirectory",dir.toString()).put("vmName",System.getProperty("java.vm.name")).put("automaticTrading",false);
  return receipt.toString(2);
 }
}
