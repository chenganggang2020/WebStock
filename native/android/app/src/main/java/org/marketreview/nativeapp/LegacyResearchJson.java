package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;

/** Local legacy JSON.stringify profile only; the unified/native hash contract is unchanged. */
final class LegacyResearchJson {
 static final class Value {
  int kind;String string;double number;boolean bool;List<String>keys=new ArrayList<>();List<Value>values=new ArrayList<>();
  Value get(String name){int at=keys.indexOf(name);return at<0?null:values.get(at);}
 }
 static String number(double value)throws Exception{
  need(Double.isFinite(value),"旧JSON数值非有限");if(value==0)return "0";
  BigDecimal exact=new BigDecimal(Math.abs(value)),chosen=null;
  for(int p=1;p<=17&&chosen==null;p++){
   BigDecimal rounded=exact.round(new MathContext(p,RoundingMode.HALF_EVEN)),unit=BigDecimal.ONE.scaleByPowerOfTen(-rounded.scale()),best=null;
   for(BigDecimal item:new BigDecimal[]{rounded,rounded.subtract(unit),rounded.add(unit)})if(item.signum()>0&&Double.doubleToRawLongBits(item.doubleValue())==Double.doubleToRawLongBits(Math.abs(value))){
    if(best==null||item.subtract(exact).abs().compareTo(best.subtract(exact).abs())<0||(item.subtract(exact).abs().compareTo(best.subtract(exact).abs())==0&&!item.unscaledValue().testBit(0)))best=item;
   }
   chosen=best;
  }
  need(chosen!=null,"旧JSON数值无法严格往返");chosen=chosen.stripTrailingZeros();String out;
  if(Math.abs(value)>=1e21||Math.abs(value)<1e-6){String digits=chosen.unscaledValue().abs().toString();int exponent=digits.length()-chosen.scale()-1;out=digits.substring(0,1)+(digits.length()>1?"."+digits.substring(1):"")+"e"+(exponent>=0?"+":"")+exponent;}
  else out=chosen.toPlainString();return (value<0?"-":"")+out;
 }
 static Long index(String key){try{long n=Long.parseLong(key);return n>=0&&n<4294967295L&&Long.toString(n).equals(key)?n:null;}catch(Exception e){return null;}}
 static String encode(Value v)throws Exception{
  switch(v.kind){case 0:return "null";case 1:return Boolean.toString(v.bool);case 2:return number(v.number);case 3:return quote(v.string);case 4:{List<String> items=new ArrayList<>();for(Value item:v.values)items.add(encode(item));return "["+String.join(",",items)+"]";}
   case 5:{TreeMap<Long,Integer> numeric=new TreeMap<>();List<Integer> plain=new ArrayList<>();for(int i=0;i<v.keys.size();i++){Long n=index(v.keys.get(i));if(n==null)plain.add(i);else numeric.put(n,i);}List<String> parts=new ArrayList<>();for(int i:numeric.values())parts.add(quote(v.keys.get(i))+":"+encode(v.values.get(i)));for(int i:plain)parts.add(quote(v.keys.get(i))+":"+encode(v.values.get(i)));return "{"+String.join(",",parts)+"}";}
   default:throw new Exception("旧JSON类型无效");
  }
 }
 static final class Parser {
  final String source;int at;Parser(String text){source=text;}
  void ws(){while(at<source.length()&&" \r\n\t".indexOf(source.charAt(at))>=0)at++;}
  String text()throws Exception{ws();need(at<source.length()&&source.charAt(at)=='"',"旧JSON文本缺失");int begin=at++;while(at<source.length()){char c=source.charAt(at++);if(c=='\\'){need(at<source.length(),"旧JSON转义缺失");at++;}else if(c=='"')return new JSONArray("["+source.substring(begin,at)+"]").getString(0);}throw new Exception("旧JSON文本未闭合");}
  Value value(int depth)throws Exception{need(depth<=64,"旧JSON过深");ws();need(at<source.length(),"旧JSON值缺失");Value out=new Value();char c=source.charAt(at);
   if(c=='"'){out.kind=3;out.string=text();return out;}
   if(c=='{'||c=='['){out.kind=c=='{'?5:4;char end=c=='{'?'}':']';at++;ws();if(at<source.length()&&source.charAt(at)==end){at++;return out;}Set<String>seen=new HashSet<>();
    for(;;){ws();if(out.kind==5){String key=text();need(seen.add(key),"旧JSON重复键");out.keys.add(key);ws();need(at<source.length()&&source.charAt(at++)==':',"旧JSON冒号缺失");}out.values.add(value(depth+1));ws();need(at<source.length(),"旧JSON容器未闭合");if(source.charAt(at)==end){at++;return out;}need(source.charAt(at++)==',',"旧JSON逗号缺失");}
   }
   int begin=at;while(at<source.length()&&" \r\n\t,]}".indexOf(source.charAt(at))<0)at++;String token=source.substring(begin,at);if("null".equals(token))out.kind=0;else if("true".equals(token)||"false".equals(token)){out.kind=1;out.bool="true".equals(token);}else{out.kind=2;out.number=Double.parseDouble(token);need(Double.isFinite(out.number),"旧JSON数字非有限");}return out;
  }
  Value run()throws Exception{need(!source.isEmpty()&&source.getBytes(StandardCharsets.UTF_8).length<=32*1024*1024,"旧JSON完整上限32MiB");new WatchlistBackupModel.JsonGate(source).run();Value v=value(0);ws();need(at==source.length(),"旧JSON尾部多余内容");return v;}
 }
 static String digest(Value value)throws Exception{byte[] bytes=MessageDigest.getInstance("SHA-256").digest(encode(value).getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 static String contentHash(Value payload)throws Exception{need(payload.kind==5,"旧版本payload缺失");Value selected=new Value();selected.kind=5;for(String key:new String[]{"evidenceIds","relations","gaps","analysis"}){Value value=payload.get(key);if(value!=null){selected.keys.add(key);selected.values.add(value);}}return digest(selected);}
}

