package org.marketreview.nativeapp;
import org.json.*;
final class QuantResearchJson {
 private static final class Syntax {
  final String s;int i;
  Syntax(String text){s=text;}
  void ws(){while(i<s.length()&&" \t\r\n".indexOf(s.charAt(i))>=0)i++;}
  boolean eat(char c){ws();if(i<s.length()&&s.charAt(i)==c){i++;return true;}return false;}
  void string(){need(eat('"'),"JSON字符串无效");boolean closed=false;while(i<s.length()){char c=s.charAt(i++);if(c=='"'){closed=true;break;}need(c>=32,"JSON字符串含控制字符");if(c=='\\'){need(i<s.length(),"JSON转义不完整");char e=s.charAt(i++);if(e=='u'){need(i+4<=s.length(),"JSON Unicode转义不完整");for(int n=0;n<4;n++)need("0123456789abcdefABCDEF".indexOf(s.charAt(i++))>=0,"JSON Unicode转义无效");}else need("\"\\/bfnrt".indexOf(e)>=0,"JSON转义无效");}}need(closed,"JSON字符串未结束");}
  void value(int depth){need(depth<=100,"JSON嵌套超过100层");ws();need(i<s.length(),"JSON值缺失");char c=s.charAt(i);if(c=='"'){string();return;}if(eat('{')){if(eat('}'))return;do{string();need(eat(':'),"JSON缺少冒号");value(depth+1);if(eat('}'))return;need(eat(','),"JSON对象缺少逗号");}while(true);}if(eat('[')){if(eat(']'))return;do{value(depth+1);if(eat(']'))return;need(eat(','),"JSON数组缺少逗号");}while(true);}for(String literal:new String[]{"true","false","null"})if(s.startsWith(literal,i)){i+=literal.length();return;}int start=i;if(c=='-')i++;need(i<s.length(),"JSON数字不完整");if(s.charAt(i)=='0')i++;else{need(s.charAt(i)>='1'&&s.charAt(i)<='9',"JSON值无效");while(i<s.length()&&s.charAt(i)>='0'&&s.charAt(i)<='9')i++;}if(i<s.length()&&s.charAt(i)=='.'){i++;int digits=i;while(i<s.length()&&s.charAt(i)>='0'&&s.charAt(i)<='9')i++;need(i>digits,"JSON小数不完整");}if(i<s.length()&&(s.charAt(i)=='e'||s.charAt(i)=='E')){i++;if(i<s.length()&&(s.charAt(i)=='+'||s.charAt(i)=='-'))i++;int digits=i;while(i<s.length()&&s.charAt(i)>='0'&&s.charAt(i)<='9')i++;need(i>digits,"JSON指数不完整");}need(i>start,"JSON值无效");double number=Double.parseDouble(s.substring(start,i));need(Double.isFinite(number),"数值超出可移植精度，请用文本保留原值");}
  void check(){value(0);ws();need(i==s.length(),"JSON尾部含额外内容");}
 }
 static void need(boolean ok,String message){QuantResearchModel.need(ok,message);}
 static JSONObject parse(String text)throws Exception{new Syntax(text).check();return new JSONObject(text);}
 static JSONArray array(String text)throws Exception{new Syntax(text).check();return new JSONArray(text);}
}
