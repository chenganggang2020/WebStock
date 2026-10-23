package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteDatabaseCorruptException;
import android.os.Build;
import java.io.File;
import java.util.ArrayList;
import org.json.*;
final class SectorRelationStore {
 final File research,business;
 SectorRelationStore(File research,File business){this.research=research;this.business=business;}
 static SQLiteDatabase businessSnapshot(File file)throws Exception{
  SectorReportReader.requireApi(Build.VERSION.SDK_INT);SectorAiModel.need(file.isFile(),"原业务库不存在，未创建");
  SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,corrupt->{throw new SQLiteDatabaseCorruptException("原业务库损坏，拒绝删除修复");});
  try{SectorAiModel.need(db.isReadOnly(),"业务读取必须只读");Api35.begin(db);try(Cursor c=db.rawQuery("SELECT kind,id,payload FROM records LIMIT 0",null)){}return db;}catch(Exception e){db.close();throw e;}
 }
 static final class Api35{static void begin(SQLiteDatabase db){db.beginTransactionReadOnly();}}
 static JSONObject load(SQLiteDatabase db,String table,String kind,String id,int limit)throws Exception{
  long length;try(Cursor c=db.rawQuery("SELECT length(CAST(payload AS BLOB)) FROM "+table+" WHERE kind=? AND id=?",new String[]{kind,id})){
   SectorAiModel.need(c.moveToFirst(),"原件缺失");length=c.getLong(0);SectorAiModel.need(length>0&&length<=limit,"原件长度无效或超过上限");
  }
  java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream((int)length);
  for(int offset=0;offset<length;){int count=(int)Math.min(65536,length-offset);try(Cursor c=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,?) FROM "+table+" WHERE kind=? AND id=?",new String[]{String.valueOf(offset+1),String.valueOf(count),kind,id})){
   SectorAiModel.need(c.moveToFirst(),"原件读取时变化");byte[] part=c.getBlob(0);SectorAiModel.need(part!=null&&part.length==count,"原件分块不完整");bytes.write(part);offset+=count;
  }}
  JSONObject r=CreatorAiModel.parseObject(bytes.toByteArray());SectorAiModel.need(id.equals(r.opt("id")),"存储身份不符");return r;
 }
 static JSONArray rows(SQLiteDatabase db,String table,String kind,String topic)throws Exception{
  ArrayList<String> ids=new ArrayList<>();long total=0;
  try(Cursor c=db.rawQuery("SELECT id,length(CAST(payload AS BLOB)) FROM "+table+" WHERE kind=? ORDER BY id LIMIT 10001",new String[]{kind})){
   while(c.moveToNext()){long n=c.getLong(1);SectorAiModel.need(n>0&&n<=1048576,"业务记录长度无效");total+=n;SectorAiModel.need(total<=25*1024*1024,"业务快照超过25MiB，未截断");ids.add(c.getString(0));}
  }
  SectorAiModel.need(ids.size()<=10000,"业务记录超过10000条，未截断");JSONArray result=new JSONArray();
  for(String id:ids){JSONObject r=load(db,table,kind,id,1048576);if(topic.isEmpty()||topic.equals(r.opt("topicId")))result.put(r);}return result;
 }
 static ArrayList<String> ids(SQLiteDatabase db,String topic)throws Exception{
  ArrayList<String> ids=new ArrayList<>();try(Cursor c=db.rawQuery("SELECT id FROM records WHERE kind='relation-reviews'"+(topic.isEmpty()?"":" AND json_extract(payload,'$.topicId')=?")+" ORDER BY rowid DESC LIMIT 1001",topic.isEmpty()?null:new String[]{topic})){
   while(c.moveToNext()){String id=c.getString(0);SectorAiModel.need(id.matches("relation-reviews:[0-9a-f]{64}"),"复核历史身份无效");ids.add(id);}
  }SectorAiModel.need(ids.size()<=1000,"复核历史已满，原件保留");return ids;
 }
 static JSONObject head(SQLiteDatabase db,String topic)throws Exception{
  ArrayList<String> ids=ids(db,topic);if(ids.isEmpty())return new JSONObject().put("id","").put("sequence",0);
  JSONObject r=SectorRelationReview.validateVersion(load(db,"records","relation-reviews",ids.get(0),8388608));
  SectorAiModel.need(topic.equals(r.opt("topicId")),"历史主题不符");return new JSONObject().put("id",r.get("id")).put("sequence",r.get("sequence"));
 }
 static void sources(SQLiteDatabase db,String table,JSONObject source)throws Exception{
  JSONArray docs=source.getJSONObject("plan").getJSONArray("materials");
  for(int i=0;i<docs.length();i++){JSONObject d=docs.getJSONObject(i);SectorAiModel.need(SectorAiModel.equal(load(db,table,d.getString("kind"),d.getString("id"),1048576),d.getJSONObject("row")),"完整来源已变化；请重新加载并选择来源、生成报告");}
 }
 JSONArray topics()throws Exception{try(SQLiteDatabase db=businessSnapshot(business)){try{return rows(db,"records","topics","");}finally{db.endTransaction();}}}
 JSONObject preview(String report,String topic)throws Exception{
  try(SQLiteDatabase db=SectorReportReader.open(research)){try{
   JSONObject original=SectorAiModel.validateRecord(load(db,"records","ai-reports",report,8388608)),source=SectorRelationReview.source(original),previous=head(db,topic);
   try(SQLiteDatabase evidence=businessSnapshot(business)){try{JSONObject target=load(evidence,"records","topics",topic,1048576);sources(evidence,"records",source);return SectorRelationReview.preview(source,target,rows(evidence,"records","relations",topic),previous);}finally{evidence.endTransaction();}}
  }finally{db.endTransaction();}}
 }
 ArrayList<String> versions(String topic)throws Exception{try(SQLiteDatabase db=SectorReportReader.open(research)){try{return ids(db,topic);}finally{db.endTransaction();}}}
 JSONObject readVersion(String id)throws Exception{try(SQLiteDatabase db=SectorReportReader.open(research)){try{return SectorRelationReview.validateVersion(load(db,"records","relation-reviews",id,8388608));}finally{db.endTransaction();}}}
 void save(JSONObject version,java.util.function.BooleanSupplier cancelled)throws Exception{
  active(cancelled);SectorRelationReview.validateVersion(version);JSONObject p=version.getJSONObject("preview");
  SectorAiModel.need(research.isFile()&&business.isFile(),"原库不存在，未创建");SectorAiModel.need(!research.getCanonicalPath().equals(business.getCanonicalPath()),"研究库与业务库不能相同");
  try(SQLiteDatabase db=SQLiteDatabase.openDatabase(research.getAbsolutePath(),null,SQLiteDatabase.OPEN_READWRITE|SQLiteDatabase.NO_LOCALIZED_COLLATORS,corrupt->{throw new SQLiteDatabaseCorruptException("研究库损坏；拒绝自动删除修复");})){
   try(Cursor c=db.rawQuery("PRAGMA application_id",null)){SectorAiModel.need(c.moveToFirst()&&c.getInt(0)==1397903921,"研究库身份不符");}
   // Android's framework connection does not enable SQLite URI filenames.
   // Keep the existing-file check adjacent to the parameter-bound native path.
   String evidencePath=business.getCanonicalPath();SectorAiModel.need(new File(evidencePath).isFile(),"原业务库不存在，未创建");
   db.execSQL("ATTACH DATABASE ? AS evidence",new Object[]{evidencePath});db.beginTransactionNonExclusive();try{
    active(cancelled);JSONObject source=p.getJSONObject("source"),topic=p.getJSONObject("topic");String topicId=topic.getString("id");
    SectorAiModel.need(SectorAiModel.equal(SectorRelationReview.source(load(db,"records","ai-reports",source.getString("id"),8388608)),source),"报告原件已变化");
    SectorAiModel.need(SectorAiModel.equal(load(db,"evidence.records","topics",topicId,1048576),topic),"目标主题已变化");sources(db,"evidence.records",source);
    SectorAiModel.need(SectorAiModel.equal(head(db,topicId),p.getJSONObject("previous")),"另一入口已追加复核版本，请重新预览");
    SectorAiModel.need(SectorAiModel.equal(SectorRelationReview.preview(source,topic,rows(db,"evidence.records","relations",topicId),p.getJSONObject("previous")),p),"已有关系已变化，请重新预览");
    try(Cursor c=db.rawQuery("SELECT count(*) FROM records WHERE kind='relation-reviews'",null)){c.moveToFirst();SectorAiModel.need(c.getInt(0)<1000,"复核历史已满1000条");}
    JSONArray inserts=version.getJSONArray("inserts");for(int i=0;i<inserts.length();i++){
     active(cancelled);JSONObject relation=inserts.getJSONObject(i),valid=BusinessStore.validate("relations",relation);valid.put("updatedAt",version.get("createdAt"));SectorAiModel.need(SectorAiModel.equal(valid,relation),"关系不符合现有业务保存合同");
     JSONObject doc=load(db,"evidence.records","docs",relation.getString("documentId"),1048576);SectorAiModel.need(doc.optString("text").contains(relation.getString("quote")),"引用已不在原正文");
     db.execSQL("INSERT INTO evidence.records(kind,id,payload) VALUES('relations',?,?)",new Object[]{relation.getString("id"),SectorResearchModel.json(relation)});active(cancelled);
    }
    db.execSQL("INSERT INTO records(kind,id,payload) VALUES('relation-reviews',?,?)",new Object[]{version.getString("id"),SectorResearchModel.json(version)});active(cancelled);db.setTransactionSuccessful();
   }finally{db.endTransaction();}
  }
 }
 static void active(java.util.function.BooleanSupplier cancelled){SectorAiModel.need(cancelled!=null&&!cancelled.getAsBoolean(),"复核已取消，未保存");}
}
