package org.marketreview.nativeapp;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.io.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.time.*;
import android.util.JsonReader;
import android.util.JsonToken;
import java.util.*;
import org.json.*;

/** Original provider contracts; stored cents are decimal integers, never floating point. */
final class DarkRotation {
  static final java.util.regex.Pattern INTEGER=java.util.regex.Pattern.compile("-?[0-9]{1,24}"),CENTS=java.util.regex.Pattern.compile("-?[0-9]{1,22}"),CODE=java.util.regex.Pattern.compile("BK[0-9]{4}");
  static void require(boolean ok,String text){if(!ok)throw new IllegalArgumentException(text);}
  static JSONObject obj(Object... pairs) throws JSONException {
    JSONObject o=new JSONObject();for(int i=0;i<pairs.length;i+=2)o.put((String)pairs[i],pairs[i+1]);return o;
  }
  static boolean dateOK(String date){try{return LocalDate.parse(date).toString().equals(date);}catch(Exception e){return false;}}
  static long timestamp(String value){return OffsetDateTime.parse(value).toInstant().toEpochMilli();}
  static BigInteger integer(String value){require(INTEGER.matcher(value).matches(),"金额须为有限长度整数分字符串");return new BigInteger(value);}
  static String add(String a,String b){return integer(a).add(integer(b)).toString();}
  static String money(Object value){if(!(value instanceof String))return "—";return new BigDecimal(integer((String)value)).movePointLeft(6).setScale(2,RoundingMode.DOWN).toPlainString();}
  static Object cents(Object value){
    if(value==null||value==JSONObject.NULL)return JSONObject.NULL;
    require(value instanceof Number,"来源金额不是数值");double n=((Number)value).doubleValue();
    require(Double.isFinite(n)&&Math.floor(n)==n&&Math.abs(n)<=9007199254740991d,"来源金额不是精确整数元");return BigInteger.valueOf(((Number)value).longValue()).multiply(BigInteger.valueOf(100)).toString();
  }
  static Object numeric(Object v){if(v==null||v==JSONObject.NULL)return JSONObject.NULL;require(v instanceof Number&&Double.isFinite(((Number)v).doubleValue()),"来源数值无效");return v;}
  static String sourceKey(JSONObject s) throws JSONException {JSONObject x=s.getJSONObject("source");return x.optString("id")+":"+x.optString("fieldMapping");}
  static JSONObject source() throws JSONException {return obj("id","eastmoney-darktrade-rank","provider","Eastmoney","url","https://emrnweb.eastmoney.com/graymarket/","endpoint","https://quotederivates.eastmoney.com/datacenter/darktrade","classification","provider-model-estimate","documentedPublicApi",false,"licenseVerified",false,"methodologyVersion",JSONObject.NULL,"fieldMapping","GrayMarketRank web build main.79b98a58; observed 2026-09-17");}
  static String url(String date,String scope,int page){
    require(dateOK(date)&&(scope.equals("industry")||scope.equals("concept"))&&page>=1&&page<=10,"日期、范围或分页无效");
    return "https://quotederivates.eastmoney.com/datacenter/darktrade?version=101&cver=100&date="+date.replace("-","")+"&StartPage="+page+"&NumPerPage=100&sortflag=6&desc=1&market=90&datetype="+(scope.equals("industry")?"2":"3");
  }
  static JSONObject normalize(JSONObject raw,String date,String scope,int page,String at) throws JSONException {
    url(date,scope,page);timestamp(at);require(raw.opt("errid") instanceof Number&&((Number)raw.opt("errid")).doubleValue()==0&&raw.optString("1").equals(date.replace("-","")),"来源拒绝请求或日期不匹配");
    JSONArray input=raw.getJSONArray("data");require(input.length()<=100,"来源行数超限");
    Object totalValue=raw.opt("2");require(totalValue instanceof Number,"来源总数非整数");double t=((Number)totalValue).doubleValue();
    require(Double.isFinite(t)&&Math.floor(t)==t&&t>=input.length()&&t<=1000,"板块总数无效或超过1000");int total=(int)t;
    JSONArray rows=new JSONArray();Set<String> codes=new HashSet<>();int missing=0,failed=0;
    for(int i=0;i<input.length();i++){
      JSONObject r=input.getJSONObject(i);String code=r.optString("4"),name=r.optString("16");
      require(r.opt("4") instanceof String&&CODE.matcher(code).matches()&&r.opt("3") instanceof Number&&r.optDouble("3")==90&&r.opt("16") instanceof String&&!name.trim().isEmpty()&&name.length()<=120&&codes.add(code),"来源板块身份无效或重复");
      Object dark=cents(r.opt("6")),visible=cents(r.opt("7")),combined=cents(r.opt("8")),ok=JSONObject.NULL;
      if(dark instanceof String&&visible instanceof String&&combined instanceof String)ok=add((String)dark,(String)visible).equals(combined);
      if(ok==JSONObject.NULL)missing++;else if(!((Boolean)ok))failed++;
      rows.put(obj("code",code,"name",name,"providerMarket",90,"venue",JSONObject.NULL,"price",JSONObject.NULL,"darkNetCents",dark,"visibleNetCents",visible,"combinedNetCents",combined,"reconciled",ok,"changeRatio",numeric(r.opt("14")),"darkActivityRatio",numeric(r.opt("11")),"darkInflowStockRatio",numeric(r.opt("12")),"sourceTimeRaw",r.has("5")?r.get("5"):JSONObject.NULL,"sourceObservedAt",JSONObject.NULL,"leaderName",r.optString("15"),"leaderCode",r.optString("20"),"receivedAt",at));
    }
    return obj("version","webstock.eastmoney-dark-rank/v1","automaticTrading",false,"source",source(),"requestedDate",date,"tradingDay",date,"scope",scope,"receivedAt",at,"rows",rows,
      "coverage",obj("page",page,"pageSize",100,"receivedRows",rows.length(),"totalReported",total,"complete",page==1&&rows.length()==total,"paginationSnapshotConsistent",false),
      "quality",obj("missingCoreRows",missing,"reconciliationFailures",failed,"freshness","unknown-source-clock"));
  }
  static boolean is(JSONObject o,String key,Object expected){return expected.equals(o.opt(key));}
  static void validate(JSONObject s) throws JSONException {
    String schema=s.optString("schema"),scope=s.optString("scope"),date=s.optString("date");
    require((schema.equals("webstock.rotation-snapshot/v1")||schema.equals("webstock.rotation-daily/v1"))&&(scope.equals("industry")||scope.equals("concept"))&&dateOK(date),"轮动档案身份无效");
    JSONObject src=s.getJSONObject("source");require(is(src,"id","eastmoney-darktrade-rank")&&is(src,"provider","Eastmoney")&&is(src,"classification","provider-model-estimate")&&!src.optString("fieldMapping").isEmpty()&&is(s,"sourceKey",sourceKey(s)),"轮动来源契约不匹配");
    long at=timestamp(s.getString("receivedAt"));JSONArray rows=s.getJSONArray("rows");JSONObject cov=s.getJSONObject("coverage");
    require(rows.length()>0&&rows.length()<=1000&&is(cov,"complete",true)&&cov.opt("totalReported") instanceof Number&&cov.optDouble("totalReported")==rows.length()&&cov.opt("receivedRows") instanceof Number&&cov.optDouble("receivedRows")==rows.length()&&is(cov,"paginationSnapshotConsistent",false),"轮动覆盖不完整");
    Set<String> codes=new HashSet<>();
    for(int i=0;i<rows.length();i++){
      JSONObject r=rows.getJSONObject(i);String code=r.optString("code"),name=r.optString("name");
      require(r.opt("code") instanceof String&&CODE.matcher(code).matches()&&codes.add(code)&&r.opt("name") instanceof String&&!name.trim().isEmpty()&&name.length()<=120&&is(r,"reconciled",true),"轮动板块或金额对账无效");
      for(String key:new String[]{"darkNetCents","visibleNetCents","combinedNetCents"})require(r.opt(key) instanceof String&&CENTS.matcher(r.getString(key)).matches(),"轮动金额缺失或格式无效");
      require(add(r.getString("darkNetCents"),r.getString("visibleNetCents")).equals(integer(r.getString("combinedNetCents")).toString()),"轮动金额对账不符");
      if(r.has("receivedAt")){long rt=timestamp(r.getString("receivedAt"));require(rt<=at&&at-rt<=60000,"行采样时刻超出扫描窗口");}
      require(r.isNull("sourceObservedAt"),"不能将未知来源钟升级为真实行情时刻");
    }
  }
  static String canonical(Object o) throws JSONException {
    if(o instanceof JSONObject){JSONObject original=(JSONObject)o;List<String> keys=new ArrayList<>();original.keys().forEachRemaining(keys::add);Collections.sort(keys);List<String> parts=new ArrayList<>();for(String key:keys)parts.add(JSONObject.quote(key)+":"+canonical(original.get(key)));return "{"+String.join(",",parts)+"}";}
    if(o instanceof JSONArray){List<String> parts=new ArrayList<>();JSONArray a=(JSONArray)o;for(int i=0;i<a.length();i++)parts.add(canonical(a.get(i)));return "["+String.join(",",parts)+"]";}
    if(o instanceof String)return JSONObject.quote((String)o);
    if(o instanceof Number){BigDecimal n=new BigDecimal(o.toString());require(Math.abs((long)n.scale())<=100&&n.precision()<=100,"数值精度或指数超限");return n.stripTrailingZeros().toPlainString();}
    return o==null?"null":o.toString();
  }
  static boolean knownOpen(LocalDate d){
    if(d.getYear()!=2026||d.getDayOfWeek().getValue()>5)return false;String s=d.toString();
    for(String range:new String[]{"01-01/01-03","02-15/02-23","04-04/04-06","05-01/05-05","06-19/06-21","09-25/09-27","10-01/10-07"}){String[] p=range.split("/");if(s.compareTo("2026-"+p[0])>=0&&s.compareTo("2026-"+p[1])<=0)return false;}return true;
  }
  static class Clock {
    long wall,trading=-1;String date;boolean recess;
    Clock(String s){wall=timestamp(s);OffsetDateTime d=Instant.ofEpochMilli(wall).atOffset(ZoneOffset.ofHours(8));date=d.toLocalDate().toString();if(!knownOpen(d.toLocalDate()))return;
      long ms=d.toLocalTime().toNanoOfDay()/1000000;recess=ms>690*60000L&&ms<780*60000L;
      if(ms>=570*60000L&&ms<=690*60000L)trading=ms-570*60000L;else if(ms>=780*60000L&&ms<897*60000L)trading=ms-660*60000L;
    }
  }
  static boolean captureAllowed(String date,String start,String end){
    try{Clock a=new Clock(start),b=new Clock(end);return a.date.equals(date)&&b.date.equals(date)&&a.trading>=0&&b.trading>=0&&b.wall>=a.wall&&b.wall-a.wall<=40000&&b.wall-a.wall==b.trading-a.trading;}catch(Exception e){return false;}
  }
  /** One explicitly requested scan, with the old source's coverage and session guards. */
  static final class Scan {
    volatile boolean cancelled;volatile java.net.HttpURLConnection connection;
    void cancel(){cancelled=true;java.net.HttpURLConnection c=connection;if(c!=null)c.disconnect();}
    void check(){require(!cancelled&&!Thread.currentThread().isInterrupted(),"请求已取消");}
    JSONObject fetch(String date,String scope,boolean daily) throws Exception {
      check();String start=Instant.now().toString();long began=android.os.SystemClock.elapsedRealtime();
      require(daily||captureAllowed(date,start,start),"当前不是该交易日盘中；可查日榜，不回填分时");
      JSONArray rows=new JSONArray();JSONObject base=null;int total=-1,page=0;String at=start;
      while(++page<=10){check();require(android.os.SystemClock.elapsedRealtime()-began<=40000,"扫描超过40秒，不保存半榜");
        java.net.HttpURLConnection c=(java.net.HttpURLConnection)new java.net.URL(url(date,scope,page)).openConnection();connection=c;
        try{c.setConnectTimeout(10000);c.setReadTimeout(10000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Referer","https://emrnweb.eastmoney.com/graymarket/");c.setRequestProperty("rnProjectId","emrn.GrayMarketRank");
          require(c.getResponseCode()==200,"旧来源未返回有效结果；保留缓存");ByteArrayOutputStream bytes=new ByteArrayOutputStream();
          try(InputStream input=c.getInputStream()){byte[] b=new byte[16384];int n;while((n=input.read(b))!=-1){check();require(android.os.SystemClock.elapsedRealtime()-began<=40000&&bytes.size()+n<=2*1024*1024,"扫描超时或响应超过2MiB");bytes.write(b,0,n);}}
          check();at=Instant.now().toString();JSONObject part=normalize(parse(bytes.toByteArray()),date,scope,page,at);JSONArray next=part.getJSONArray("rows");int count=part.getJSONObject("coverage").getInt("totalReported");
          if(base==null){base=part;total=count;}require(total>0&&count==total&&next.length()==Math.min(100,total-(page-1)*100),"分页总数变化或覆盖不完整");for(int i=0;i<next.length();i++)rows.put(next.getJSONObject(i));
        }finally{connection=null;c.disconnect();}
        if(rows.length()==total)break;Thread.sleep(250);
      }
      check();require(base!=null&&rows.length()==total&&android.os.SystemClock.elapsedRealtime()-began<=40000&&(daily||captureAllowed(date,start,at)),"扫描跨交易时段或不完整，未保存");
      base.put("schema",daily?"webstock.rotation-daily/v1":"webstock.rotation-snapshot/v1").put("date",date).put("sourceKey",sourceKey(base)).put("startedAt",start).put("receivedAt",at).put("rows",rows).put("coverage",obj("complete",true,"totalReported",total,"receivedRows",rows.length(),"pages",page,"paginationSnapshotConsistent",false));validate(base);return base;
    }
  }
  static JSONObject rowAt(JSONObject s,String code) throws JSONException {JSONArray rows=s.getJSONArray("rows");for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).optString("code").equals(code))return rows.getJSONObject(i);return null;}
  static String time(JSONObject s,JSONObject row){return row.optString("receivedAt",s.optString("receivedAt"));}
  static JSONObject window(JSONArray all,String code,String field,int minutes) throws JSONException {
    require(Arrays.asList("darkNetCents","visibleNetCents","combinedNetCents").contains(field)&&Arrays.asList(5,15,30).contains(minutes),"轮动窗口参数无效");
    JSONObject unknown=obj("deltaCents",JSONObject.NULL,"reason","数据不足、非盘中采样或采样不连续");if(all.length()==0)return unknown;
    JSONObject last=all.getJSONObject(all.length()-1),row=rowAt(last,code);if(!is(last,"schema","webstock.rotation-snapshot/v1")||row==null)return unknown;
    Clock end=new Clock(time(last,row));if(end.trading<0||!end.date.equals(last.optString("date")))return unknown;
    long distance=75001,target=end.trading-minutes*60000L;int start=-1;
    for(int i=0;i<all.length()-1;i++){JSONObject s=all.getJSONObject(i),r=rowAt(s,code);if(r==null)continue;Clock c=new Clock(time(s,r));long diff=Math.abs(c.trading-target);if(c.trading>=0&&c.date.equals(end.date)&&diff<=75000&&diff<=distance){start=i;distance=diff;}}
    if(start<0)return unknown;Clock previous=null;String first="",from="";String source=canonical(last.getJSONObject("source"));
    for(int i=start;i<all.length();i++){
      JSONObject s=all.getJSONObject(i),r=rowAt(s,code);
      if(!is(s,"schema","webstock.rotation-snapshot/v1")||!is(s,"date",last.opt("date"))||!is(s,"scope",last.opt("scope"))||!canonical(s.getJSONObject("source")).equals(source)||s.getJSONObject("coverage").optInt("totalReported")!=last.getJSONObject("coverage").optInt("totalReported")||!is(s.getJSONObject("coverage"),"complete",true))return unknown;
      Clock global=new Clock(s.getString("receivedAt"));if(global.recess&&r!=null&&new Clock(time(s,r)).recess)continue;
      if(r==null||!is(r,"reconciled",true)||!(r.opt(field) instanceof String))return unknown;
      String at=time(s,r);Clock c=new Clock(at);if(c.trading<0||!c.date.equals(end.date)||(previous!=null&&(c.wall<=previous.wall||c.trading<previous.trading||c.trading-previous.trading>150000)))return unknown;
      if(previous==null){first=r.getString(field);from=at;}previous=c;
    }
    if(previous==null)return unknown;Clock begin=new Clock(from);if(end.trading<=begin.trading)return unknown;
    return obj("deltaCents",integer(row.getString(field)).subtract(integer(first)).toString(),"from",from,"to",time(last,row),"tradingMinutes",(end.trading-begin.trading)/60000d,"reason","实际抓取采样的累计净额变化，不是逐笔流入");
  }
  static final class Store {
    final File file;
    Store(File file){this.file=file;}
    SQLiteDatabase open(){
      if(file.getParentFile()!=null)file.getParentFile().mkdirs();SQLiteDatabase db=SQLiteDatabase.openOrCreateDatabase(file,null);
      try{require(db.getVersion()<=1,"轮动库版本不支持");try(Cursor c=db.rawQuery("PRAGMA busy_timeout=5000",null)){c.moveToFirst();}db.execSQL("CREATE TABLE IF NOT EXISTS rotation(date TEXT NOT NULL,scope TEXT NOT NULL,daily INTEGER NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(date,scope,daily,at))");db.setVersion(1);return db;}catch(RuntimeException e){db.close();throw e;}
    }
    int insert(SQLiteDatabase db,JSONObject s) throws Exception {
      validate(s);String at=new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.ofEpochMilli(timestamp(s.getString("receivedAt"))));String[] keys={s.getString("date"),s.getString("scope"),is(s,"schema","webstock.rotation-daily/v1")?"1":"0",at};String data=canonical(s);
      try(Cursor c=db.rawQuery("SELECT data FROM rotation WHERE date=? AND scope=? AND daily=? AND at=?",keys)){if(c.moveToFirst()){require(c.getString(0).equals(data),"同一次采样内容冲突；保留原档案");return 0;}}
      db.execSQL("INSERT INTO rotation(date,scope,daily,at,data) VALUES(?,?,?,?,?)",new Object[]{keys[0],keys[1],Integer.parseInt(keys[2]),keys[3],data});return 1;
    }
    int save(JSONObject s) throws Exception {require(!Thread.currentThread().isInterrupted(),"保存取消");try(SQLiteDatabase db=open()){db.beginTransaction();try{require(!Thread.currentThread().isInterrupted(),"保存取消");int n=insert(db,s);require(!Thread.currentThread().isInterrupted(),"保存取消");db.setTransactionSuccessful();return n;}finally{db.endTransaction();}}}
    int importStream(InputStream source,boolean daily) throws Exception {
      try(SQLiteDatabase db=open()){
        db.beginTransaction();int count=0,lines=0;long size=0;ByteArrayOutputStream record=new ByteArrayOutputStream();
        try{byte[] buf=new byte[32768];int read;
          while((read=source.read(buf))!=-1){require(!Thread.currentThread().isInterrupted(),"导入取消；本文件未提交");size+=read;require(size<=128L*1024*1024,"轮动档案超过128MiB");for(int i=0;i<read;i++){
            byte b=buf[i];record.write(b);require(record.size()<=2*1024*1024,"单记录超过2MiB");
            if(b=='\n'&&!daily){require(++lines<=10000,"档案采样超过10000次");count+=insert(db,parse(record.toByteArray()));record.reset();}
          }}
          require(size>0,"空档案");if(daily)count+=insert(db,parse(record.toByteArray()));else require(record.size()==0,"尾行不完整；整个文件未导入");
          require(!Thread.currentThread().isInterrupted(),"导入取消；本文件未提交");db.setTransactionSuccessful();return count;
        }finally{db.endTransaction();}
      }
    }
    List<String> dates(){List<String> out=new ArrayList<>();if(!file.isFile())return out;try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT DISTINCT date FROM rotation ORDER BY date DESC",null)){while(c.moveToNext())out.add(c.getString(0));}return out;}
    JSONArray read(String date,String scope,boolean daily) throws Exception {
      require(dateOK(date)&&(scope.equals("industry")||scope.equals("concept")),"查询日期/范围无效");JSONArray out=new JSONArray();if(!file.isFile())return out;
      try(SQLiteDatabase db=open();Cursor c=db.rawQuery("SELECT data FROM rotation WHERE date=? AND scope=? AND daily=? ORDER BY at",new String[]{date,scope,daily?"1":"0"})){
        while(c.moveToNext()){require(!Thread.currentThread().isInterrupted(),"读取取消");require(out.length()<10000,"单日档案超过10000次");JSONObject s=new JSONObject(c.getString(0));validate(s);out.put(s);}
      }return out;
    }
    void exportStream(OutputStream out,String date,String scope,boolean daily,String first,String last,int count) throws Exception {
      require(dateOK(date)&&(scope.equals("industry")||scope.equals("concept"))&&count>0&&count<=10000,"导出范围无效");
      java.time.format.DateTimeFormatter fmt=new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter();
      String[] args={date,scope,daily?"1":"0",fmt.format(Instant.ofEpochMilli(timestamp(first))),fmt.format(Instant.ofEpochMilli(timestamp(last)))};
      try(SQLiteDatabase db=open()){db.beginTransaction();try{
        String where="date=? AND scope=? AND daily=? AND at>=? AND at<=?";
        try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM rotation WHERE "+where,args)){require(c.moveToFirst()&&c.getInt(0)==count,"选定区间新增过采样，请重新预览导出");}
        try(Cursor c=db.rawQuery("SELECT data FROM rotation WHERE "+where+" ORDER BY at",args)){while(c.moveToNext()){require(!Thread.currentThread().isInterrupted(),"导出取消，所选新文件可能不完整");String record=c.getString(0);validate(new JSONObject(record));out.write((record+"\n").getBytes(StandardCharsets.UTF_8));}}
        out.flush();db.setTransactionSuccessful();
      }finally{db.endTransaction();}}
    }
  }
  static JSONObject parse(byte[] bytes) throws Exception {
    require(bytes.length<=2*1024*1024,"单记录超过2MiB");
    String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT).decode(java.nio.ByteBuffer.wrap(bytes)).toString();
    try(JsonReader reader=new JsonReader(new StringReader(text))){reader.setLenient(false);Object value=readValue(reader,0);require(value instanceof JSONObject&&reader.peek()==JsonToken.END_DOCUMENT,"JSON对象后存在多余内容");return (JSONObject)value;}
  }
  static Object readValue(JsonReader r,int depth) throws Exception {
    require(depth<=32,"JSON嵌套超过32层");
    switch(r.peek()){
      case BEGIN_OBJECT:{JSONObject o=new JSONObject();r.beginObject();while(r.hasNext()){String key=r.nextName();require(!o.has(key),"JSON字段重复");o.put(key,readValue(r,depth+1));}r.endObject();return o;}
      case BEGIN_ARRAY:{JSONArray a=new JSONArray();r.beginArray();while(r.hasNext())a.put(readValue(r,depth+1));r.endArray();return a;}
      case STRING:return r.nextString();
      case BOOLEAN:return r.nextBoolean();
      case NULL:r.nextNull();return JSONObject.NULL;
      case NUMBER:{String s=r.nextString();require(s.length()<=100,"数值长度超限");BigDecimal n=new BigDecimal(s);require(Double.isFinite(n.doubleValue())&&Math.abs((long)n.scale())<=100&&n.precision()<=100,"数值非有限或精度/指数超限");return n.stripTrailingZeros();}
      default:throw new IllegalArgumentException("JSON格式无效");
    }
  }
}
