package org.marketreview.nativeapp;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.json.*;
final class CommentWorkshopStore {
  final File file;
  CommentWorkshopStore(File file) throws Exception {
    CommentWorkshopModel.require(file!=null&&file.isAbsolute(),"工坊库路径须为绝对路径");this.file=file;File dir=file.getParentFile();CommentWorkshopModel.require(dir.isDirectory()||dir.mkdirs(),"工坊库目录不可用");
    try(SQLiteDatabase db=open()){db.beginTransaction();try{int version=db.getVersion(),app=scalar(db,"PRAGMA application_id");if(version==0&&app==0){
      CommentWorkshopModel.require(scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='android_metadata'")==0,"目标不是空工坊库；未重建");
      try(Cursor c=db.rawQuery("PRAGMA table_info(android_metadata)",null)){if(c.moveToFirst())CommentWorkshopModel.require(c.getInt(0)==0&&c.getString(1).equals("locale")&&c.getString(2).equalsIgnoreCase("TEXT")&&c.getInt(3)==0&&c.isNull(4)&&c.getInt(5)==0&&!c.moveToNext(),"系统android_metadata结构无效；未重建");}
      db.execSQL("CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,scope TEXT NOT NULL,revision TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))");db.execSQL("CREATE INDEX workshop_scope ON records(kind,scope)");db.setVersion(1);db.execSQL("PRAGMA application_id="+0x43575331);
    }else CommentWorkshopModel.require(version==1&&app==0x43575331,"工坊库版本或身份不支持，未重建");try(Cursor c=db.rawQuery("SELECT kind,id,scope,revision,payload FROM records LIMIT 0",null)){c.moveToFirst();}db.setTransactionSuccessful();}finally{db.endTransaction();}}
  }
  SQLiteDatabase open(){return SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.CREATE_IF_NECESSARY);}
  static int scalar(SQLiteDatabase db,String sql){try(Cursor c=db.rawQuery(sql,null)){CommentWorkshopModel.require(c.moveToFirst(),"工坊库查询失败");return c.getInt(0);}}
  static JSONObject get(SQLiteDatabase db,String kind,String id) throws Exception {
    int characters,bytes;try(Cursor c=db.rawQuery("SELECT length(payload),length(CAST(payload AS BLOB)) FROM records WHERE kind=? AND id=?",new String[]{kind,id})){if(!c.moveToFirst())return new JSONObject();characters=c.getInt(0);bytes=c.getInt(1);}
    CommentWorkshopModel.require(bytes<=SourceAnalysisPacket.BYTE_LIMIT,"工坊记录超过25MiB；未截断读取");StringBuilder out=new StringBuilder(characters);
    for(int start=1;start<=characters;start+=131072)try(Cursor c=db.rawQuery("SELECT substr(payload,?,131072) FROM records WHERE kind=? AND id=?",new String[]{Integer.toString(start),kind,id})){CommentWorkshopModel.require(c.moveToFirst(),"工坊记录读取期间已改变");out.append(c.getString(0));}return new JSONObject(out.toString());
  }
  static JSONObject content(JSONObject row) throws Exception {JSONObject out=SourceAnalysisPacket.copy(row);out.remove("recordRevision");return out;}
  static void insert(SQLiteDatabase db,JSONObject row) throws Exception {ContentValues values=new ContentValues();values.put("kind",row.getString("kind"));values.put("id",row.getString("id"));values.put("scope",row.optString("kind").equals("observations")?row.optString("channelKey"):CommentWorkshopModel.obj(row,"sourceRef").optString("bundleId"));values.put("revision",row.optString("recordRevision"));values.put("payload",SourceAnalysisPacket.json(row));db.insertOrThrow("records",null,values);}
  JSONObject get(String kind,String id) throws Exception {try(SQLiteDatabase db=open()){db.beginTransaction();try{JSONObject row=get(db,kind,id);db.setTransactionSuccessful();return row;}finally{db.endTransaction();}}}
  JSONArray list(String kind,int offset) throws Exception {
    CommentWorkshopModel.require(offset>=0,"分页位置无效");JSONArray out=new JSONArray();try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT id FROM records WHERE kind=? ORDER BY rowid DESC LIMIT 50 OFFSET ?",new String[]{kind,Integer.toString(offset)})){while(c.moveToNext()){JSONObject row=get(db,kind,c.getString(0));if(kind.equals("observations")){JSONObject summary=new JSONObject();for(String k:new String[]{"id","kind","title","channelName","observationId","publishedAt","sourceKey"})summary.put(k,row.optString(k));summary.put("commentCount",row.getJSONArray("comments").length()).put("coverage",row.getJSONObject("coverage"));out.put(summary);}else out.put(row);}}return out;
  }
  JSONObject labels(String bundleId) throws Exception {JSONObject out=new JSONObject();try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT id FROM records WHERE kind='labels' AND scope=?",new String[]{bundleId})){while(c.moveToNext()){String id=c.getString(0);out.put(id,get(db,"labels",id).optString("label"));}}return out;}
  JSONObject put(JSONObject input,String expectedRevision) throws Exception {
    JSONObject row=CommentWorkshopModel.validate(SourceAnalysisPacket.copy(input));CommentWorkshopModel.require(!row.optString("kind").equals("observations")&&!row.optString("kind").equals("archives"),"原评论快照只允许明确导入，不直接覆盖");
    try(SQLiteDatabase db=open()){db.beginTransaction();try{JSONObject old=get(db,row.getString("kind"),row.getString("id"));CommentWorkshopModel.require(old.optString("recordRevision").equals(expectedRevision),"其他入口已更新此记录；旧草稿未覆盖，请重读");row.put("recordRevision",UUID.randomUUID().toString());db.delete("records","kind=? AND id=?",new String[]{row.getString("kind"),row.getString("id")});insert(db,row);db.setTransactionSuccessful();return row;}finally{db.endTransaction();}}
  }
  JSONObject preview(String json) throws Exception {JSONArray input=CommentWorkshopModel.normalize(json),rows=new JSONArray();Set<String> ids=new HashSet<>();int added=0,duplicate=0,conflict=0;
    try(SQLiteDatabase db=open()){for(int i=0;i<input.length();i++){JSONObject row=input.getJSONObject(i);String key=row.getString("kind")+":"+row.getString("id");CommentWorkshopModel.require(ids.add(key),"同一导入文件存在重复记录身份；请先核对");JSONObject old=get(db,row.getString("kind"),row.getString("id"));String state;if(old.length()==0){state="new";added++;}else if(CommentWorkshopModel.canonical(content(old)).equals(CommentWorkshopModel.canonical(content(row)))){state="duplicate";duplicate++;}else{state="conflict";conflict++;}rows.put(new JSONObject().put("record",row).put("state",state));}}
    return new JSONObject().put("schema","comment-workshop-preview-v1").put("rows",rows).put("newCount",added).put("duplicateCount",duplicate).put("conflictCount",conflict).put("policy","keep-existing; changed-source-is-distinct-snapshot");
  }
  JSONObject merge(JSONObject preview) throws Exception {return merge(preview,null);}
  JSONObject merge(JSONObject preview,String expectedPreviewRevision) throws Exception {CommentWorkshopModel.require(preview.optString("schema").equals("comment-workshop-preview-v1")&&preview.optJSONArray("rows")!=null,"请先预览工坊导入");int added=0,duplicate=0,conflict=0;String clearedRevision="";
    try(SQLiteDatabase db=open()){db.beginTransaction();try{
      if(expectedPreviewRevision!=null){JSONObject staged=get(db,"previews","import-preview");CommentWorkshopModel.require(staged.optString("recordRevision").equals(expectedPreviewRevision)&&CommentWorkshopModel.canonical(CommentWorkshopModel.obj(staged,"preview")).equals(CommentWorkshopModel.canonical(preview)),"另一入口已更新预览；未合并旧预览，请重读");}
      JSONArray rows=preview.getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject row=CommentWorkshopModel.validate(SourceAnalysisPacket.copy(rows.getJSONObject(i).getJSONObject("record")));CommentWorkshopModel.require(!row.optString("kind").equals("previews"),"未确认预览不能作为证据合并");JSONObject old=get(db,row.getString("kind"),row.getString("id"));if(old.length()>0){if(CommentWorkshopModel.canonical(content(old)).equals(CommentWorkshopModel.canonical(content(row))))duplicate++;else conflict++;continue;}if(row.optString("recordRevision").isEmpty())row.put("recordRevision",UUID.randomUUID().toString());insert(db,row);added++;}
      if(expectedPreviewRevision!=null){clearedRevision=UUID.randomUUID().toString();db.delete("records","kind='previews' AND id='import-preview'",null);insert(db,new JSONObject().put("kind","previews").put("id","import-preview").put("preview",new JSONObject()).put("recordRevision",clearedRevision));}db.setTransactionSuccessful();
    }finally{db.endTransaction();}}
    return new JSONObject().put("added",added).put("duplicate",duplicate).put("conflict",conflict).put("policy","keep-existing").put("previewRevision",clearedRevision);
  }
  JSONObject archiveRule(String id,String revision) throws Exception {try(SQLiteDatabase db=open()){db.beginTransaction();try{JSONObject row=get(db,"rules",id);CommentWorkshopModel.require(row.length()>0&&row.optString("recordRevision").equals(revision),"规则卡已改变，未移除");JSONObject archive=new JSONObject().put("kind","archives").put("id",UUID.randomUUID().toString()).put("record",row).put("archivedAt",Instant.now().toString()).put("recordRevision",UUID.randomUUID().toString());insert(db,archive);db.delete("records","kind='rules' AND id=?",new String[]{id});db.setTransactionSuccessful();return archive;}finally{db.endTransaction();}}}
  JSONObject restoreRule(String archiveId) throws Exception {try(SQLiteDatabase db=open()){db.beginTransaction();try{JSONObject archived=get(db,"archives",archiveId),row=CommentWorkshopModel.validate(SourceAnalysisPacket.copy(archived.getJSONObject("record")));CommentWorkshopModel.require(row.optString("kind").equals("rules")&&get(db,"rules",row.getString("id")).length()==0,"原规则卡无效或同ID已存在；未覆盖恢复");row.put("recordRevision",UUID.randomUUID().toString());insert(db,row);db.setTransactionSuccessful();return row;}finally{db.endTransaction();}}}
  byte[] backup() throws Exception {JSONArray rows=new JSONArray();long total=0;try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT kind,id,length(CAST(payload AS BLOB)) FROM records WHERE kind!='previews' ORDER BY kind,id",null)){while(c.moveToNext()){total+=c.getLong(2);CommentWorkshopModel.require(total<=SourceAnalysisPacket.BYTE_LIMIT,"工坊备份超过25MiB；未截断");rows.put(get(db,c.getString(0),c.getString(1)));}}return SourceAnalysisPacket.json(new JSONObject().put("schema","comment-workshop-v1").put("records",rows).put("mergePolicy","keep-existing")).getBytes(StandardCharsets.UTF_8);}
}
