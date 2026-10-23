package org.marketreview.nativeapp;
import org.json.*;import java.nio.file.*;import java.nio.charset.StandardCharsets;import java.time.*;
/** Host-JVM semantic checks only; Android SQLite/UI acceptance is a separate device check. */
public final class HostCandidateBackgroundJvmChecks {
 static int checks;static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
 interface Call {void run()throws Exception;}static void rejects(Call c,String why)throws Exception{boolean failed=false;try{c.run();}catch(Exception e){failed=true;}check(failed,why);}
 public static void main(String[]args)throws Exception{JSONObject qt=new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])),StandardCharsets.UTF_8)).getJSONObject("bundle"),bundle=new JSONObject(qt.toString());
  LocalCandidateBackgroundAdapter.verify(bundle.getJSONObject("adapter"));JSONObject rebuilt=LocalCandidateModel.evaluate(bundle.getJSONObject("result").getJSONObject("input"));check(LocalCandidateBackgroundAdapter.canonical(qt.getJSONObject("result").get("rows")).equals(LocalCandidateBackgroundAdapter.canonical(rebuilt.get("rows"))),"Qt/JVM full candidate rows and background semantics");
  // Host org.json quote differs from Android framework JSONObject for slash escaping. Recompute only candidate hash on this JVM; adapter hash is unchanged.
  boolean nativeHashEqual=rebuilt.getString("inputHash").equals(qt.getJSONObject("result").getString("inputHash"));bundle.put("result",rebuilt);HostCandidateBackground.verify(bundle,null);check(true,"pure bundle verification");
  JSONObject bad=new JSONObject(bundle.toString()).put("schema","wrong");rejects(()->HostCandidateBackground.verify(bad,null),"unknown bundle version");
  JSONObject raw=new JSONObject(bundle.getJSONObject("adapter").getJSONObject("input").toString()).put("hostPaths",new JSONObject());JSONObject other=LocalCandidateBackgroundAdapter.freeze(raw),mismatch=new JSONObject(bundle.toString()).put("adapter",other);rejects(()->HostCandidateBackground.verify(mismatch,null),"independently valid adapter cannot be substituted");
  JSONObject laterInput=new JSONObject(rebuilt.getJSONObject("input").toString());laterInput.put("capturedAt",Instant.parse(laterInput.getString("capturedAt")).plusSeconds(1).toString());JSONObject later=new JSONObject(bundle.toString()).put("result",LocalCandidateModel.evaluate(laterInput));rejects(()->HostCandidateBackground.verify(later,null),"cut mismatch rejected");rejects(()->HostCandidateBackground.verify(bundle,()->true),"generation cancellation");
  JSONObject out=new JSONObject().put("passed",true).put("checks",checks).put("qtJvmRowsEqual",true).put("qtArtifactSha256",SectorLeaderModel.hash(Files.readAllBytes(Paths.get(args[0])))).put("candidateNativeHashEqualOnHostOrgJson",nativeHashEqual).put("scope","Pure host-JVM bundle/row semantics; Android framework candidate hash and real SQLite/UI require device check");Files.write(Paths.get(args[1]),out.toString(2).getBytes(StandardCharsets.UTF_8));System.out.println("PASS JVM bundle semantics checks="+checks+"; full candidate rows match Qt; native framework hash/device checks pending");
 }
}
