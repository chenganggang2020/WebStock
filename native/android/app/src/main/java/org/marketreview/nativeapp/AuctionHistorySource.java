package org.marketreview.nativeapp;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.json.*;
/** Explicit native-cache reader only. No MarketStore calls, fallback files or writes. */
final class AuctionHistorySource {
 static void require(boolean b,String why){if(!b)throw new IllegalArgumentException(why);}
 static byte[] canonical(Object value)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();canonical(value,out);return out.toByteArray();}
 static void write(ByteArrayOutputStream out,String s)throws Exception{out.write(s.getBytes(StandardCharsets.UTF_8));}
 static void canonical(Object v,ByteArrayOutputStream out)throws Exception{
  if(v==null||v==JSONObject.NULL){write(out,"n");return;}if(v instanceof Boolean){write(out,Boolean.TRUE.equals(v)?"t":"f");return;}
  if(v instanceof String){byte[] b=((String)v).getBytes(StandardCharsets.UTF_8);write(out,"s"+b.length+":");out.write(b);return;}
  if(v instanceof Number){double n=((Number)v).doubleValue();if(n==0)n=0;write(out,"d"+String.format(Locale.ROOT,"%016x",Double.doubleToLongBits(n)));return;}
  if(v instanceof JSONArray){JSONArray a=(JSONArray)v;write(out,"a"+a.length()+"[");for(int i=0;i<a.length();i++)canonical(a.get(i),out);write(out,"]");return;}
  JSONObject o=(JSONObject)v;List<String> keys=new ArrayList<>();Iterator<String> it=o.keys();while(it.hasNext())keys.add(it.next());Collections.sort(keys);write(out,"o"+keys.size()+"{");for(String k:keys){canonical(k,out);canonical(o.get(k),out);}write(out,"}");
 }
 static String digest(String id,JSONObject raw)throws Exception{MessageDigest hash=MessageDigest.getInstance("SHA-256");hash.update((id+"\n").getBytes(StandardCharsets.UTF_8));hash.update(canonical(raw));StringBuilder result=new StringBuilder();for(byte b:hash.digest())result.append(String.format(Locale.ROOT,"%02x",b&255));return result.toString();}
 static final class Roster{final Map<String,JSONObject> ids=new TreeMap<>();final Set<String> keys=new TreeSet<>();}
 static Roster roster(JSONArray items)throws Exception{Roster r=new Roster();for(int i=0;i<items.length();i++){JSONObject s=items.getJSONObject(i);String id=s.getString("id"),symbol=s.getString("symbol");require(id.matches("(SH|SZ|BJ):(stock|etf):[0-9]{6}")&&symbol.equals(id.split(":")[0].toLowerCase(Locale.ROOT)+id.split(":")[2]),"当前清单完整身份与显式symbol不一致");require(!r.ids.containsKey(id),"当前清单重复完整身份");r.ids.put(id,s);r.keys.add(symbol+"-auctionOpening");r.keys.add(symbol+"-auctionClosing");}return r;}
 static final class Candidate{final String key,series,kind;final JSONObject metadata;Candidate(String key,String series,String kind,JSONObject metadata){this.key=key;this.series=series;this.kind=kind;this.metadata=metadata;}}
 static boolean same(Object a,Object b){return Objects.equals(a,b);}
 static JSONObject snapshot(Candidate c,Roster roster)throws Exception{
  require(roster.keys.contains(c.key),"非当前清单精确竞价过程键");JSONObject m=c.metadata,raw=m.optJSONObject("rawInput");require(raw!=null,"缺少原始核验竞价输入；普通报价不进入过程历史");JSONObject meta=raw.getJSONObject("meta");String id=meta.getString("instrumentId");require(roster.ids.containsKey(id),"原始输入完整证券身份不在当前清单");JSONObject instrument=roster.ids.get(id);String phase=c.key.endsWith("-auctionOpening")?"opening":"closing";
  require(c.key.equals(instrument.getString("symbol")+"-"+(phase.equals("opening")?"auctionOpening":"auctionClosing")),"竞价cacheKey跨证券");require(phase.equals(raw.opt("phase"))&&phase.equals(m.opt("phase"))&&"milliseconds".equals(m.opt("timeUnit"))&&"none".equals(m.opt("adjustment"))&&Boolean.TRUE.equals(m.opt("intraday")),"竞价存档阶段/序列契约不一致");
  require(Boolean.TRUE.equals(meta.opt("auctionFieldContractVerified"))&&"source-event".equals(meta.opt("auctionTimestampMeaning"))&&"shares".equals(meta.opt("volumeUnit"))&&"CNY".equals(meta.opt("priceUnit"))&&id.split(":")[2].equals(meta.opt("code"))&&meta.opt("sourceId") instanceof String&&!meta.getString("sourceId").isEmpty(),"原始竞价字段/单位/来源未核验");
  require(same(m.opt("source"),meta.opt("sourceId"))&&same(m.opt("dataDate"),raw.opt("date"))&&same(m.opt("asOf"),raw.opt("asOf")),"存档来源/日期/观察时点与原输入冲突");if(m.has("instrumentId"))require(id.equals(m.opt("instrumentId")),"存档完整身份冲突");if(m.has("cacheKey"))require(c.key.equals(m.opt("cacheKey")),"存档缓存键冲突");if(c.kind.equals("archive"))require(!c.series.isEmpty()&&c.series.equals(m.opt("seriesKey"))&&c.key.equals(m.opt("cacheKey")),"归档seriesKey/cacheKey与真实行不一致");
  String asOf=raw.getString("asOf");require(asOf.matches(".*(Z|[+-][0-9]{2}:[0-9]{2})$"),"原观察时点时区不明确");Instant at=Instant.parse(asOf),checked=Instant.parse(m.getString("checkedAt"));require(!checked.isBefore(at),"原生解析检查时间无效");
  JSONArray rows=raw.getJSONArray("rows");for(int i=0;i<rows.length();i++){JSONObject p=rows.getJSONObject(i);for(String f:Arrays.asList("auctionReferencePrice","auctionMatchedVolume","auctionUnmatchedBuyVolume","auctionUnmatchedSellVolume"))require(p.opt(f) instanceof Number&&Double.isFinite(((Number)p.get(f)).doubleValue()),"原始竞价数值类型无效");if(p.has("instrumentId"))require(id.equals(p.opt("instrumentId")),"竞价点完整身份冲突");if(p.has("code"))require(same(p.opt("code"),meta.opt("code")),"竞价点代码冲突");if(p.has("sourceId"))require(same(p.opt("sourceId"),meta.opt("sourceId")),"竞价点来源冲突");}
  MarketData.auction(raw,id,at);String hash=digest(id,raw),series=c.series.isEmpty()?m.optString("seriesKey",""):c.series;String locator=series.isEmpty()?c.kind+":"+c.key:"series:"+series;
  return new JSONObject().put("id",locator+":"+hash).put("instrumentId",id).put("name",instrument.opt("name")==null?JSONObject.NULL:instrument.opt("name")).put("input",new JSONObject(raw.toString())).put("coverage",new JSONObject(m.toString())).put("contentSha256",hash).put("origins",new JSONArray().put(new JSONObject().put("kind",c.kind).put("cacheKey",c.key).put("seriesKey",series)));
 }
 static boolean schema(SQLiteDatabase db)throws Exception{
  try(Cursor c=db.rawQuery("PRAGMA application_id",null)){require(c.moveToFirst()&&c.getInt(0)==0,"外来数据库application_id");}require(db.getVersion()<=1,"非已知原生库版本");Set<String> tables=new HashSet<>();try(Cursor c=db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",null)){while(c.moveToNext())tables.add(c.getString(0));}for(String table:tables)require(Arrays.asList("snapshots","bars","series","android_metadata").contains(table),"外来数据库表结构");if(!tables.containsAll(Arrays.asList("snapshots","bars","series")))return false;
  Map<String,List<String>> expected=new LinkedHashMap<>();expected.put("snapshots",Arrays.asList("cache_key:TEXT:1","data:TEXT:0"));expected.put("bars",Arrays.asList("series_key:TEXT:1","time:INTEGER:2","data:TEXT:0"));expected.put("series",Arrays.asList("series_key:TEXT:1","metadata:TEXT:0"));for(Map.Entry<String,List<String>> e:expected.entrySet()){List<String> fields=new ArrayList<>();try(Cursor c=db.rawQuery("PRAGMA table_info("+e.getKey()+")",null)){while(c.moveToNext())fields.add(c.getString(1)+":"+c.getString(2).toUpperCase(Locale.ROOT)+":"+c.getInt(5));}require(fields.equals(e.getValue()),"外来或未知原生字段结构");}return true;
 }
 static JSONObject read(SQLiteDatabase db,String table,String column,String keyColumn,String key,long length)throws Exception{
  require(length>0&&length<=64*1024*1024,"元数据正文长度无效/超过64MiB，明确排除");ByteArrayOutputStream out=new ByteArrayOutputStream();for(long offset=0;offset<length;offset+=65536){try(Cursor c=db.rawQuery("SELECT substr(CAST("+column+" AS BLOB),?,65536) FROM "+table+" WHERE "+keyColumn+"=?",new String[]{String.valueOf(offset+1),key})){require(c.moveToFirst(),"归档正文缺块");byte[] part=c.getBlob(0);require(part.length==Math.min(65536,length-offset),"归档正文块不完整");out.write(part);}}byte[] bytes=out.toByteArray();String json=new String(bytes,StandardCharsets.UTF_8);require(Arrays.equals(json.getBytes(StandardCharsets.UTF_8),bytes),"元数据UTF-8正文损坏");return new JSONObject(json);
 }
 static int version(SQLiteDatabase db)throws Exception{try(Cursor c=db.rawQuery("PRAGMA data_version",null)){require(c.moveToFirst(),"只读版本无法读取");return c.getInt(0);}}
 static boolean sqliteHeader(File file){try(InputStream in=new FileInputStream(file)){byte[] header=new byte[16];int offset=0,n;while(offset<header.length&&(n=in.read(header,offset,header.length-offset))>0)offset+=n;return offset==16&&Arrays.equals(header,"SQLite format 3\000".getBytes(StandardCharsets.US_ASCII));}catch(IOException error){return false;}}
 static boolean jsonFilter(SQLiteDatabase db){try(Cursor c=db.rawQuery("SELECT json_valid('{\"cacheKey\":\"probe\"}'),json_extract('{\"cacheKey\":\"probe\"}','$.cacheKey')",null)){return c.moveToFirst()&&c.getInt(0)==1&&c.getString(1).equals("probe");}catch(Exception e){return false;}}
 static JSONObject collect(File file,JSONArray currentInstruments)throws Exception{
  JSONArray diagnostics=new JSONArray(),snapshots=new JSONArray();Map<String,Integer> seen=new HashMap<>();int[] duplicates={0};String state="complete",reason="";int archives=0,caches=0;Roster selected;
  try{selected=roster(currentInstruments);}catch(Exception e){return new JSONObject().put("snapshots",snapshots).put("state","invalid-instruments").put("reason",e.getMessage()).put("diagnostics",diagnostics).put("archiveRowsVisited",0).put("cacheRowsVisited",0).put("duplicates",0);}
  List<Candidate> disk=new ArrayList<>();
  if(file==null||!file.exists()){state="missing-database";reason="明确原生缓存路径不存在；归档为空，未创建数据库";}
  else if(!file.getName().equals("market-v1.sqlite")||!file.isFile()){state="foreign-database";reason="路径不是明确原生market-v1.sqlite缓存文件";}
  else if(!sqliteHeader(file)){state="foreign-database";reason="非完整SQLite文件头；原文件保留，未交给自动修复或删除处理";}
  else try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY|SQLiteDatabase.NO_LOCALIZED_COLLATORS,corrupt->{throw new android.database.sqlite.SQLiteDatabaseCorruptException("只读归档发现损坏；拒绝自动删除或修复原文件");})){
   boolean transaction=false;try{
    if(Build.VERSION.SDK_INT>=35){db.beginTransactionReadOnly();transaction=true;}
    int before=version(db);if(!schema(db)){state="missing-native-tables";reason="缺少已知原生snapshots/bars/series表；归档为空，未建表";}else{
     if(!jsonFilter(db)){state="unsupported-json-filter";reason="本机SQLite未通过精确JSON缓存键能力探测；归档正文未读取，无全表正文回退";}
     else{List<String> wanted=new ArrayList<>(selected.keys);for(int begin=0;begin<wanted.size();begin+=128){List<String> batch=wanted.subList(begin,Math.min(begin+128,wanted.size()));List<String> marks=new ArrayList<>();for(String ignored:batch)marks.add("?");String last="";for(;;){List<String> keys=new ArrayList<>();List<Long> lengths=new ArrayList<>();List<String> args=new ArrayList<>();args.add(last);args.addAll(batch);try(Cursor c=db.rawQuery("SELECT series_key,length(CAST(metadata AS BLOB)) FROM series WHERE series_key>? AND CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.cacheKey') END IN ("+String.join(",",marks)+") ORDER BY series_key LIMIT 128",args.toArray(new String[0]))){while(c.moveToNext()){keys.add(c.getString(0));lengths.add(c.getLong(1));}}if(keys.isEmpty())break;for(int i=0;i<keys.size();i++){last=keys.get(i);archives++;try{JSONObject m=read(db,"series","metadata","series_key",last,lengths.get(i));String key=m.optString("cacheKey","");require(batch.contains(key),"SQL命中归档正文cacheKey二次核验失败");disk.add(new Candidate(key,last,"archive",m));}catch(Exception e){note(diagnostics,"archive",last,e.getMessage());}}}}}
     for(String key:selected.keys){long length;try(Cursor c=db.rawQuery("SELECT length(CAST(data AS BLOB)) FROM snapshots WHERE cache_key=?",new String[]{key})){if(!c.moveToFirst())continue;length=c.getLong(0);}caches++;try{disk.add(new Candidate(key,"","cache",read(db,"snapshots","data","cache_key",key,length)));}catch(Exception e){note(diagnostics,"cache",key,e.getMessage());}}
    }
    if(!transaction&&version(db)!=before){disk.clear();state="cache-changed";reason="读取期间原生缓存已更新；整批磁盘候选弃用，请主动重读";}
   }finally{if(transaction)db.endTransaction();}
  }catch(Exception e){state="foreign-database";reason=e.getMessage();disk.clear();}
  for(Candidate c:disk)add(c,selected,snapshots,seen,duplicates,diagnostics);
  for(JSONObject instrument:selected.ids.values())for(String p:Arrays.asList("auctionOpening","auctionClosing")){Object m=instrument.opt(p+"Meta");if(m==null||m==JSONObject.NULL)continue;if(!(m instanceof JSONObject)){note(diagnostics,"current",instrument.getString("symbol")+"-"+p,"原生过程元数据不是对象");continue;}add(new Candidate(instrument.getString("symbol")+"-"+p,"","current",(JSONObject)m),selected,snapshots,seen,duplicates,diagnostics);}
  if(state.equals("complete")&&diagnostics.length()>0){state="partial";reason="部分元数据不满足核验契约或正文损坏；原因逐条保留";}if(state.equals("complete")&&snapshots.length()==0)reason="当前清单没有核验虚拟竞价rawInput；归档/缓存为空，不生成历史";
  return new JSONObject().put("snapshots",snapshots).put("state",state).put("reason",reason).put("diagnostics",diagnostics).put("archiveRowsVisited",archives).put("cacheRowsVisited",caches).put("duplicates",duplicates[0]);
 }
 static void note(JSONArray diagnostics,String kind,String key,String why)throws Exception{diagnostics.put(new JSONObject().put("kind",kind).put("key",key).put("reason",why==null?"元数据读取/验证失败":why));}
 static void add(Candidate c,Roster r,JSONArray snapshots,Map<String,Integer> seen,int[] duplicates,JSONArray diagnostics)throws Exception{
  try{JSONObject s=snapshot(c,r);String hash=s.getString("contentSha256");if(seen.containsKey(hash)){JSONObject old=snapshots.getJSONObject(seen.get(hash));old.getJSONArray("origins").put(s.getJSONArray("origins").get(0));duplicates[0]++;}else{seen.put(hash,snapshots.length());snapshots.put(s);}}catch(Exception e){note(diagnostics,c.kind,c.series.isEmpty()?c.key:c.series,e.getMessage());}
 }
}
