package org.marketreview.nativeapp;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.*;
import java.math.*;
import java.time.*;
import java.util.*;
import org.json.*;

/**
 * Native-owned business records. No broker orders and no access to the old application's database.
 */
final class BusinessStore extends SQLiteOpenHelper {
  static final int BACKUP_BYTE_LIMIT = 32 * 1024 * 1024;
  static final String[] KINDS = {"accounts", "trades", "docs", "reports", "topics", "relations", "collections"};
  BusinessStore(Context c, String name) {
    super(c, name, null, 1);
  }
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
        "CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(kind,id))");
    db.execSQL(
        "INSERT INTO records VALUES('accounts','local','{\"id\":\"local\",\"name\":\"我的账本\",\"type\":\"ledger\"}')");
    db.execSQL(
        "INSERT INTO records VALUES('accounts','paper','{\"id\":\"paper\",\"name\":\"纸面模拟\",\"type\":\"paper\"}')");
  }
  public void onUpgrade(SQLiteDatabase db, int old, int next) {
    throw new IllegalStateException("业务库需明确迁移，不清空记录");
  }
  static void require(boolean ok, String reason) {
    if (!ok)
      throw new IllegalArgumentException(reason);
  }
  JSONArray read(String kind) throws Exception {
    // SQL substr counts Unicode code points; at most 96KiB UTF-8 per chunk,
    // including supplementary characters, rather than a whole multi-MiB row.
    final int chunkCharacters = 24000;
    SQLiteDatabase db = getReadableDatabase();
    boolean ownTransaction = !db.inTransaction();
    if (ownTransaction) db.beginTransactionNonExclusive();
    JSONArray rows = new JSONArray();
    try {
      try (Cursor c = db.rawQuery(
               "SELECT id,length(payload),CASE WHEN length(payload)<=24000 THEN payload ELSE NULL END FROM records WHERE kind=? ORDER BY rowid",
               new String[] {kind})) {
        while (c.moveToNext()) {
          if (!c.isNull(2)) {
            rows.put(new JSONObject(c.getString(2)));
            continue;
          }
          String id = c.getString(0);
          long characters = c.getLong(1);
          require(characters > 0 && characters <= BACKUP_BYTE_LIMIT,
                  "记录原文过大或损坏，未截断");
          StringBuilder payload = new StringBuilder();
          for (long start = 1; start <= characters; start += chunkCharacters) {
            try (Cursor part = db.rawQuery(
                     "SELECT substr(payload,?,?) FROM records WHERE kind=? AND id=?",
                     new String[] {Long.toString(start), Integer.toString(chunkCharacters), kind, id})) {
              require(part.moveToFirst() && !part.isNull(0), "原记录在读取期间不可得");
              String chunk = part.getString(0);
              require(!chunk.isEmpty(), "记录分块读取不完整，未返回截断内容");
              payload.append(chunk);
            }
          }
          require(payload.codePointCount(0, payload.length()) == characters,
                  "记录分块长度不完整，未返回截断内容");
          rows.put(new JSONObject(payload.toString()));
        }
      }
      if (ownTransaction) db.setTransactionSuccessful();
      return rows;
    } finally {
      if (ownTransaction) db.endTransaction();
    }
  }
  // OPEN_READONLY plus one transaction; no SQLiteOpenHelper creation or migration path.
  static JSONObject readLedgerSnapshot(java.io.File file,java.util.function.BooleanSupplier cancelled)throws Exception {
    if(android.os.Build.VERSION.SDK_INT<35)throw new UnsupportedOperationException("当前Android不支持正式只读事务；账本背景不可用，未降级为写事务");
    SectorLeaderModel.active(cancelled);require(file.isFile(),"本机账本来源不存在，未创建");
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,
        corrupt->{throw new SQLiteDatabaseCorruptException("只读账本损坏；拒绝自动删除或修复");})){
      require(db.isReadOnly(),"账本连接必须只读");
      db.beginTransactionReadOnly();
      try {JSONObject out=new JSONObject();long total=0;
        for(String kind:new String[]{"accounts","trades"}){SectorLeaderModel.active(cancelled);JSONArray rows=new JSONArray();
          try(Cursor c=db.rawQuery("SELECT id,length(CAST(payload AS BLOB)) FROM records WHERE kind=? ORDER BY rowid",new String[]{kind})){
            while(c.moveToNext()){SectorLeaderModel.active(cancelled);String id=c.getString(0);long length=c.getLong(1);total+=length;require(length>0&&total<=8388608,"账本背景原文超过8MiB，未截断");java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
              for(long offset=0;offset<length;offset+=65536){SectorLeaderModel.active(cancelled);try(Cursor part=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,65536) FROM records WHERE kind=? AND id=?",new String[]{Long.toString(offset+1),kind,id})){require(part.moveToFirst(),"账本原文缺块");byte[] block=part.getBlob(0);require(block.length==Math.min(65536,length-offset),"账本原文不完整");bytes.write(block);}}
              byte[] raw=bytes.toByteArray();String text=new String(raw,java.nio.charset.StandardCharsets.UTF_8);require(Arrays.equals(raw,text.getBytes(java.nio.charset.StandardCharsets.UTF_8)),"账本UTF8损坏");JSONObject row=new JSONObject(text);require(id.equals(row.optString("id")),"账本记录身份损坏");rows.put(row);
            }
          }out.put(kind,rows);SectorLeaderModel.active(cancelled);
        }SectorLeaderModel.active(cancelled);db.setTransactionSuccessful();return out;
      }finally{db.endTransaction();}
    }
  }
  static JSONObject readCandidateThemeSnapshot(java.io.File file,java.util.function.BooleanSupplier cancelled)throws Exception {
    if(android.os.Build.VERSION.SDK_INT<35)throw new UnsupportedOperationException("当前Android不支持正式只读事务；候选主题资料背景不可用，未降级为写事务");
    SectorLeaderModel.active(cancelled);require(file.isFile(),"本机候选主题资料来源不存在，未创建");
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,
        corrupt->{throw new SQLiteDatabaseCorruptException("只读候选主题资料损坏；拒绝自动删除或修复");})){
      require(db.isReadOnly(),"候选主题资料连接必须只读");
      db.beginTransactionReadOnly();
      try {JSONObject out=new JSONObject();long total=0;
        for(String kind:new String[]{"topics","relations","docs"}){SectorLeaderModel.active(cancelled);JSONArray rows=new JSONArray();
          try(Cursor c=db.rawQuery("SELECT id,length(CAST(payload AS BLOB)) FROM records WHERE kind=? ORDER BY rowid",new String[]{kind})){
            while(c.moveToNext()){SectorLeaderModel.active(cancelled);String id=c.getString(0);long length=c.getLong(1);total+=length;require(length>0&&total<=8388608,"候选主题资料背景原文超过8MiB，未截断");java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
              for(long offset=0;offset<length;offset+=65536){SectorLeaderModel.active(cancelled);try(Cursor part=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,65536) FROM records WHERE kind=? AND id=?",new String[]{Long.toString(offset+1),kind,id})){require(part.moveToFirst(),"候选主题资料原文缺块");byte[] block=part.getBlob(0);require(block.length==Math.min(65536,length-offset),"候选主题资料原文不完整");bytes.write(block);}}
              byte[] raw=bytes.toByteArray();String text=new String(raw,java.nio.charset.StandardCharsets.UTF_8);require(Arrays.equals(raw,text.getBytes(java.nio.charset.StandardCharsets.UTF_8)),"候选主题资料UTF8损坏");JSONObject row=new JSONObject(text);require(id.equals(row.optString("id")),"候选主题资料记录身份损坏");rows.put(row);
            }
          }out.put(kind,rows);SectorLeaderModel.active(cancelled);
        }SectorLeaderModel.active(cancelled);db.setTransactionSuccessful();return out;
      }finally{db.endTransaction();}
    }
  }
  static JSONObject validate(String kind, JSONObject input) throws Exception {
    require(Arrays.asList(KINDS).contains(kind), "未知业务类型");
    JSONObject item = new JSONObject(input.toString());
    if (item.optString("id").isEmpty())
      item.put("id", UUID.randomUUID().toString());
    require(item.getString("id").length() <= 100, "记录ID过长");
    if (kind.equals("accounts")) {
      require(!item.optString("name").trim().isEmpty(), "账户名称不能为空");
      require(Arrays.asList("ledger", "paper").contains(item.optString("type")), "账户类型无效");
    }
    if (kind.equals("docs") || kind.equals("reports")) {
      require(!item.optString("title").trim().isEmpty(), "资料标题不能为空");
      require(item.optString("text").length() <= 600000, "单篇资料超过60万字");
      String url = item.optString("sourceUrl");
      require(url.isEmpty() || url.matches("https?://[^\\s]+"), "来源链接必须是HTTP或HTTPS");
      require(Arrays.asList("unverified", "manuallyVerified")
                  .contains(item.optString("verification", "unverified")),
          "核验状态无效");
    }
    if (kind.equals("topics")) require(!item.optString("name").trim().isEmpty() && item.optString("name").length()<=120,"主题名需为1至120字");
    if (kind.equals("relations")) {
      ResearchCompanies.validateMetadata(item);
      require(!item.optString("claim").trim().isEmpty() && item.optString("claim").length()<=1000,"关系说明需为1至1000字");
      require(!item.optString("quote").trim().isEmpty() && item.optString("quote").length()<=2000,"请填写1至2000字原文引用");
      require(Arrays.asList("materials","equipment","components","manufacturing","applications").contains(item.optString("stage")),"产业阶段无效");
      require(Arrays.asList("supports","contradicts").contains(item.optString("polarity")),"证据方向无效");
      require(Arrays.asList("unverified","manuallyVerified").contains(item.optString("verification","unverified")),"仅支持待核验或人工核验");
    }
    if (kind.equals("collections")) {
      CreatorAnalysis.validateHistory(item);
      if(item.has("qualityReviews")) {
        JSONArray reviews=item.optJSONArray("qualityReviews");require(reviews!=null&&reviews.length()<=1000,"文稿复核历史格式无效");
        for(int i=0;i<reviews.length();i++)require(CollectionQuality.validReview(reviews.optJSONObject(i)),"文稿复核记录缺少正文身份、说明或时间");
      }
      require(!item.optString("title").trim().isEmpty(),"采集任务需有标题");
      require(item.optString("text").length()<=600000 && item.optString("originalText").length()<=600000,"文稿超过60万字");
      require(Arrays.asList("imported","queued","running","completed","failed","cancelled","interrupted").contains(item.optString("status")),"任务状态无效");
    }
    return item.put("updatedAt", Instant.now().toString());
  }
  void write(SQLiteDatabase db, String kind, JSONObject item) throws Exception {
    ContentValues v = new ContentValues();
    v.put("kind", kind);
    v.put("id", item.getString("id"));
    v.put("payload", item.toString());
    if (db.update("records", v, "kind=? AND id=?", new String[] {kind, item.getString("id")}) == 0)
      db.insertOrThrow("records", null, v);
  }
  void validateLedgers() throws Exception {
    JSONArray accounts = read("accounts"), trades = read("trades");
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < accounts.length(); i++) {
      String id = accounts.getJSONObject(i).getString("id");
      ids.add(id);
      portfolio(trades, new JSONObject(), id);
    }
    for (int i = 0; i < trades.length(); i++)
      require(ids.contains(trades.getJSONObject(i).optString("accountId")), "交易引用账户不存在");
    Set<String> topics=new HashSet<>(); Map<String,String> docs=new HashMap<>();
    JSONArray ts=read("topics"),ds=read("docs"),rs=read("relations");
    for(int i=0;i<ts.length();i++) topics.add(ts.getJSONObject(i).getString("id"));
    for(int i=0;i<ds.length();i++) docs.put(ds.getJSONObject(i).getString("id"),ds.getJSONObject(i).optString("text"));
    for(int i=0;i<rs.length();i++) {JSONObject r=rs.getJSONObject(i);String id=r.optString("documentId");
      require(topics.contains(r.optString("topicId")),"关系引用的主题不存在");
      require(docs.containsKey(id) && docs.get(id).contains(r.optString("quote")),"引用必须匹配已有资料原文；请先处理引用关系");
      ResearchCompanies.validateReferences(r,docs);
    }
  }
  JSONObject editAccount(JSONObject expected,JSONObject candidateInput)throws Exception {
    JSONObject candidate=new JSONObject(candidateInput.toString());
    SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {
      JSONObject current=null;JSONArray accounts=read("accounts");for(int i=0;i<accounts.length();i++)if(accounts.getJSONObject(i).opt("id").equals(expected.opt("id")))current=accounts.getJSONObject(i);
      require(current!=null,"账户不存在，未新建");AccountEditModel.check(expected,current);
      JSONObject beforeProtected=new JSONObject(expected.toString()),afterProtected=new JSONObject(candidate.toString());
      for(String key:new String[]{"name","broker","maskedNumber","note","cashBalance"}){beforeProtected.remove(key);afterProtected.remove(key);}
      require(AccountEditModel.equal(beforeProtected,afterProtected),"账户身份或受保护历史被修改，未保存");
      for(String key:new String[]{"name","broker","maskedNumber","note"})if(!AccountEditModel.equal(candidate.opt(key),expected.opt(key)))require(candidate.opt(key) instanceof String,"账户编辑字段必须是文本");
      boolean cashChanged=!AccountEditModel.equal(candidate.opt("cashBalance"),expected.opt("cashBalance"));
      if(cashChanged){
        require(candidate.opt("cashBalance") instanceof Number&&Double.isFinite(candidate.getDouble("cashBalance"))&&candidate.getDouble("cashBalance")>=0,"手工现金必须为有限非负数");
        require(!current.has("cashEditHistory")||current.opt("cashEditHistory") instanceof JSONArray,"现金修改依据格式损坏，未覆盖");
        JSONArray history=current.has("cashEditHistory")?new JSONArray(current.getJSONArray("cashEditHistory").toString()):new JSONArray();require(history.length()<1000,"现金修改依据已满，请先归档");
        JSONObject prior=new JSONObject();for(String key:new String[]{"cashBalance","cashAsOf","cashSource","cashVerification"})if(current.has(key))prior.put(key,current.get(key));
        String savedAt=Instant.now().toString();history.put(new JSONObject().put("previous",prior).put("cashBalance",candidate.get("cashBalance")).put("recordedAt",savedAt).put("scope","manual-balance-not-cashflow"));
        candidate.put("cashEditHistory",history);candidate.remove("cashAsOf");candidate.put("cashSource","manual").put("cashVerification","unverified").put("cashEditedAt",savedAt);
      }
      if(AccountEditModel.equal(candidate,current))return current;
      candidate=validate("accounts",candidate);write(db,"accounts",candidate);validateLedgers();db.setTransactionSuccessful();return candidate;
    }finally{db.endTransaction();}
  }
  JSONObject commitCollectionPublication(JSONObject expected, JSONObject document) throws Exception {
    require(!expected.optString("id").isEmpty()
        && document.optString("collectionId").equals(expected.optString("id"))
        && document.optString("text").equals(expected.optString("text"))
        && document.optString("originalText").equals(expected.optString("originalText")),
        "研究资料与待入库文稿不一致，未写入");
    document = validate("docs", document);
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      JSONObject current = null;
      JSONArray rows = read("collections");
      for (int i = 0; i < rows.length(); i++)
        if (rows.getJSONObject(i).optString("id").equals(expected.optString("id")))
          current = rows.getJSONObject(i);
      require(current != null && ResearchRuns.canonical(current).equals(ResearchRuns.canonical(expected)),
          "文稿已变化或删除，请重新核对后入库；未发布旧版本");
      // The source check and insert share one transaction; this path never updates docs.
      ContentValues values = new ContentValues();
      values.put("kind", "docs");values.put("id", document.getString("id"));values.put("payload", document.toString());
      try { db.insertOrThrow("records", null, values); }
      catch (android.database.SQLException e) { throw new IllegalStateException("研究资料已存在或写入失败；原稿未覆盖", e); }
      validateLedgers();
      db.setTransactionSuccessful();
      return document;
    } finally { db.endTransaction(); }
  }
  JSONObject save(String kind, JSONObject item) throws Exception {
    item = validate(kind, item);
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      if(kind.equals("collections")){JSONArray rows=read(kind);for(int i=0;i<rows.length();i++){JSONObject old=rows.getJSONObject(i);if(old.optString("id").equals(item.optString("id"))&&old.has("qualityReviews"))item.put("qualityReviews",old.get("qualityReviews"));}}
      if(kind.equals("collections")){JSONArray rows=read(kind);for(int i=0;i<rows.length();i++){JSONObject old=rows.getJSONObject(i);if(old.optString("id").equals(item.optString("id"))&&old.has("creatorAnalyses"))item.put("creatorAnalyses",old.get("creatorAnalyses"));}}
      write(db, kind, item);
      validateLedgers();
      db.setTransactionSuccessful();
      return item;
    } finally {
      db.endTransaction();
    }
  }
  JSONObject reviewCollection(String id,String expectedHash,String note) throws Exception {
    require(!CollectionQuality.trim(note).isEmpty()&&note.length()<=2000,"请填写1至2000字复核说明");
    SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {
      JSONObject row=null;JSONArray all=read("collections");for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optString("id").equals(id))row=all.getJSONObject(i);
      require(row!=null&&!CollectionQuality.trim(row.optString("text")).isEmpty(),"请选择有正文的文稿");
      require(CollectionQuality.bodyHash(row.optString("text")).equals(expectedHash),"正文已变化，请重新查看后复核");
      JSONArray reviews=CollectionQuality.array(row,"qualityReviews");require(reviews.length()<1000,"复核历史已达1000条，请先导出归档");
      reviews.put(new JSONObject().put("bodyHash",expectedHash).put("note",CollectionQuality.trim(note)).put("reviewedAt",Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString()).put("scope","transcript_only"));
      row=validate("collections",row.put("qualityReviews",reviews));write(db,"collections",row);db.setTransactionSuccessful();return row;
    }finally{db.endTransaction();}
  }
  JSONObject saveCreatorAiAnalysis(JSONObject expectedRow,JSONObject candidate,java.util.function.BooleanSupplier cancelled)throws Exception{return saveCreatorAiChecked(expectedRow,candidate,cancelled,null);}
  JSONObject saveCreatorAiExecution(JSONObject expectedRow,JSONObject candidate,CreatorAiExecution.Receipt receipt,java.util.function.BooleanSupplier cancelled)throws Exception{require(receipt!=null,"执行来源凭证缺失");JSONObject saved=saveCreatorAiChecked(expectedRow,candidate,cancelled,receipt);receipt.committed();return saved;}
  private JSONObject saveCreatorAiChecked(JSONObject expectedRow,JSONObject candidate,java.util.function.BooleanSupplier cancelledInput,CreatorAiExecution.Receipt receipt)throws Exception {
    java.util.function.BooleanSupplier cancelled=()->cancelledInput==null||cancelledInput.getAsBoolean()||(receipt!=null&&!receipt.valid());
    require(!cancelled.getAsBoolean(),"保存已取消，未写入");
    JSONObject expected=new JSONObject(expectedRow.toString()),held=new JSONObject(candidate.toString());
    require(expected.opt("id") instanceof String&&!expected.getString("id").isEmpty(),"完整来源缺少身份");
    String id=expected.getString("id");SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {
      byte[] raw;
      try(Cursor cursor=db.rawQuery("SELECT length(CAST(payload AS BLOB)),CASE WHEN length(CAST(payload AS BLOB))<=24000 THEN CAST(payload AS BLOB) ELSE NULL END FROM records WHERE kind='collections' AND id=?",new String[]{id})){
        require(cursor.moveToFirst(),"原文稿已删除，未写入");long length=cursor.getLong(0);
        require(length>0&&length<=8*1024*1024,"原文稿记录超过8MiB或损坏，未截断");
        if(!cursor.isNull(1))raw=cursor.getBlob(1);
        else {java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();for(long start=1;start<=length;start+=24000){
          require(!cancelled.getAsBoolean(),"保存已取消，未写入");
          try(Cursor part=db.rawQuery("SELECT substr(CAST(payload AS BLOB),?,24000) FROM records WHERE kind='collections' AND id=?",new String[]{Long.toString(start),id})){
            require(part.moveToFirst()&&!part.isNull(0),"原文稿记录读取不完整");byte[] block=part.getBlob(0);require(block.length>0&&bytes.size()+block.length<=length,"原文稿记录读取不完整");bytes.write(block);
          }
        }raw=bytes.toByteArray();require(raw.length==length,"原文稿记录读取不完整");}
      }
      JSONObject row=CreatorAiModel.parseObject(raw);String original=new String(raw,java.nio.charset.StandardCharsets.UTF_8);
      require(!cancelled.getAsBoolean(),"保存已取消，未写入");
      require(id.equals(row.opt("id"))&&ResearchRuns.canonical(row).equals(ResearchRuns.canonical(expected)),"完整来源记录已变化，未覆盖原件");
      CreatorAnalysis.validateHistory(row);require(CreatorAnalysis.eligible(row),"原文稿质检或原始证据条件不满足");
      require(ResearchRuns.canonical(CreatorAnalysis.identity(row)).equals(ResearchRuns.canonical(CreatorAnalysis.identity(expected)))&&CollectionQuality.bodyHash(row.getString("text")).equals(CollectionQuality.bodyHash(expected.getString("text")))&&CreatorAnalysis.lastId(row).equals(CreatorAnalysis.lastId(expected)),"来源身份、正文或上一分析版本已变化");
      JSONArray history=CollectionQuality.array(row,"creatorAnalyses");require(history.length()<100,"单篇分析历史已满100版，原件保留");
      JSONObject analysis=CreatorAiModel.validateCandidate(row,held);
      if(receipt!=null)analysis.put("creatorAiExecutionAttempts",receipt.validate(row,held));
      else require(Arrays.asList("manual-import","local-fixture").contains(held.optString("provenance")),"没有可信在线执行来源，不能保存为在线结果");
      require(analysis.getString("id").matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"),"新分析身份必须为UUID");
      analysis.put("provenance",held.getString("provenance")).put("creatorAiResponses",held.getJSONArray("responses"));
      CreatorAnalysis.validate(analysis);require(!cancelled.getAsBoolean(),"保存已取消，未写入");
      history.put(analysis);row.put("creatorAnalyses",history);validate("collections",row);
      String payload=row.toString();require(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8).length<=BACKUP_BYTE_LIMIT,"追加后文稿记录过大，原件保留");
      ContentValues values=new ContentValues();values.put("payload",payload);require(db.update("records",values,"kind='collections' AND id=? AND payload=?",new String[]{id,original})==1,"记录竞争或保存失败，未覆盖原件");
      require(!cancelled.getAsBoolean(),"保存已取消，事务已回滚");db.setTransactionSuccessful();return analysis;
    }finally{db.endTransaction();}
  }
  JSONObject saveCreatorAnalysis(String id,String expectedHash,String previous,String summary,JSONArray edges) throws Exception {
    SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {
      JSONObject row=null;JSONArray all=read("collections");for(int i=0;i<all.length();i++)if(all.getJSONObject(i).optString("id").equals(id))row=all.getJSONObject(i);
      require(row!=null&&CollectionQuality.bodyHash(row.optString("text")).equals(expectedHash),"正文已变化，请重新读取后编辑关系");
      require(CreatorAnalysis.lastId(row).equals(previous),"分析版本已变化，请重新读取，未覆盖其他修改");
      require(CreatorAnalysis.eligible(row),"当前文稿质检或原始证据条件不满足；不可作为当前关系保存");
      JSONArray normalized=new JSONArray();for(int i=0;i<edges.length();i++)normalized.put(CreatorAnalysis.relation(edges.getJSONObject(i),row.optString("text")));
      JSONObject a=new JSONObject().put("id",UUID.randomUUID().toString()).put("bodyText",row.getString("text")).put("bodyHash",expectedHash).put("sourceSnapshot",CreatorAnalysis.sourceSnapshot(row)).put("sourceIdentity",CreatorAnalysis.identity(row))
          .put("summary",summary).put("model","人工编辑").put("specVersion",CreatorAnalysis.SPEC).put("analyzedAt",Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString()).put("relations",normalized);
      JSONArray history=CollectionQuality.array(row,"creatorAnalyses");history.put(a);row.put("creatorAnalyses",history);validate("collections",row);write(db,"collections",row);db.setTransactionSuccessful();return a;
    }finally{db.endTransaction();}
  }
  void remove(String kind, String id) throws Exception {
    require(Arrays.asList("trades", "docs", "reports", "topics", "relations").contains(kind), "此记录不能直接删除");
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      db.delete("records", "kind=? AND id=?", new String[] {kind, id});
      validateLedgers();
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
  void mergeResearchReports(JSONArray rows, JSONArray expectedReports) throws Exception {
    SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {
      require(ResearchRuns.canonical(read("reports")).equals(ResearchRuns.canonical(expectedReports)),"报告库已变化，请重新预览，未写入");
      Set<String> seen=new HashSet<>();for(int i=0;i<expectedReports.length();i++)seen.add(expectedReports.getJSONObject(i).getString("id"));
      for(int i=0;i<rows.length();i++){JSONObject r=validate("reports",rows.getJSONObject(i));require("ai_research_runs".equals(r.optString("legacySource"))&&r.optJSONObject("legacyOriginal")!=null&&r.optJSONObject("researchRun")!=null,"不是研究运行记录");require(seen.add(r.getString("id")),"研究ID冲突，未覆盖");JSONObject source=rows.getJSONObject(i);if(source.has("updatedAt")){ResearchRuns.stored(source);r.put("updatedAt",source.get("updatedAt"));}write(db,"reports",r);}
      db.setTransactionSuccessful();
    } finally {db.endTransaction();}
  }
  JSONObject backup() throws Exception {
    JSONObject result = new JSONObject()
                            .put("schema", "native-business-v1")
                            .put("createdAt", Instant.now().toString());
    for (String kind : KINDS) result.put(kind, read(kind));
    return result;
  }
  void restore(JSONObject input) throws Exception {
    require(input.optString("schema").equals("native-business-v1"), "不支持的备份格式");
    SQLiteDatabase db = getWritableDatabase();
    db.beginTransaction();
    try {
      for (String kind : KINDS) {
        if(!input.has(kind) && Arrays.asList("topics","relations","collections").contains(kind)) continue;
        Set<String> existing = new HashSet<>();
        if (input.optString("mergePolicy").equals("keep-existing")) {
          JSONArray previous = read(kind);
          for (int i = 0; i < previous.length(); i++)
            existing.add(previous.getJSONObject(i).getString("id"));
        }
        JSONArray rows = input.getJSONArray(kind);
        require(rows.length() <= 10000, "记录过多");
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < rows.length(); i++) {
          JSONObject item = rows.getJSONObject(i);
          require(!item.optString("id").isEmpty(), "缺少记录身份");
          require(seen.add(item.getString("id")), "同一备份内存在重复记录ID");
          JSONObject valid = validate(kind, item);
          if(kind.equals("collections")) {
            valid.put("executionRevision",UUID.randomUUID().toString());
            valid.put("autoPipeline",false).put("pipelineState","paused")
                .put("pipelineMessage","恢复任务仅作为数据；请主动启动本机处理")
                .put("downloadRun","").put("asrRun","");
            if(valid.optString("asrState").equals("running"))valid.put("asrState","interrupted");
            if(valid.optString("downloadState").equals("running"))valid.put("downloadState","interrupted");
            if(Arrays.asList("queued","running").contains(valid.optString("status")))valid.put("status","interrupted");
          }
          if (!existing.contains(item.getString("id")))
            write(db, kind, valid);
        }
      }
      validateLedgers();
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
  }
  static BigDecimal number(JSONObject o, String key) throws Exception {
    if (!o.has(key))
      return BigDecimal.ZERO;
    Object value = o.get(key);
    require(value instanceof Number, key + "必须为数值");
    BigDecimal n = new BigDecimal(value.toString());
    require(n.signum() >= 0 && n.compareTo(new BigDecimal("1000000000000")) <= 0, key + "超出范围");
    return n;
  }
  static Object rounded(BigDecimal n) {
    return n == null ? JSONObject.NULL : n.setScale(2, RoundingMode.HALF_UP).doubleValue();
  }
  static class Position {
    String name;
    long qty;
    BigDecimal cost = BigDecimal.ZERO, realized = BigDecimal.ZERO, fees = BigDecimal.ZERO;
  }
  static JSONObject portfolio(JSONArray input, JSONObject quotes, String account) throws Exception {
    List<JSONObject> trades = new ArrayList<>();
    for (int i = 0; i < input.length(); i++)
      if (account.equals(input.getJSONObject(i).optString("accountId")))
        trades.add(input.getJSONObject(i));
    trades.sort(Comparator.comparing(t -> t.optString("date")));
    Map<String, Position> holdings = new TreeMap<>();
    for (JSONObject t : trades) {
      String id = t.optString("instrumentId"), side = t.optString("side"),
             date = t.optString("date");
      require(id.matches("(SH|SZ|BJ):(stock|etf):[0-9]{6}"), "账本需明确股票/ETF市场身份");
      require(date.length() == 10, "日期无效");
      LocalDate.parse(date);
      require(Arrays.asList("buy", "sell", "dividend", "fee").contains(side), "交易类型无效");
      BigDecimal qty = number(t, "quantity"), price = number(t, "price"), fee = number(t, "fee"),
                 tax = number(t, "tax");
      long q = qty.longValueExact();
      require(q <= 1000000000L, "股数过大");
      if (side.equals("buy") || side.equals("sell"))
        require(q > 0 && price.signum() > 0, "价格和股数必须大于零");
      Position p = holdings.computeIfAbsent(id, k -> new Position());
      p.name = t.optString("name", id);
      if (side.equals("buy")) {
        p.qty += q;
        p.cost = p.cost.add(qty.multiply(price)).add(fee);
      } else if (side.equals("sell")) {
        require(q <= p.qty, "卖出股数超过该账户已有持仓");
        BigDecimal removed =
            p.cost.multiply(qty).divide(BigDecimal.valueOf(p.qty), 12, RoundingMode.HALF_UP);
        p.realized =
            p.realized.add(qty.multiply(price).subtract(fee).subtract(tax).subtract(removed));
        p.cost = p.cost.subtract(removed);
        p.qty -= q;
        if (p.qty == 0)
          p.cost = BigDecimal.ZERO;
      } else if (side.equals("dividend"))
        p.realized = p.realized.add(t.has("amount") ? number(t, "amount") : qty.multiply(price));
      else
        p.realized = p.realized.subtract(t.has("amount") ? number(t, "amount") : fee);
      p.fees = p.fees.add(
          side.equals("fee") ? (t.has("amount") ? number(t, "amount") : fee) : fee.add(tax));
    }
    BigDecimal cost = BigDecimal.ZERO, realized = BigDecimal.ZERO, fees = BigDecimal.ZERO,
               total = BigDecimal.ZERO;
    boolean missing = false;
    JSONArray positions = new JSONArray();
    for (Map.Entry<String, Position> e : holdings.entrySet()) {
      Position p = e.getValue();
      cost = cost.add(p.cost);
      realized = realized.add(p.realized);
      fees = fees.add(p.fees);
      JSONObject quote = quotes.optJSONObject(e.getKey());
      double price = quote == null ? Double.NaN : quote.optDouble("price");
      boolean valid = Double.isFinite(price) && price > 0;
      BigDecimal value = valid ? BigDecimal.valueOf(price).multiply(BigDecimal.valueOf(p.qty))
          : p.qty == 0         ? BigDecimal.ZERO
                               : null;
      if (value == null)
        missing = true;
      else
        total = total.add(value);
      positions.put(
          new JSONObject()
              .put("instrumentId", e.getKey())
              .put("name", p.name)
              .put("quantity", p.qty)
              .put("cost", rounded(p.cost))
              .put("averageCost",
                  p.qty == 0 ? 0
                             : p.cost.divide(BigDecimal.valueOf(p.qty), 8, RoundingMode.HALF_UP)
                                   .doubleValue())
              .put("realized", rounded(p.realized))
              .put("price", valid ? price : JSONObject.NULL)
              .put("marketValue", rounded(value))
              .put("unrealized", rounded(value == null ? null : value.subtract(p.cost)))
              .put("quoteDate", quote == null ? "" : quote.optString("tradeDate"))
              .put("quoteTime", quote == null ? "" : quote.optString("tradeTime")));
    }
    return new JSONObject()
        .put("positions", positions)
        .put("cost", rounded(cost))
        .put("realized", rounded(realized))
        .put("fees", rounded(fees))
        .put("tradeCount", trades.size())
        .put("marketValue", rounded(missing ? null : total))
        .put("unrealized", rounded(missing ? null : total.subtract(cost)));
  }
}
