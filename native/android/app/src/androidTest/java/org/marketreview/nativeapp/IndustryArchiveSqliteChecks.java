package org.marketreview.nativeapp;
import android.content.Context;import android.database.sqlite.SQLiteDatabase;import org.json.*;import java.io.*;import java.util.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
/** Root invokes against an owned test database; never opens the normal user database. */
public final class IndustryArchiveSqliteChecks {
 public static JSONObject run(Context context,String original)throws Exception{
  IndustryArchiveStore.available();String namespace="industry-archive-check-"+java.util.UUID.randomUUID()+".sqlite";BusinessStore business=new BusinessStore(context,namespace);File file=context.getDatabasePath(namespace);JSONArray passed=new JSONArray();
  try{
   business.save("topics",object("id","current-user-topic","name","保留当前用户主题"));IndustryArchiveStore store=new IndustryArchiveStore(file);JSONObject incoming=IndustryArchiveState.payload(original),before=store.capture(Collections.emptyList()),p=store.preview(incoming,before);
   need(equal(store.capture(Collections.emptyList()).get("baseline"),before.get("baseline")),"readonly preview changed database");passed.put("readonly preview");
   boolean rejected=false;try{store.commit(p,()->{throw new IllegalStateException("injected owned rollback");});}catch(Exception e){rejected=true;}need(rejected&&equal(store.capture(Collections.emptyList()).get("baseline"),before.get("baseline")),"records and receipt rollback");passed.put("atomic rollback");
   JSONObject receipt=store.commit(p),after=store.capture(Collections.emptyList());need(store.verify(p,receipt,after),"atomic readback");passed.put("atomic receipt");
   List<String> ids=store.archiveIds();need(ids.size()==1&&equal(store.capture(ids).get("payload"),incoming),"full exact source export");passed.put("full source export");
   need(!before.has("records")&&!p.has("expectedRecords")&&!p.toString().contains("保留当前用户主题"),"other business bodies leaked into durable plan");passed.put("other bodies excluded");
   SQLiteDatabase db=business.getWritableDatabase();db.execSQL("DELETE FROM records WHERE kind='reports' AND id='legacy-version:v2'");need(store.preview(incoming,store.capture(Collections.emptyList())).getBoolean("noChange"),"repeat resurrected deleted version");passed.put("repeat keeps deletion");
   db.execSQL("DELETE FROM industry_restore_receipts");JSONObject next=store.preview(incoming,store.capture(Collections.emptyList()));business.save("topics",object("id","current-user-topic","name","新的用户草稿"));rejected=false;try{store.commit(next);}catch(Exception e){rejected=true;}need(rejected,"whole records CAS allowed new draft overwrite");passed.put("full records CAS");
   db.execSQL("PRAGMA user_version=99");rejected=false;try{store.capture(Collections.emptyList());}catch(Exception e){rejected=true;}need(rejected,"future DB adopted");passed.put("future rejected");db.execSQL("PRAGMA user_version=1");
   return object("pass",true,"checks",passed,"namespace",namespace,"realAndroidSqlite",true,"actualMainEntry",false,"normalDatabaseTouched",false);
  }finally{business.close();context.deleteDatabase(namespace);}
 }
}

