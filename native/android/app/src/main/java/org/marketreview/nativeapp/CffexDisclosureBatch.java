package org.marketreview.nativeapp;
import java.util.*;
import org.json.*;

/** One exact-day transaction, using the existing single-request transport sequentially. */
final class CffexDisclosureBatch {
 static final List<String> PRODUCTS=Collections.unmodifiableList(Arrays.asList("IF","IH","IC","IM"));
 final String date;final List<String> products;JSONArray staged=new JSONArray();boolean cancelled;
 CffexDisclosureBatch(String day,String scope)throws Exception{
  date=day;products=scope.equals("ALL")?PRODUCTS:Collections.singletonList(scope);
  for(String product:products)CffexDisclosureModel.request(day,product);
 }
 int required(){return products.size();}
 int received(){return staged.length();}
 boolean complete(){return !cancelled&&received()==required();}
 JSONObject request()throws Exception{CffexDisclosureModel.need(!cancelled&&!complete(),"本批读取已结束");return CffexDisclosureModel.request(date,products.get(received()));}
 void accept(JSONObject report)throws Exception{
  try{JSONObject expected=request(),safe=CffexDisclosureModel.validate(report);
   CffexDisclosureModel.need(CffexDisclosureModel.equal(expected,safe.getJSONObject("request")),"响应日期或品种与本批请求不符");staged.put(safe);
  }catch(Exception e){cancel();throw e;}
 }
 void cancel(){cancelled=true;staged=new JSONArray();}
 JSONArray result()throws Exception{CffexDisclosureModel.need(complete(),"本批未完整成功，不能更新总摘要");return new JSONArray(staged.toString());}
 static JSONObject scope(JSONArray reports)throws Exception{
  CffexDisclosureModel.need(reports!=null&&(reports.length()==1||reports.length()==4),"只接受一个品种或完整四品种批次");
  Set<String> seen=new HashSet<>();String day="";JSONArray products=new JSONArray();
  for(int i=0;i<reports.length();i++){
   JSONObject q=reports.getJSONObject(i).getJSONObject("request");String p=q.getString("product"),d=q.getString("date");
   CffexDisclosureModel.day(d);CffexDisclosureModel.need(PRODUCTS.contains(p)&&seen.add(p),"批次品种无效或重复");
   CffexDisclosureModel.need(day.isEmpty()||day.equals(d),"四品种须为同一披露日");day=d;
  }
  for(String p:PRODUCTS)if(seen.contains(p))products.put(p);
  return new JSONObject().put("date",day).put("products",products).put("productCount",reports.length()).put("allProducts",reports.length()==4);
 }
 static JSONArray validated(JSONArray reports)throws Exception{
  CffexDisclosureModel.need(reports!=null&&(reports.length()==1||reports.length()==4),"阅读批次不完整");
  JSONArray safe=new JSONArray();for(int i=0;i<reports.length();i++)safe.put(CffexDisclosureModel.validate(reports.getJSONObject(i)));
  scope(safe);JSONArray ordered=new JSONArray();for(String p:PRODUCTS)for(int i=0;i<safe.length();i++)if(safe.getJSONObject(i).getJSONObject("request").getString("product").equals(p))ordered.put(safe.getJSONObject(i));return ordered;
 }
}
