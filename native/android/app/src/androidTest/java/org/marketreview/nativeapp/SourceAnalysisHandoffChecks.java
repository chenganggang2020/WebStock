package org.marketreview.nativeapp;
import java.io.File;
import java.util.*;
import org.json.*;
final class SourceAnalysisHandoffChecks {
  interface Action{void run() throws Exception;}
  static void check(boolean b,String m){if(!b)throw new AssertionError(m);}
  static void rejects(Action a) throws Exception {boolean denied=false;try{a.run();}catch(Exception e){denied=true;}check(denied,"risk operation should be rejected");}
  static JSONObject row() throws Exception {return new JSONObject().put("id","fixture").put("title","日期边界原稿").put("text","完整正文末尾").put("originalText","识别原稿").put("author","受控作者").put("sourceUrl","https://someone:secret@www.douyin.com/video/7259684447530929443?signature=secret#token").put("publishedAt","2026-10-11T16:00:00Z");}
  static void model() throws Exception {
    JSONObject a=row(),b=new JSONObject().put("id","unknown").put("text","页面文字").put("author","受控作者");JSONArray rows=new JSONArray().put(a).put(b);
    JSONObject packet=SourceAnalysisPacket.build("受控作者",rows,new JSONObject().put("mode","date").put("purpose","risks").put("from","2026-10-12").put("to","2026-10-12"));
    check(packet.getInt("itemCount")==1&&packet.getString("markdown").contains("完整正文末尾")&&!packet.getString("markdown").contains("signature")&&!packet.getString("markdown").contains("secret@"),"Beijing/full body/public URL");
    JSONObject ref=packet.getJSONArray("sourceReferences").getJSONObject(0);check(SourceAnalysisPacket.exactSource(ref,rows).getString("id").equals("fixture"),"initial missing revision exact source");
    rejects(()->SourceAnalysisPacket.exactSource(ref,new JSONArray().put(new JSONObject(a.toString()).put("executionRevision","restored"))));
    rejects(()->SourceAnalysisPacket.exactSource(ref,new JSONArray().put(new JSONObject(a.toString()).put("text","later edit"))));
    check(SourceAnalysisPacket.extractResult("prefix WEBSTOCK_RESULT_START 结论 WEBSTOCK_RESULT_END suffix").getString("text").equals("结论"),"result marker extraction");
    check(SourceAnalysisPacket.extractResult("WEBSTOCK_STOCK_START 股票 WEBSTOCK_STOCK_END").getString("text").equals("股票"),"typed marker extraction");
    rejects(()->SourceAnalysisPacket.extractResult("WEBSTOCK_RESULT_START   WEBSTOCK_RESULT_END"));
    char[] largeChars=new char[SourceAnalysisPacket.BYTE_LIMIT+1];Arrays.fill(largeChars,'x');String huge=new String(largeChars);largeChars=null;
    rejects(()->SourceAnalysisPacket.build("",new JSONArray().put(SourceAnalysisPacket.copy(a).put("text",huge)),new JSONObject().put("mode","all")));
    String legacy=new JSONArray().put(new JSONObject().put("title","旧条目").put("prompt","旧完整提示").put("result","旧完整结果").put("kind","paper-monitor").put("context",new JSONObject().put("source","old"))).toString();
    Map<String,JSONObject> saved=new HashMap<>();JSONObject preview=SourceHandoffStore.preview(legacy,"legacy.json",saved);check(saved.isEmpty()&&preview.getInt("newCount")==1,"preview must not write");JSONObject imported=preview.getJSONArray("rows").getJSONObject(0).getJSONObject("record");saved.put(imported.getString("id"),imported);
    check(SourceHandoffStore.preview(legacy,"legacy.json",saved).getInt("duplicateCount")==1,"import identity repeat");
    check(SourceHandoffStore.preview(legacy.replace("旧完整结果","冲突结果"),"legacy.json",saved).getInt("conflictCount")==1,"import conflict keeps existing");
    check(SourceHandoffStore.preview("[{\"title\":\"bad\",\"result\":null}]","bad.json",saved).getJSONArray("errors").length()==1,"invalid imported result");
  }
  static void run(FlowInstrumentation f) throws Exception {
    model();f.check(true,"source packet dates/fulltext/size/exact source/import identity contracts");
    f.check(f.activity!=null&&f.activity.testing,"handoff device store requires testing Activity");
    File file=new File(f.activity.getCacheDir(),"handoff-check-"+UUID.randomUUID()+".sqlite");SourceHandoffStore store=new SourceHandoffStore(file);
    File protectedFile=new File(f.activity.getCacheDir(),"handoff-protected-"+UUID.randomUUID()+".sqlite");
    try(android.database.sqlite.SQLiteDatabase db=android.database.sqlite.SQLiteDatabase.openDatabase(protectedFile.getAbsolutePath(),null,android.database.sqlite.SQLiteDatabase.CREATE_IF_NECESSARY)){db.execSQL("CREATE TABLE protected_data(value TEXT)");db.execSQL("INSERT INTO protected_data VALUES('preserve')");}
    rejects(()->new SourceHandoffStore(protectedFile));
    try(android.database.sqlite.SQLiteDatabase db=android.database.sqlite.SQLiteDatabase.openDatabase(protectedFile.getAbsolutePath(),null,android.database.sqlite.SQLiteDatabase.OPEN_READONLY)){f.check(SourceHandoffStore.scalar(db,"SELECT count(*) FROM protected_data WHERE value='preserve'")==1&&db.getVersion()==0,"foreign user table refused without migration or deletion");}
    File malformedFile=new File(f.activity.getCacheDir(),"handoff-metadata-"+UUID.randomUUID()+".sqlite");
    try(android.database.sqlite.SQLiteDatabase db=android.database.sqlite.SQLiteDatabase.openDatabase(malformedFile.getAbsolutePath(),null,android.database.sqlite.SQLiteDatabase.CREATE_IF_NECESSARY)){db.execSQL("ALTER TABLE android_metadata ADD COLUMN unexpected TEXT");}
    rejects(()->new SourceHandoffStore(malformedFile));f.check(true,"malformed android_metadata rejected; genuine system metadata initializes normally");
    JSONObject packet=SourceAnalysisPacket.build("",new JSONArray().put(row()),new JSONObject().put("mode","all"));
    JSONObject saved=store.saveResult(packet,"受控手动记录","raw WEBSTOCK_RESULT_START 保存结果 WEBSTOCK_RESULT_END tail");store.saveDraft(new JSONObject().put("packet",packet).put("answer","未保存回填草稿"));
    SourceHandoffStore reopened=new SourceHandoffStore(file);f.check(reopened.detail(saved.getString("id")).getString("rawResult").endsWith("tail")&&reopened.draft().getString("answer").equals("未保存回填草稿"),"actual Android SQLite reopen full answer/draft");
    JSONObject oldDraft=reopened.draft(),updated=reopened.saveDraft(new JSONObject(oldDraft.toString()).put("title","其他入口修改"),oldDraft.getString("draftRevision"));rejects(()->store.saveDraft(oldDraft,oldDraft.getString("draftRevision")));f.check(SourceAnalysisPacket.canonical(store.draft()).equals(SourceAnalysisPacket.canonical(updated)),"actual SQLite rejects stale draft without replacing latest");
    String legacy="[{\"title\":\"旧条目\",\"prompt\":\"完整提示\",\"result\":\"旧结果\",\"kind\":\"general\"}]";JSONObject preview=store.previewImport(legacy,"legacy.json");f.check(store.page(0,"").length()==1,"actual Android preview writes nothing");
    f.check(store.merge(preview).getInt("added")==1&&store.merge(preview).getInt("duplicate")==1,"actual Android atomic idempotent merge");
    f.check(store.merge(store.previewImport(legacy.replace("旧结果","冲突结果"),"legacy.json")).getInt("conflict")==1&&store.page(0,"").length()==2,"actual Android conflict preserves existing");
    File second=new File(f.activity.getCacheDir(),"handoff-import-"+UUID.randomUUID()+".sqlite");SourceHandoffStore other=new SourceHandoffStore(second);f.check(other.merge(other.previewImport(new String(store.backup(),java.nio.charset.StandardCharsets.UTF_8),"backup.json")).getInt("added")==2,"actual Android full backup round trip");
    char[] chars=new char[800000];Arrays.fill(chars,'财');String large=new String(chars)+"完整尾文";JSONObject largeSaved=store.saveResult(packet,"超过默认CursorWindow的完整回答",large);f.check(store.detail(largeSaved.getString("id")).getString("result").equals(large),"large full answer survives chunked SQLite read without truncation");
    f.ui(()->{try{SourceAnalysisPanel panel=new SourceAnalysisPanel(f.activity,f.activity.businessStore,file,null);f.check(panel.answer.getText().toString().equals("未保存回填草稿"),"actual native analysis restores local draft");SourceAnalysisPanel otherPanel=new SourceAnalysisPanel(f.activity,f.activity.businessStore,file,null);otherPanel.answer.setText("另一入口新草稿");panel.answer.setText("旧页草稿");f.check(store.draft().getString("answer").equals("另一入口新草稿"),"actual native old panel cannot silently overwrite shared draft");panel.restoreDraft();panel.setDarkTheme(true);panel.setDarkTheme(false);f.check(panel.answer.getText().toString().equals("另一入口新草稿"),"explicit shared draft reload and theme retain newest answer");}catch(Exception e){throw new RuntimeException(e);}});
  }
  public static void main(String[] args) throws Exception {model();System.out.println("PASS source packet date/fulltext/25MiB/exact version/manual parsing/import duplicate-conflict; production Java model only, no device/DB/network");}
}
