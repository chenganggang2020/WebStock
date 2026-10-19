package org.marketreview.nativeapp;
import android.app.Instrumentation;
import android.os.Build;
import android.database.sqlite.*;
import java.io.*;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Focused Store boundary only. No MainActivity, provider, market or device interaction. */
final class PaperAutomationStoreBoundaryChecks {
 static final String ID="paper-review";static final JSONArray checks=new JSONArray();
 static void need(boolean ok,String label)throws Exception{checks.put(new JSONObject().put("label",label).put("passed",ok));if(!ok)throw new AssertionError(label);}
 static JSONObject book()throws Exception{return new JSONObject().put("schema","native-paper-automation-book/v1").put("accountId",ID).put("revision",0).put("openingHash","fixture-opening").put("openingInput",new JSONObject().put("fixture",true)).put("cash",100).put("orders",new JSONArray()).put("fills",new JSONArray()).put("positions",new JSONObject());}
 static void edit(File file,String sql)throws Exception{try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.NO_LOCALIZED_COLLATORS)){db.execSQL(sql);}}
 static final class TrackedFile extends File {int touched;TrackedFile(File parent){super(parent,"must-not-open.sqlite");}public boolean exists(){touched++;return false;}public File getAbsoluteFile(){touched++;throw new AssertionError("unsupported API touched path");}}
 static JSONObject run(Instrumentation test)throws Exception{
  while(checks.length()>0)checks.remove(checks.length()-1);
  need(PaperAutomationStore.available()==(Build.VERSION.SDK_INT>=35),"availability matches native API boundary");
  for(int api=26;api<35;api++){boolean rejected=false;try{PaperAutomationStore.requireApi(api);}catch(UnsupportedOperationException expected){rejected=true;}need(rejected,"API"+api+" explicitly unsupported");}
  PaperAutomationStore.requireApi(35);
  if(Build.VERSION.SDK_INT<35){TrackedFile file=new TrackedFile(test.getTargetContext().getCacheDir());boolean rejected=false;try{new PaperAutomationStore(file).read(ID);}catch(UnsupportedOperationException expected){rejected=true;}need(rejected&&file.touched==0,"native unsupported read rejects before file access");rejected=false;try{new PaperAutomationStore(file).transact(ID,-1,b->book(),null);}catch(UnsupportedOperationException expected){rejected=true;}need(rejected&&file.touched==0,"native unsupported write rejects before file access");return new JSONObject().put("passed",true).put("api",Build.VERSION.SDK_INT).put("nativeAndroidSQLite",false).put("checks",checks);}
  File root=new File(test.getTargetContext().getCacheDir(),"f05-store-review-"+UUID.randomUUID());need(root.mkdir(),"new private Store test directory");File good=new File(root,"known.sqlite");PaperAutomationStore store=new PaperAutomationStore(good);need(store.read(ID).length()==0&&!good.exists(),"missing read creates no database");JSONObject before=store.transact(ID,-1,b->book(),null);byte[] original=Files.readAllBytes(good.toPath());
  JSONObject read=store.read(ID,db->{need(db.isReadOnly()&&db.inTransaction(),"Store uses real read-only connection and API35 transaction");boolean blocked=false;try{db.execSQL("UPDATE paper_execution_books SET revision=revision WHERE account_id=?",new Object[]{ID});}catch(SQLiteException expected){blocked=true;}need(blocked,"write attempt inside actual Store read transaction is rejected");});
  need(PaperMonitorModel.equal(read,before)&&Arrays.equals(original,Files.readAllBytes(good.toPath())),"known book and exact file bytes survive true read-only capture");
  boolean rolledBack=false;try{store.read(ID,db->{throw new IllegalStateException("injected-read-cancel");});}catch(IllegalStateException expected){rolledBack=true;}need(rolledBack&&Arrays.equals(original,Files.readAllBytes(good.toPath())),"failed read ends transaction and preserves original bytes");
  String[] labels={"wrong-columns","foreign-index","foreign-trigger","foreign-view","extra-constraint","wrong-platform-metadata"};String[] sqls={"ALTER TABLE paper_execution_books RENAME TO retained_original","CREATE INDEX alien_index ON paper_execution_books(revision)","CREATE TRIGGER alien_trigger AFTER UPDATE ON paper_execution_books BEGIN UPDATE paper_execution_books SET sha256='alien'; END","CREATE VIEW alien_view AS SELECT account_id FROM paper_execution_books","ALTER TABLE paper_execution_books RENAME TO retained_original","CREATE TABLE android_metadata(locale BLOB)"};
  for(int i=0;i<labels.length;i++){File file=new File(root,labels[i]+".sqlite");Files.copy(good.toPath(),file.toPath());edit(file,sqls[i]);if(i==0||i==4){String definition=i==0?"account_id TEXT PRIMARY KEY,revision TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL":"account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,CHECK(revision>=0)";edit(file,"CREATE TABLE paper_execution_books("+definition+")");edit(file,"INSERT INTO paper_execution_books SELECT * FROM retained_original");edit(file,"DROP TABLE retained_original");}byte[] retained=Files.readAllBytes(file.toPath());boolean rejected=false;try{new PaperAutomationStore(file).read(ID);}catch(Exception expected){rejected=true;}need(rejected,labels[i]+" rejected by actual read");int[] entered={0};rejected=false;try{new PaperAutomationStore(file).transact(ID,0,b->{entered[0]++;return b;},null);}catch(Exception expected){rejected=true;}need(rejected&&entered[0]==0,labels[i]+" rejected before transition callback");need(Arrays.equals(retained,Files.readAllBytes(file.toPath())),labels[i]+" exact original bytes preserved");}
  File compatible=new File(root,"known-platform-metadata.sqlite");Files.copy(good.toPath(),compatible.toPath());edit(compatible,"CREATE TABLE android_metadata(locale TEXT)");edit(compatible,"INSERT INTO android_metadata VALUES('en_US')");byte[] compatibleBytes=Files.readAllBytes(compatible.toPath());need(PaperMonitorModel.equal(new PaperAutomationStore(compatible).read(ID),before)&&Arrays.equals(compatibleBytes,Files.readAllBytes(compatible.toPath())),"only known optional Android locale table accepted without rewrite");
  JSONObject result=new JSONObject().put("passed",true).put("api",Build.VERSION.SDK_INT).put("nativeAndroidSQLite",true).put("directory",root.getCanonicalPath()).put("checks",checks);Files.write(new File(root,"store-boundary-result.json").toPath(),result.toString(2).getBytes(StandardCharsets.UTF_8));return result;
 }
}
