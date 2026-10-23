package org.marketreview.nativeapp;

import java.util.*;
import org.json.*;

/** Device-local replay of cumulative provider-model snapshots, not trade flows. */
final class RotationAnalysis {
  static final String COMBINED="combinedNetCents";
  static final class Point {
    DarkRotation.Clock clock,batch;String at,date,key,scope;int total;boolean complete,daily;JSONObject row;
    Point(JSONObject s,JSONObject r) throws JSONException {
      row=r==null?new JSONObject():r;batch=new DarkRotation.Clock(s.getString("receivedAt"));at=DarkRotation.time(s,row);clock=new DarkRotation.Clock(at);clock.recess&=batch.recess;
      if(clock.wall>batch.wall||batch.wall-clock.wall>60000){clock.trading=-1;clock.recess=false;}
      date=s.optString("date");key=DarkRotation.canonical(s.getJSONObject("source"));scope=s.optString("scope");JSONObject coverage=s.getJSONObject("coverage");total=coverage.optInt("totalReported");complete=coverage.optBoolean("complete");daily=!s.optString("schema").equals("webstock.rotation-snapshot/v1");
    }
    Point(Point base,JSONObject r,Map<String,DarkRotation.Clock> clocks){row=r==null?new JSONObject():r;batch=base.batch;date=base.date;key=base.key;scope=base.scope;total=base.total;complete=base.complete;daily=base.daily;at=row.optString("receivedAt",base.at);clock=clocks.get(at);if(clock==null){clock=new DarkRotation.Clock(at);clock.recess&=batch.recess;if(clock.wall>batch.wall||batch.wall-clock.wall>60000){clock.trading=-1;clock.recess=false;}clocks.put(at,clock);}}
  }
  static void check(){DarkRotation.require(!Thread.currentThread().isInterrupted(),"轮动分析取消");}
  static boolean valueOK(Object v){return v instanceof String&&((String)v).matches("-?[0-9]{1,22}");}
  static void parameters(String field,int minutes){DarkRotation.require(Arrays.asList(COMBINED,"darkNetCents","visibleNetCents").contains(field)&&Arrays.asList(5,15,30).contains(minutes),"轮动分析参数无效");}
  static List<JSONObject> ordered(JSONArray input) throws JSONException {
    DarkRotation.require(input.length()<=10000,"单日采样超过分析上限");TreeMap<Long,JSONObject> unique=new TreeMap<>();for(int i=0;i<input.length();i++){check();JSONObject s=input.getJSONObject(i);unique.put(DarkRotation.timestamp(s.getString("receivedAt")),s);}return new ArrayList<>(unique.values());
  }
  static boolean same(Point a,Point b){return !a.daily&&!b.daily&&a.complete&&b.complete&&a.date.equals(b.date)&&a.scope.equals(b.scope)&&a.key.equals(b.key)&&a.total==b.total&&a.clock.date.equals(a.date)&&b.clock.date.equals(b.date);}
  static boolean pair(Point a,Point b){return same(a,b)&&a.clock.trading>=0&&b.clock.trading>=a.clock.trading&&b.clock.wall>=a.clock.wall&&b.clock.trading-a.clock.trading<=150000;}
  static JSONObject calculate(List<Point> p,int end,int minutes,String field) throws JSONException {
    JSONObject unknown=DarkRotation.obj("deltaCents",JSONObject.NULL);if(end<0)return unknown;Point e=p.get(end);if(e.daily||e.clock.trading<0||!e.clock.date.equals(e.date)||!e.row.optBoolean("reconciled")||!valueOK(e.row.opt(field)))return unknown;
    long target=e.clock.trading-minutes*60000L,distance=75001;int start=-1;
    for(int i=end-1;i>=0;i--){if(i%64==0)check();Point a=p.get(i);if(a.batch.date.compareTo(e.date)<0||(a.batch.date.equals(e.date)&&a.batch.trading>=0&&a.batch.trading<target-75000))break;long d=Math.abs(a.clock.trading-target);if(a.clock.trading<0||!a.date.equals(e.date)||d>75000)continue;if(d<distance||(d==distance&&start>=0&&(a.clock.trading!=p.get(start).clock.trading||a.clock.wall>=p.get(start).clock.wall))){start=i;distance=d;}}
    if(start<0)return unknown;Point previous=null;
    for(int i=start;i<=end;i++){if(i%64==0)check();Point a=p.get(i);if(!same(a,e))return unknown;if(a.clock.recess)continue;if(a.clock.trading<0||!a.row.optBoolean("reconciled")||!valueOK(a.row.opt(field))||(previous!=null&&!pair(previous,a)))return unknown;previous=a;}
    double elapsed=(e.clock.trading-p.get(start).clock.trading)/60000d;if(elapsed<=0)return unknown;String delta=DarkRotation.integer(e.row.getString(field)).subtract(DarkRotation.integer(p.get(start).row.getString(field))).toString();
    return DarkRotation.obj("deltaCents",delta,"speedYuanPerMinute",Double.parseDouble(delta)/100/elapsed,"startIndex",start,"startAt",p.get(start).at,"endAt",e.at,"elapsedMinutes",elapsed);
  }
  static JSONObject analyze(JSONArray input,String field,int minutes,String now) throws JSONException {
    parameters(field,minutes);check();List<JSONObject> all=ordered(input);JSONObject result=DarkRotation.obj("rows",new JSONArray(),"inflow",new JSONArray(),"outflow",new JSONArray(),"accelerating",new JSONArray(),"decelerating",new JSONArray(),"eligible",0,"windowEndAt",JSONObject.NULL,"sampleCount",all.size(),"historical",true);if(all.isEmpty())return result;
    JSONObject last=all.get(all.size()-1);boolean future=DarkRotation.timestamp(last.getString("receivedAt"))>DarkRotation.timestamp(now)+5000;result.put("receivedAt",last.get("receivedAt")).put("future",future);
    Map<String,List<Point>> indexed=new TreeMap<>();JSONArray lastRows=last.getJSONArray("rows");for(int i=0;i<lastRows.length();i++)indexed.put(lastRows.getJSONObject(i).getString("code"),new ArrayList<>());
    List<Point> batches=new ArrayList<>();for(JSONObject s:all){check();Point base=new Point(s,DarkRotation.obj("reconciled",true,field,"0"));batches.add(base);Map<String,DarkRotation.Clock> clocks=new HashMap<>();clocks.put(base.at,base.clock);Map<String,JSONObject> rows=new HashMap<>();JSONArray values=s.getJSONArray("rows");for(int i=0;i<values.length();i++){JSONObject r=values.getJSONObject(i);rows.put(r.getString("code"),r);}for(Map.Entry<String,List<Point>> e:indexed.entrySet())e.getValue().add(new Point(base,rows.get(e.getKey()),clocks));}
    int anchor=future||!last.optString("schema").equals("webstock.rotation-snapshot/v1")?-1:all.size()-1;
    while(anchor>=0){check();boolean found=false;if(!calculate(batches,anchor,minutes,field).isNull("deltaCents"))for(List<Point> p:indexed.values()){check();if(!calculate(p,anchor,minutes,field).isNull("deltaCents")){found=true;break;}}if(found)break;anchor--;}
    JSONArray rows=new JSONArray();int eligible=0;
    for(int i=0;i<lastRows.length();i++){
      check();JSONObject original=lastRows.getJSONObject(i),r=new JSONObject(original.toString());List<Point> points=indexed.get(r.getString("code"));JSONObject current=calculate(points,anchor,minutes,field);boolean valid=!current.isNull("deltaCents");JSONObject prior=valid?calculate(points,current.getInt("startIndex"),minutes,field):new JSONObject();
      for(String key:new String[]{"deltaCents","speedYuanPerMinute","startAt","endAt","elapsedMinutes"})r.put(key,valid?current.get(key):JSONObject.NULL);
      r.put("speedChange",valid&&!prior.isNull("deltaCents")?current.getDouble("speedYuanPerMinute")-prior.getDouble("speedYuanPerMinute"):JSONObject.NULL);
      JSONObject dark=calculate(points,anchor,minutes,"darkNetCents"),visible=calculate(points,anchor,minutes,"visibleNetCents");r.put("divergence",!dark.isNull("deltaCents")&&!visible.isNull("deltaCents")?Double.parseDouble(dark.getString("deltaCents"))*Double.parseDouble(visible.getString("deltaCents"))<0:JSONObject.NULL);
      double d=valid?Double.parseDouble(current.getString("deltaCents")):0,p=prior.isNull("deltaCents")?0:Double.parseDouble(prior.getString("deltaCents"));r.put("state",!valid?"数据不足":prior.isNull("deltaCents")?"前窗不足":d>0&&p<0?"区间净额变化由负转正":d<0&&p>0?"区间净额变化由正转负":d>0?"净额增加":d<0?"净额减少":"净额未变");if(valid)eligible++;rows.put(r);
    }
    result.put("rows",rows).put("eligible",eligible);if(eligible>0)result.put("windowEndAt",all.get(anchor).get("receivedAt"));
    for(String name:new String[]{"inflow","outflow","accelerating","decelerating"}){
      String key=name.equals("inflow")||name.equals("outflow")?"speedYuanPerMinute":"speedChange";int sign=name.equals("inflow")||name.equals("accelerating")?1:-1;List<JSONObject> ranked=new ArrayList<>();
      for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);if(r.opt(key) instanceof Number&&r.optDouble(key)*sign>0)ranked.add(r);}
      ranked.sort((a,b)->{int cmp=Double.compare(b.optDouble(key)*sign,a.optDouble(key)*sign);return cmp==0?a.optString("code").compareTo(b.optString("code")):cmp;});result.put(name,new JSONArray(ranked));
    }return result;
  }
  static JSONArray series(JSONArray input,String code,String field) throws JSONException {
    parameters(field,5);JSONArray out=new JSONArray();Point previous=null;boolean interrupted=false;
    for(JSONObject s:ordered(input)){check();Point p=new Point(s,DarkRotation.rowAt(s,code));if(p.daily)return new JSONArray();if(p.clock.recess&&p.clock.date.equals(p.date)){if(previous!=null&&!same(previous,p))interrupted=true;continue;}if(p.clock.trading<0||!p.clock.date.equals(p.date)){interrupted=true;continue;}
      out.put(DarkRotation.obj("at",p.at,"tradingTimeMs",p.clock.trading,"gapBefore",interrupted||(previous!=null&&!pair(previous,p)),"cumulativeCents",p.row.optBoolean("reconciled")&&valueOK(p.row.opt(field))?p.row.get(field):JSONObject.NULL,"changeRatio",p.row.opt("changeRatio") instanceof Number?p.row.get("changeRatio"):JSONObject.NULL));previous=p;interrupted=false;
    }return out;
  }
}
