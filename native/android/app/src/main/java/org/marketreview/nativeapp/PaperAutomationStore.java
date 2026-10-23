package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.os.Build;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Isolated execution database; original BusinessStore is never written here. */
final class PaperAutomationStore {
 static final int LIMIT=16*1024*1024,APP_ID=1465077813;
 static boolean available(){return Build.VERSION.SDK_INT>=35;}
 static void requireApi(int api){if(api<35)throw new UnsupportedOperationException("纸面执行一致只读事务需 API35+；未触及文件或SQLite打开");}
 static final class Api35{static void begin(SQLiteDatabase db){db.beginTransactionReadOnly();}}
 interface ReadHook{void run(SQLiteDatabase db)throws Exception;}
 interface Change{JSONObject apply(JSONObject before)throws Exception;}
 interface Guard{boolean canCommit();}
 final File file;
 PaperAutomationStore(File file){this.file=file;}
 private static String definition(String sql){return sql==null?"":sql.toLowerCase(Locale.ROOT).replaceAll("\\s+","");}
 private void columns(SQLiteDatabase db,String table)throws Exception{
  String[] names=table.equals("paper_execution_books")?new String[]{"account_id","revision","payload","sha256"}:new String[]{"locale"};int at=0;
  try(Cursor c=db.rawQuery("PRAGMA table_xinfo("+table+")",null)){while(c.moveToNext()){int notNull=table.equals("paper_execution_books")&&at>0?1:0,pk=table.equals("paper_execution_books")&&at==0?1:0;String type=table.equals("paper_execution_books")&&at==1?"INTEGER":"TEXT";PaperAutomationModel.need(at<names.length&&c.getInt(0)==at&&names[at].equals(c.getString(1))&&type.equalsIgnoreCase(c.getString(2))&&c.getInt(3)==notNull&&c.isNull(4)&&c.getInt(5)==pk&&c.getInt(6)==0,"纸面执行库列定义不符，未猜测或重建");at++;}}
  PaperAutomationModel.need(at==names.length,"纸面执行库列缺失");
 }
 private void schema(SQLiteDatabase db,boolean create)throws Exception{
  int app,version;try(Cursor c=db.rawQuery("PRAGMA application_id",null)){PaperAutomationModel.need(c.moveToFirst(),"纸面库身份不可读");app=c.getInt(0);}try(Cursor c=db.rawQuery("PRAGMA user_version",null)){PaperAutomationModel.need(c.moveToFirst(),"纸面库版本不可读");version=c.getInt(0);}
  boolean book=false,metadata=false,index=false;
  try(Cursor c=db.rawQuery("SELECT type,name,tbl_name,sql FROM sqlite_master",null)){while(c.moveToNext()){
   String type=c.getString(0),name=c.getString(1),table=c.getString(2);
   if(type.equals("index")&&name.equals("sqlite_autoindex_paper_execution_books_1")&&table.equals("paper_execution_books")&&c.isNull(3)){PaperAutomationModel.need(!index,"纸面库主键索引重复");index=true;continue;}
   PaperAutomationModel.need(type.equals("table")&&name.equals(table)&&(name.equals("paper_execution_books")||name.equals("android_metadata")),"纸面执行库有未知表、视图、触发器或索引，未修改外库");
   String expected=name.equals("paper_execution_books")?"createtablepaper_execution_books(account_idtextprimarykey,revisionintegernotnull,payloadtextnotnull,sha256textnotnull)":"createtableandroid_metadata(localetext)";
   PaperAutomationModel.need(definition(c.getString(3)).equals(expected),"纸面执行库表定义不是已审阅结构，未重建");columns(db,name);if(name.equals("paper_execution_books"))book=true;else metadata=true;
  }}
  if(metadata){try(Cursor c=db.rawQuery("SELECT locale,typeof(locale) FROM android_metadata",null)){int n=0;while(c.moveToNext()){PaperAutomationModel.need(++n<=1&&"text".equals(c.getString(1)),"纸面执行库平台元数据异常");}}}
  if(create&&!book&&!index&&app==0&&version==0){db.execSQL("CREATE TABLE paper_execution_books(account_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL)");db.execSQL("PRAGMA application_id="+APP_ID);db.execSQL("PRAGMA user_version=1");schema(db,false);return;}
  PaperAutomationModel.need(app==APP_ID&&version==1&&book&&index,"不是本机F05纸面执行库或版本，未修改其他库");
  try(Cursor c=db.rawQuery("PRAGMA index_list(paper_execution_books)",null)){PaperAutomationModel.need(c.moveToFirst()&&"sqlite_autoindex_paper_execution_books_1".equals(c.getString(1))&&c.getInt(2)==1&&"pk".equals(c.getString(3))&&c.getInt(4)==0&&!c.moveToNext(),"纸面执行库主键索引结构异常");}
  try(Cursor c=db.rawQuery("PRAGMA index_xinfo(sqlite_autoindex_paper_execution_books_1)",null)){int n=0;while(c.moveToNext()){PaperAutomationModel.need(n<2&&c.getInt(0)==n&&c.getInt(1)==(n==0?0:-1)&&(n==0?"account_id".equals(c.getString(2)):c.isNull(2))&&c.getInt(3)==0&&"BINARY".equals(c.getString(4))&&c.getInt(5)==(n==0?1:0),"纸面执行库主键列或排序异常");n++;}PaperAutomationModel.need(n==2,"纸面执行库主键列缺失");}
 }
 private JSONObject load(SQLiteDatabase db,String id)throws Exception{
  long revision,characters;String hash;try(Cursor c=db.rawQuery("SELECT revision,length(payload),sha256 FROM paper_execution_books WHERE account_id=?",new String[]{id})){if(!c.moveToFirst())return new JSONObject();revision=c.getLong(0);characters=c.getLong(1);hash=c.getString(2);}
  PaperAutomationModel.need(characters>0&&characters<=LIMIT,"纸面执行账本超过16MiB，未截断");StringBuilder text=new StringBuilder();
  for(long start=1;start<=characters;start+=24000){try(Cursor c=db.rawQuery("SELECT substr(payload,?,24000) FROM paper_execution_books WHERE account_id=?",new String[]{Long.toString(start),id})){PaperAutomationModel.need(c.moveToFirst()&&!c.isNull(0),"纸面账本读取中改变");text.append(c.getString(0));}}
  PaperAutomationModel.need(text.codePointCount(0,text.length())==characters&&text.toString().getBytes(StandardCharsets.UTF_8).length<=LIMIT,"纸面执行账本分块不完整或超限");JSONObject b=new JSONObject(text.toString());
  PaperAutomationModel.need("native-paper-automation-book/v1".equals(b.optString("schema"))&&id.equals(b.optString("accountId"))&&b.getLong("revision")==revision&&PaperMonitorModel.hash(b).equals(hash),"纸面执行账本身份或指纹不符");return b;
 }
 JSONObject read(String id)throws Exception{return read(id,null);}
 JSONObject read(String id,ReadHook hook)throws Exception{
  requireApi(Build.VERSION.SDK_INT);if(!file.exists())return new JSONObject();
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,corrupt->{throw new SQLiteDatabaseCorruptException("纸面执行库损坏，拒绝自动删除或重建");})){
   PaperAutomationModel.need(db.isReadOnly(),"纸面执行读取连接须真正只读");Api35.begin(db);try{schema(db,false);if(hook!=null)hook.run(db);JSONObject b=load(db,id);db.setTransactionSuccessful();return b;}finally{db.endTransaction();}
  }
 }
 JSONObject transact(String id,long expected,Change change,Guard guard)throws Exception{
  requireApi(Build.VERSION.SDK_INT);
  PaperAutomationModel.need(id!=null&&!id.isEmpty()&&id.length()<=200&&expected>=-1&&expected<9007199254740990L,"纸面账本身份或版本无效");File parent=file.getAbsoluteFile().getParentFile();PaperAutomationModel.need(parent.isDirectory()||parent.mkdirs(),"纸面库目录不可写");
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.CREATE_IF_NECESSARY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,corrupt->{throw new SQLiteDatabaseCorruptException("纸面执行库损坏，拒绝自动删除或重建");})){try(Cursor timeout=db.rawQuery("PRAGMA busy_timeout=5000",null)){PaperAutomationModel.need(timeout.moveToFirst()&&timeout.getInt(0)==5000,"纸面执行等待设置失败");}db.execSQL("PRAGMA synchronous=FULL");db.beginTransaction();try{
    schema(db,true);JSONObject before=load(db,id);long revision=before.length()==0?-1:before.getLong("revision");PaperAutomationModel.need(revision==expected,"纸面执行账本已变化，请重新读取");JSONObject next=change.apply(PaperAutomationModel.copy(before));
    PaperAutomationModel.need(next!=null&&"native-paper-automation-book/v1".equals(next.optString("schema"))&&id.equals(next.optString("accountId")),"事务返回其他账户或无效状态");
    if(before.length()>0)PaperAutomationModel.need(next.getString("openingHash").equals(before.getString("openingHash"))&&PaperMonitorModel.equal(next.get("openingInput"),before.get("openingInput")),"事务不能覆盖起始材料");
    if(PaperMonitorModel.equal(next,before))return before;next.put("revision",revision+1);String payload=next.toString();PaperAutomationModel.need(payload.getBytes(StandardCharsets.UTF_8).length<=LIMIT,"纸面执行账本超过16MiB，未截断");
    db.execSQL("INSERT INTO paper_execution_books(account_id,revision,payload,sha256) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,sha256=excluded.sha256",new Object[]{id,revision+1,payload,PaperMonitorModel.hash(next)});
    PaperAutomationModel.need(guard==null||guard.canCommit(),"纸面事务已取消，未写入任何结果");db.setTransactionSuccessful();return next;
   }finally{db.endTransaction();}}
 }
}
