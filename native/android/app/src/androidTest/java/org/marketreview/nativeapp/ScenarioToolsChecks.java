package org.marketreview.nativeapp;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
/** Synthetic, supplied data only; usable in JVM and as an instrumentation helper. */
public final class ScenarioToolsChecks {
    static int checks;
    static void compare(Object a,Object e,String path)throws Exception{
        ++checks;
        if(e instanceof JSONObject){if(!(a instanceof JSONObject))throw new AssertionError(path+" not object");JSONObject o=(JSONObject)e;Iterator<String> keys=o.keys();while(keys.hasNext()){String k=keys.next();compare(((JSONObject)a).get(k),o.get(k),path+"."+k);}}
        else if(e instanceof JSONArray){if(!(a instanceof JSONArray)||((JSONArray)a).length()!=((JSONArray)e).length())throw new AssertionError(path+" array length");for(int i=0;i<((JSONArray)e).length();i++)compare(((JSONArray)a).get(i),((JSONArray)e).get(i),path+"["+i+"]");}
        else if(e instanceof Number){double actual=a instanceof Number?((Number)a).doubleValue():Double.NaN,expected=((Number)e).doubleValue();if(!Double.isFinite(actual)||Math.abs(actual-expected)>Math.max(1e-6,Math.abs(expected)*1e-10))throw new AssertionError(path+" got "+a+" expected "+e);}
        else if(!Objects.equals(a,e))throw new AssertionError(path+" got "+a+" expected "+e);
    }
    public static int fixtures(JSONObject fixture,String module)throws Exception{checks=0;int failed=0,done=0;JSONArray cases=fixture.getJSONArray("cases");for(int i=0;i<cases.length();i++){JSONObject c=cases.getJSONObject(i);String m=c.getString("module");if(module!=null&&!module.equals(m))continue;try{JSONObject input=c.getJSONObject("input");String before=input.toString();compare(ScenarioTools.evaluate(m,input).getJSONObject("result"),c.getJSONObject("expected"),c.getString("name"));if(!before.equals(input.toString()))throw new AssertionError("input mutated");done++;}catch(Exception|AssertionError e){failed++;System.err.println(c.getString("name")+": "+e);}}System.out.println("scenario legacy: "+done+" cases, "+checks+" assertions, "+failed+" failed");if(failed>0)throw new AssertionError(failed+" scenario failures");return checks;}
    public static void main(String[] args)throws Exception{fixtures(new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8)),args.length>1?args[1]:null);}
}
