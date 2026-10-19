package org.marketreview.nativeapp;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.content.ContentValues;
import org.json.*;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;

public final class WatchlistWorkspaceStore {
 private static final DatabaseErrorHandler KEEP_CORRUPT_FILE=corrupt->{throw new SQLiteDatabaseCorruptException("独立分组库损坏；原文件保留，拒绝自动删除或重建");};
 static boolean sqliteHeader(File file){try(InputStream in=new FileInputStream(file)){byte[] header=new byte[16];int offset=0,n;while(offset<header.length&&(n=in.read(header,offset,header.length-offset))>0)offset+=n;return offset==16&&Arrays.equals(header,"SQLite format 3\000".getBytes(StandardCharsets.US_ASCII));}catch(java.io.IOException error){return false;}}
 private final File file;
 private static final int APPLICATION_ID=1465340725,LIMIT=32*1024*1024;
 static String revision(){return "groups:"+UUID.randomUUID();}
 static JSONObject inputSnapshot(JSONObject inputs,String rev,JSONArray groups)throws Exception{need(inputs.opt("instruments") instanceof JSONArray&&inputs.opt("mainIds") instanceof JSONArray,"宿主需注入完整当前目录和主自选身份");return validate(object("schema","watchlist-workspace/v1","revision",rev,"instruments",inputs.get("instruments"),"mainIds",inputs.get("mainIds"),"groups",groups));}
 static void groupsOnly(JSONArray groups)throws Exception{for(int i=0;i<groups.length();i++){JSONObject g=groups.getJSONObject(i);for(String k:new String[]{"instruments","items","quote","day","minute","week","month","year"})need(!g.has(k),"旧组视图需提供明确memberIds和配置，不得嵌入行情对象");if(Boolean.TRUE.equals(g.opt("readOnly")))need(g.opt("sourceId") instanceof String&&!g.getString("sourceId").trim().isEmpty(),"只读组需明确保留sourceId，未猜来源");}}
 static JSONObject config(JSONObject snapshot)throws Exception{validate(snapshot);groupsOnly(snapshot.getJSONArray("groups"));return object("schema","watchlist-workspace-config/v1","revision",snapshot.get("revision"),"mainIds",snapshot.get("mainIds"),"groups",snapshot.get("groups"));}
 static JSONObject validateConfig(JSONObject c)throws Exception{need(text(c,"schema").equals("watchlist-workspace-config/v1"),"持久分组格式不支持");Set<String>keys=new HashSet<>();c.keys().forEachRemaining(keys::add);need(keys.equals(new HashSet<>(Arrays.asList("groups","mainIds","revision","schema"))),"独立分组记录含非配置字段");ids(c.opt("mainIds"),true);need(c.opt("groups") instanceof JSONArray,"持久分组清单缺失");JSONArray dummy=new JSONArray(),main=c.getJSONArray("mainIds");for(int i=0;i<main.length();i++)dummy.put(object("id",main.get(i),"name",main.get(i)));inputSnapshot(object("instruments",dummy,"mainIds",main),text(c,"revision"),c.getJSONArray("groups"));groupsOnly(c.getJSONArray("groups"));return c;}
 static JSONObject project(JSONObject inputs)throws Exception{inputSnapshot(inputs,"projection-validation",new JSONArray());need(inputs.opt("legacyGroups") instanceof JSONArray,"首次投影需明确旧组配置数组；未按名称猜成员");JSONArray out=new JSONArray(),legacy=inputs.getJSONArray("legacyGroups");for(int i=0;i<legacy.length();i++){JSONObject g=copy(legacy.getJSONObject(i));need(g.opt("readOnly") instanceof Boolean,"旧组需明确只读状态");if(!g.has("groupId")){need(!g.getBoolean("readOnly"),"只读导入组需原始完整groupId，未生成来源身份");g.put("groupId","local:"+UUID.randomUUID());}else need(g.opt("groupId") instanceof String&&!g.getString("groupId").trim().isEmpty(),"旧组显式身份无效");out.put(g);}return config(inputSnapshot(inputs,revision(),out));}
 static JSONObject result(JSONObject stored,JSONObject inputs)throws Exception{inputSnapshot(inputs,"input-validation",new JSONArray());if(stored.length()==0)return object("schema","watchlist-workspace-store-result/v1","state","uninitialized");validateConfig(stored);JSONArray oldIds=stored.getJSONArray("mainIds"),nowIds=inputs.getJSONArray("mainIds");if(equal(oldIds,nowIds))return object("schema","watchlist-workspace-store-result/v1","state","ready","config",stored,"snapshot",inputSnapshot(inputs,text(stored,"revision"),stored.getJSONArray("groups")));Set<String>oldSet=ids(oldIds,true),nowSet=ids(nowIds,true);JSONArray added=new JSONArray(),removed=new JSONArray(),orphans=new JSONArray();for(int i=0;i<nowIds.length();i++)if(!oldSet.contains(nowIds.getString(i)))added.put(nowIds.get(i));for(int i=0;i<oldIds.length();i++)if(!nowSet.contains(oldIds.getString(i)))removed.put(oldIds.get(i));JSONArray groups=stored.getJSONArray("groups");for(int i=0;i<groups.length();i++){JSONObject g=groups.getJSONObject(i);JSONArray ms=g.getJSONArray("memberIds"),missing=new JSONArray();for(int j=0;j<ms.length();j++)if(!nowSet.contains(ms.getString(j)))missing.put(ms.get(j));if(missing.length()>0)orphans.put(object("groupId",g.get("groupId"),"name",g.get("name"),"missingIds",missing));}return object("schema","watchlist-workspace-store-result/v1","state","needsReconciliation","config",stored,"reconciliation",object("storedMainIds",oldIds,"currentMainIds",nowIds,"addedIds",added,"removedIds",removed,"orphanMemberships",orphans,"orderChanged",oldSet.equals(nowSet),"message","主自选范围或顺序变化，需明确协调；原组和缺失成员仍完整保留，未改保存语义"));}
 static String sha(byte[]bytes)throws Exception{byte[]digest=MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder out=new StringBuilder();for(byte v:digest)out.append(String.format(Locale.ROOT,"%02x",v&255));return out.toString();}
 public WatchlistWorkspaceStore(Context c,String filename)throws Exception{need(filename!=null&&filename.matches("[A-Za-z0-9._-]+")&&!filename.equals(".")&&!filename.equals(".."),"需明确独立分组数据库名");file=new File(c.getFilesDir(),filename);try(SQLiteDatabase db=open()){}}

 // Safe static overload avoids the legacy constructor, which initializes a missing DB.
 public static JSONObject readExisting(File existingFile,JSONObject inputs)throws Exception{
  if(android.os.Build.VERSION.SDK_INT<35)throw new UnsupportedOperationException("当前Android不支持正式只读事务；安全读取不可用，未降级为写事务");
  need(existingFile!=null&&existingFile.isFile(),"分组库不存在或不是文件，未创建");
  need(sqliteHeader(existingFile),"分组库文件头无效；保留原文件");
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(existingFile.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,KEEP_CORRUPT_FILE)){
   db.beginTransactionReadOnly();
   try{
    need(marker(db)==APPLICATION_ID,"拒绝读取非本模块分组库");
    List<String> names=new ArrayList<>();try(Cursor q=db.rawQuery("PRAGMA table_info(watchlist_workspace)",null)){while(q.moveToNext())names.add(q.getString(1));}
    need(names.equals(Arrays.asList("k","body","sha256")),"独立分组库结构损坏，未重建");
    JSONObject out=copy(result(readConfig(db),inputs));need("ready".equals(out.optString("state")),"分组库未初始化或主自选需协调；安全读取不可用，未修复");
    db.setTransactionSuccessful();return out;
   }finally{db.endTransaction();}
  }
 }
 public JSONObject readExisting(JSONObject inputs)throws Exception{return readExisting(file,inputs);}

 public File filePath(){return file;}
 private static int marker(SQLiteDatabase db)throws Exception{try(Cursor q=db.rawQuery("PRAGMA application_id",null)){need(q.moveToFirst(),"独立分组库身份不可读");return q.getInt(0);}}
 private static void pragma(SQLiteDatabase db,String sql){try(Cursor q=db.rawQuery(sql,null)){q.moveToFirst();}}
 private SQLiteDatabase open()throws Exception{boolean fresh=false;if(!file.exists()){need(file.createNewFile(),"分组库路径出现并发文件，请重读；未采用外来库");fresh=true;}if(!fresh)need(sqliteHeader(file),"独立分组库文件头无效；保留原文件，未打开或重建");if(!fresh)try(SQLiteDatabase guard=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY,KEEP_CORRUPT_FILE)){need(marker(guard)==APPLICATION_ID,"拒绝打开非本模块分组库，未改旧库");}SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.CREATE_IF_NECESSARY,KEEP_CORRUPT_FILE);try{need(marker(db)==(fresh?0:APPLICATION_ID),"分组库身份已变化，未写");pragma(db,"PRAGMA busy_timeout=1500");if(fresh){db.beginTransactionNonExclusive();try{pragma(db,"PRAGMA application_id=1465340725");need(marker(db)==APPLICATION_ID,"分组库标记写入失败，未建表");db.execSQL("CREATE TABLE watchlist_workspace(k TEXT PRIMARY KEY CHECK(k='active'),body TEXT NOT NULL,sha256 TEXT NOT NULL)");db.setTransactionSuccessful();}finally{db.endTransaction();}}List<String>names=new ArrayList<>();try(Cursor q=db.rawQuery("PRAGMA table_info(watchlist_workspace)",null)){while(q.moveToNext())names.add(q.getString(1));}need(names.equals(Arrays.asList("k","body","sha256")),"独立分组库结构损坏，未重建");return db;}catch(Exception e){db.close();throw e;}}
 private static JSONObject readConfig(SQLiteDatabase db)throws Exception{int length;String checksum;try(Cursor q=db.rawQuery("SELECT length(body),sha256 FROM watchlist_workspace WHERE k='active'",null)){if(!q.moveToFirst())return new JSONObject();long chars=q.getLong(0);need(chars>=0&&chars<=LIMIT,"分组配置长度无效");length=(int)chars;checksum=q.getString(1);need(checksum!=null&&checksum.matches("[0-9a-f]{64}"),"分组配置校验值无效");}StringBuilder raw=new StringBuilder();for(int offset=1;offset<=length;offset+=24000)try(Cursor q=db.rawQuery("SELECT substr(body,?,24000) FROM watchlist_workspace WHERE k='active'",new String[]{Integer.toString(offset)})){need(q.moveToFirst(),"分组长原文分块读取失败");raw.append(q.getString(0));}byte[]bytes=raw.toString().getBytes(StandardCharsets.UTF_8);need(bytes.length<=LIMIT&&sha(bytes).equals(checksum),"分组配置校验失败，未重建或截断");return validateConfig(new JSONObject(raw.toString()));}
 private static void writeConfig(SQLiteDatabase db,JSONObject c,boolean insert)throws Exception{validateConfig(c);String raw=c.toString();byte[]bytes=raw.getBytes(StandardCharsets.UTF_8);need(bytes.length<=LIMIT,"分组配置超过32MiB，未截断");ContentValues values=new ContentValues();values.put("body",raw);values.put("sha256",sha(bytes));if(insert){values.put("k","active");db.insertOrThrow("watchlist_workspace",null,values);}else need(db.update("watchlist_workspace",values,"k='active'",null)==1,"完整分组配置保存失败");need(equal(readConfig(db),c),"分组配置写后回读不一致，未确认提交");}
 public JSONObject read(JSONObject inputs)throws Exception{try(SQLiteDatabase db=open()){db.execSQL("BEGIN");try{JSONObject out=copy(result(readConfig(db),inputs));db.execSQL("COMMIT");return out;}catch(Exception e){db.execSQL("ROLLBACK");throw e;}}}
 public JSONObject initialize(JSONObject inputs)throws Exception{try(SQLiteDatabase db=open()){db.beginTransactionNonExclusive();try{JSONObject current=readConfig(db);if(current.length()==0){current=project(inputs);writeConfig(db,current,true);}JSONObject out=copy(result(current,inputs));db.setTransactionSuccessful();return out;}finally{db.endTransaction();}}}
 public JSONObject save(JSONObject change,JSONObject inputs)throws Exception{try(SQLiteDatabase db=open()){db.beginTransactionNonExclusive();try{JSONObject current=result(readConfig(db),inputs);need(current.getString("state").equals("ready"),"分组库未初始化或主自选变化需明确协调，未丢成员");JSONObject before=current.getJSONObject("snapshot"),saved=acceptChange(before,change,revision());if(!equal(saved.get("revision"),before.get("revision")))writeConfig(db,config(saved),false);JSONObject receipt=copy(saved);db.setTransactionSuccessful();return receipt;}finally{db.endTransaction();}}}
}
