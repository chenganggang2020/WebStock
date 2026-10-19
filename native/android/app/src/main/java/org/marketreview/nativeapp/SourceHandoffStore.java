package org.marketreview.nativeapp;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import org.json.*;

final class SourceHandoffStore {
  static final int APPLICATION_ID=0x53484431;
  final File file;
  SourceHandoffStore(File file) throws Exception {
    SourceAnalysisPacket.require(file!=null&&file.isAbsolute(),"交接库须为独立绝对路径");this.file=file;
    File dir=file.getParentFile();SourceAnalysisPacket.require(dir.isDirectory()||dir.mkdirs(),"无法创建交接库目录");
    try(SQLiteDatabase db=open()) {
      db.beginTransaction();try {
        int version=db.getVersion(),app=scalar(db,"PRAGMA application_id");
        if(version==0&&app==0){SourceAnalysisPacket.require(scalar(db,"SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='android_metadata'")==0,"目标不是空交接库，未修改原表");
          try(Cursor metadata=db.rawQuery("PRAGMA table_info(android_metadata)",null)) {
            if(metadata.moveToFirst())SourceAnalysisPacket.require(metadata.getInt(0)==0&&metadata.getString(1).equals("locale")&&metadata.getString(2).equalsIgnoreCase("TEXT")&&metadata.getInt(3)==0&&metadata.isNull(4)&&metadata.getInt(5)==0&&!metadata.moveToNext(),"android_metadata结构不符合系统元数据；未修改原库");
          }
          db.execSQL("CREATE TABLE handoffs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,saved_at TEXT NOT NULL,payload TEXT NOT NULL)");db.execSQL("CREATE TABLE drafts(id TEXT PRIMARY KEY,payload TEXT NOT NULL)");db.execSQL("PRAGMA application_id="+APPLICATION_ID);db.setVersion(1);
        } else SourceAnalysisPacket.require(version==1&&app==APPLICATION_ID,"交接库版本或身份不支持，未重建");
        try(Cursor ignored=db.rawQuery("SELECT id,kind,saved_at,payload FROM handoffs LIMIT 0",null)){ignored.moveToFirst();}
        try(Cursor ignored=db.rawQuery("SELECT id,payload FROM drafts LIMIT 0",null)){ignored.moveToFirst();}
        db.setTransactionSuccessful();
      } finally {db.endTransaction();}
    }
  }
  SQLiteDatabase open(){return SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.CREATE_IF_NECESSARY);}
  static int scalar(SQLiteDatabase db,String sql){try(Cursor c=db.rawQuery(sql,null)){SourceAnalysisPacket.require(c.moveToFirst(),"交接库查询失败");return c.getInt(0);}}
  static void size(JSONObject row) throws Exception {SourceAnalysisPacket.size(row);}
  static JSONObject validate(JSONObject row) throws Exception {
    for(String k:new String[]{"id","title","prompt","result","kind","savedAt"})SourceAnalysisPacket.require(row.opt(k) instanceof String,"交接字段无效："+k);
    SourceAnalysisPacket.require(!row.getString("id").isEmpty()&&row.getString("id").length()<=300&&!row.getString("result").trim().isEmpty(),"交接身份或结果为空");
    SourceAnalysisPacket.require(row.optJSONArray("sourceReferences")!=null,"交接来源列表无效");size(row);return row;
  }
  // Bounded substr reads also work on API26's small CursorWindow; never truncate a large history body.
  static JSONObject payload(SQLiteDatabase db,String table,String id) throws Exception {
    SourceAnalysisPacket.require(table.equals("handoffs")||table.equals("drafts"),"交接表无效");int characters,bytes;
    try(Cursor c=db.rawQuery("SELECT length(payload),length(CAST(payload AS BLOB)) FROM "+table+" WHERE id=?",new String[]{id})){if(!c.moveToFirst())return null;characters=c.getInt(0);bytes=c.getInt(1);}
    SourceAnalysisPacket.require(bytes<=SourceAnalysisPacket.BYTE_LIMIT,"记录超过25MiB，未截断读取");StringBuilder text=new StringBuilder(characters);
    for(int start=1;start<=characters;start+=131072){try(Cursor c=db.rawQuery("SELECT substr(payload,?,131072) FROM "+table+" WHERE id=?",new String[]{Integer.toString(start),id})){SourceAnalysisPacket.require(c.moveToFirst(),"交接记录读取期间已改变");text.append(c.getString(0));}}
    return new JSONObject(text.toString());
  }
  static JSONObject lookup(SQLiteDatabase db,String id) throws Exception {return payload(db,"handoffs",id);}
  static void insert(SQLiteDatabase db,JSONObject row) throws Exception {ContentValues v=new ContentValues();v.put("id",row.getString("id"));v.put("kind",row.getString("kind"));v.put("saved_at",row.getString("savedAt"));v.put("payload",SourceAnalysisPacket.json(row));db.insertOrThrow("handoffs",null,v);}
  JSONObject saveResult(JSONObject packet,String title,String answer) throws Exception {
    SourceAnalysisPacket.require(packet.optString("schema").equals("source-analysis-packet-v1")&&!packet.optString("markdown").isEmpty()&&packet.getJSONArray("sourceReferences").length()>0,"请先生成完整来源材料");
    JSONObject result=SourceAnalysisPacket.extractResult(answer);
    JSONObject row=new JSONObject().put("id",UUID.randomUUID().toString()).put("title",title.trim().isEmpty()?packet.getString("title"):title)
        .put("summary","用户手动回填，待核验；仅保存本机交接记录").put("prompt",packet.getString("markdown")).put("result",result.getString("text")).put("rawResult",answer)
        .put("kind","source-analysis").put("context",packet.optString("subject")).put("savedAt",Instant.now().toString()).put("provenance","manual-unverified")
        .put("sourceReferences",packet.getJSONArray("sourceReferences")).put("packet",packet).put("bodyHash",SourceAnalysisPacket.hash(result.getString("text")));
    validate(row);try(SQLiteDatabase db=open()){insert(db,row);}return SourceAnalysisPacket.copy(row);
  }
  JSONObject saveDraft(JSONObject row) throws Exception {return saveDraft(row,"");}
  JSONObject saveDraft(JSONObject input,String expectedRevision) throws Exception {
    size(input);try(SQLiteDatabase db=open()){db.beginTransaction();try{
      JSONObject old=payload(db,"drafts","analysis");if(old==null)old=new JSONObject();
      SourceAnalysisPacket.require(old.optString("draftRevision").equals(expectedRevision),"其他入口已更新共享草稿；旧页未覆盖，请重读共享草稿");
      JSONObject row=SourceAnalysisPacket.copy(input),content=SourceAnalysisPacket.copy(old);row.remove("draftRevision");content.remove("draftRevision");
      if(SourceAnalysisPacket.canonical(row).equals(SourceAnalysisPacket.canonical(content))&&old.length()>0){db.setTransactionSuccessful();return old;}
      row.put("draftRevision",UUID.randomUUID().toString());size(row);db.execSQL("INSERT INTO drafts VALUES('analysis',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",new Object[]{SourceAnalysisPacket.json(row)});db.setTransactionSuccessful();return row;
    }finally{db.endTransaction();}}
  }
  JSONObject draft() throws Exception {try(SQLiteDatabase db=open()){db.beginTransaction();try{JSONObject row=payload(db,"drafts","analysis");db.setTransactionSuccessful();return row==null?new JSONObject():row;}finally{db.endTransaction();}}}
  JSONArray page(int offset,String kind) throws Exception {
    SourceAnalysisPacket.require(offset>=0,"分页位置无效");JSONArray out=new JSONArray();try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT id FROM handoffs WHERE (?='' OR kind=?) ORDER BY saved_at DESC,id DESC LIMIT 50 OFFSET ?",new String[]{kind,kind,Integer.toString(offset)})){while(c.moveToNext()){JSONObject row=lookup(db,c.getString(0)),summary=new JSONObject();SourceAnalysisPacket.require(row!=null,"列表记录读取期间已改变");for(String k:new String[]{"id","title","kind","savedAt","summary"})summary.put(k,row.optString(k));out.put(summary);}}return out;
  }
  JSONObject detail(String id) throws Exception {try(SQLiteDatabase db=open()){JSONObject row=lookup(db,id);SourceAnalysisPacket.require(row!=null,"交接记录已不存在");return row;}}
  static JSONObject preview(String json,String sourceKey,Map<String,JSONObject> existing) throws Exception {
    SourceAnalysisPacket.require(SourceAnalysisPacket.utf8Size(json)<=SourceAnalysisPacket.BYTE_LIMIT&&!sourceKey.isEmpty(),"导入文件超过25MiB或来源身份为空");
    JSONTokener tokener=new JSONTokener(json);Object data=tokener.nextValue();SourceAnalysisPacket.require(tokener.nextClean()==0,"JSON末尾含额外数据");JSONArray input;boolean nativeBackup=false;
    if(data instanceof JSONArray)input=(JSONArray)data;
    else if(data instanceof JSONObject&&((JSONObject)data).optString("schema").equals("source-handoff-v1")){nativeBackup=true;input=((JSONObject)data).getJSONArray("records");}
    else if(data instanceof JSONObject&&((JSONObject)data).optJSONArray("webstock_ai_handoff_results")!=null)input=((JSONObject)data).getJSONArray("webstock_ai_handoff_results");
    else if(data instanceof JSONObject&&((JSONObject)data).opt("webstock_ai_handoff_results") instanceof String){JSONTokener nested=new JSONTokener(((JSONObject)data).getString("webstock_ai_handoff_results"));Object array=nested.nextValue();SourceAnalysisPacket.require(array instanceof JSONArray&&nested.nextClean()==0,"旧localStorage字段不是交接数组");input=(JSONArray)array;}
    else throw new IllegalArgumentException("只接受旧交接数组或source-handoff-v1备份");
    SourceAnalysisPacket.require(input.length()<=10000,"导入记录超过10000条");JSONArray rows=new JSONArray(),errors=new JSONArray();Set<String> ids=new HashSet<>();int added=0,duplicate=0,conflict=0;
    for(int i=0;i<input.length();i++){try {
      JSONObject row=SourceAnalysisPacket.copy(input.getJSONObject(i));
      if(!nativeBackup){String identity=row.opt("id") instanceof String?row.getString("id"):Integer.toString(i);row.put("id","legacy:"+SourceAnalysisPacket.hash(sourceKey+'\0'+identity));
        for(String k:new String[]{"title","summary","prompt","kind","savedAt"})if(!row.has(k))row.put(k,"");if(row.optString("kind").isEmpty())row.put("kind","general");
        row.put("sourceReferences",new JSONArray()).put("provenance","legacy-manual-unverified").put("importSourceHash",SourceAnalysisPacket.hash(sourceKey)).put("importIndex",i);
      }
      validate(row);String id=row.getString("id");SourceAnalysisPacket.require(ids.add(id),"文件内身份重复");JSONObject old=existing.get(id);String state;
      if(old==null){state="new";added++;}else if(SourceAnalysisPacket.canonical(old).equals(SourceAnalysisPacket.canonical(row))){state="duplicate";duplicate++;}else{state="conflict";conflict++;}
      rows.put(new JSONObject().put("record",row).put("state",state));
    }catch(Exception e){errors.put(new JSONObject().put("index",i).put("reason",e.getMessage()));}}
    return new JSONObject().put("schema","source-handoff-preview-v1").put("rows",rows).put("errors",errors).put("newCount",added).put("duplicateCount",duplicate).put("conflictCount",conflict);
  }
  JSONObject previewImport(String json,String sourceKey) throws Exception {
    JSONObject incoming=preview(json,sourceKey,Collections.emptyMap());
    Map<String,JSONObject> existing=new HashMap<>();try(SQLiteDatabase db=open()){JSONArray rows=incoming.getJSONArray("rows");for(int i=0;i<rows.length();i++){String id=rows.getJSONObject(i).getJSONObject("record").getString("id");JSONObject row=lookup(db,id);if(row!=null)existing.put(id,row);}}return preview(json,sourceKey,existing);
  }
  JSONObject merge(JSONObject preview) throws Exception {
    SourceAnalysisPacket.require(preview.optString("schema").equals("source-handoff-preview-v1")&&preview.getJSONArray("errors").length()==0,"预览有错误，未合并");int added=0,duplicate=0,conflict=0;
    try(SQLiteDatabase db=open()){db.beginTransaction();try{JSONArray rows=preview.getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject row=validate(rows.getJSONObject(i).getJSONObject("record")),old=lookup(db,row.getString("id"));if(old!=null){if(SourceAnalysisPacket.canonical(old).equals(SourceAnalysisPacket.canonical(row)))duplicate++;else conflict++;continue;}insert(db,row);added++;}db.setTransactionSuccessful();}finally{db.endTransaction();}}
    return new JSONObject().put("added",added).put("duplicate",duplicate).put("conflict",conflict).put("policy","keep-existing");
  }
  byte[] backup() throws Exception {
    JSONArray records=new JSONArray();long total=0;try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT id,length(CAST(payload AS BLOB)) FROM handoffs ORDER BY saved_at,id",null)){while(c.moveToNext()){total+=c.getLong(1);SourceAnalysisPacket.require(total<=SourceAnalysisPacket.BYTE_LIMIT,"备份超过25MiB；未截断全文");JSONObject row=lookup(db,c.getString(0));SourceAnalysisPacket.require(row!=null,"备份记录读取期间已改变");records.put(row);}}
    return SourceAnalysisPacket.json(new JSONObject().put("schema","source-handoff-v1").put("records",records).put("mergePolicy","keep-existing")).getBytes(StandardCharsets.UTF_8);
  }
}
