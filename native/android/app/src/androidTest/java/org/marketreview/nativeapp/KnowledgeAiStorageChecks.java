package org.marketreview.nativeapp;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
public final class KnowledgeAiStorageChecks {
 static int checks; static final List<String> failures=new ArrayList<>();
 interface Work {void run()throws Exception;}
 static void check(boolean b,String s){checks++;if(!b)failures.add(s);}
 static void rejects(Work w,String s)throws Exception{boolean rejected=false;try{w.run();}catch(Exception e){rejected=true;}check(rejected,s);}
 static byte[] bytes(String s){return s.getBytes(StandardCharsets.UTF_8);}
 static byte[] badUtf8(byte[] b){byte[] mark=bytes("\ufffd");for(int i=0;i<b.length-2;i++)if(b[i]==mark[0]&&b[i+1]==mark[1]&&b[i+2]==mark[2]){byte[] out=new byte[b.length-2];System.arraycopy(b,0,out,0,i);out[i]=(byte)0xff;System.arraycopy(b,i+3,out,i+1,b.length-i-3);return out;}throw new AssertionError("fixture missing replacement char");}
 public static JSONObject run(File parent)throws Exception{
  checks=0;failures.clear();Files.createDirectories(parent.toPath());Path root=Files.createTempDirectory(parent.toPath(),"focused-");
  JSONArray materials=new JSONArray().put(new JSONObject().put("kind","docs").put("id","a").put("row",new JSONObject().put("id","a").put("text","complete body").put("originalText","original").put("metadata","v1")));
  JSONObject selected=KnowledgeAiHost.selection(materials),state=KnowledgeAiHost.draft("question \ufffd",selected,new JSONObject(),"",0,"");
  JSONObject prefs=new JSONObject().put("provider","openai").put("endpoint","https://api.openai.com/v1/chat/completions").put("model","local-review-label").put("enabledPreference",true);
  AiKnowledgeRequest.Prepared plan=AiKnowledgeRequest.prepare(prefs,"question",materials);
  int[] calls={0};AiKnowledgeRequest.Credential sentinel=()->{calls[0]++;throw new Exception("must not acquire");};
  AiKnowledgeRequest.FakeConnection connection=()->{calls[0]++;throw new Exception("must not open");};
  JSONObject attempt=AiKnowledgeRequest.execute(plan,null,sentinel,new AiKnowledgeRequest.Cancellation(),connection);
  check("blocked".equals(attempt.getString("status"))&&!attempt.getBoolean("networkAttempted")&&calls[0]==0,"noGrant before credential/connection");
  AiKnowledgeRequest.Cancellation cancelled=new AiKnowledgeRequest.Cancellation();cancelled.cancel();
  check("cancelled".equals(AiKnowledgeRequest.execute(plan,null,sentinel,cancelled,connection).getString("status"))&&calls[0]==0,"pre-cancel no I/O");
  byte[] body=plan.body();body[0]=0;check(plan.body()[0]!=0,"prepared body copy");
  JSONArray changed=new JSONArray(materials.toString());changed.getJSONObject(0).getJSONObject("row").put("metadata","v2");rejects(()->KnowledgeAiHost.confirm(selected,changed),"metadata second-source check");
  changed.getJSONObject(0).getJSONObject("row").put("text","edited");rejects(()->KnowledgeAiHost.confirm(selected,changed),"body second-source check");
  check(KnowledgeAiHost.equal(KnowledgeAiHost.confirm(selected,materials),selected),"source match retains full selection");
  KnowledgeAiHost.Store store=new KnowledgeAiHost.Store(root.resolve("draft").toFile());JSONObject marker=store.save(state,new JSONObject());
  check(KnowledgeAiHost.equal(store.read(marker),state),"valid draft round trip");
  rejects(()->store.save(state,new JSONObject()),"stale draft CAS");
  Path draft=root.resolve("draft/draft.json");byte[] good=Files.readAllBytes(draft);
  List<byte[]> corrupt=Arrays.asList(bytes(new String(good,StandardCharsets.UTF_8)+" trailing"),badUtf8(good),bytes(new String(good,StandardCharsets.UTF_8)+"\u0000junk"));
  for(int i=0;i<corrupt.size();i++){byte[] input=corrupt.get(i);Files.write(draft,input);final int n=i;rejects(()->store.marker(),"corrupt draft marker "+n);rejects(()->{JSONObject m=store.marker();store.save(state,m);},"corrupt draft must not be normalized "+n);check(Arrays.equals(input,Files.readAllBytes(draft)),"corrupt draft bytes preserved "+n);}
  Files.write(draft,good);
  Path history=root.resolve("history");attempt.put("report","retained \ufffd");File first=AiKnowledgeRequest.writeArchive(history.toFile(),attempt);byte[] firstBytes=Files.readAllBytes(first.toPath());
  File second=AiKnowledgeRequest.writeArchive(history.toFile(),attempt);check(!first.equals(second)&&Arrays.equals(firstBytes,Files.readAllBytes(first.toPath())),"independent history files");
  check(AiKnowledgeRequest.readArchive(first).getString("report").equals("retained \ufffd"),"valid history round trip");
  List<byte[]> badArchives=Arrays.asList(bytes(new String(firstBytes,StandardCharsets.UTF_8)+" trailing"),badUtf8(firstBytes),bytes(new String(firstBytes,StandardCharsets.UTF_8)+"\u0000junk"));
  for(int i=0;i<badArchives.size();i++){byte[] input=badArchives.get(i);Files.write(first.toPath(),input);final int n=i;rejects(()->AiKnowledgeRequest.readArchive(first),"corrupt archive rejected "+n);check(Arrays.equals(input,Files.readAllBytes(first.toPath())),"archive bytes preserved "+n);}
  Files.write(first.toPath(),firstBytes);try(RandomAccessFile f=new RandomAccessFile(first,"rw")){f.setLength(AiKnowledgeRequest.ARCHIVE_LIMIT+1L);}rejects(()->AiKnowledgeRequest.readArchive(first),"archive capacity limit");
  try(RandomAccessFile f=new RandomAccessFile(draft.toFile(),"rw")){f.setLength(KnowledgeAiHost.DRAFT_LIMIT+1L);}rejects(()->store.marker(),"draft capacity limit");
  JSONArray oversized=new JSONArray(materials.toString());oversized.getJSONObject(0).getJSONObject("row").put("text","x".repeat(AiKnowledgeRequest.MATERIAL_LIMIT));rejects(()->KnowledgeAiHost.selection(oversized),"selection capacity no truncation");
  return new JSONObject().put("checks",checks).put("failures",new JSONArray(failures)).put("credentialOrConnectionCalls",calls[0]).put("GrantCreated",false);
 }
 public static void main(String[] args)throws Exception{JSONObject result=run(new File(args[0]));System.out.println(result.toString(2));if(result.getJSONArray("failures").length()>0)System.exit(1);}
}
