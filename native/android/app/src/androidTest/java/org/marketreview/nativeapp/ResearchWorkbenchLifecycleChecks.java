package org.marketreview.nativeapp;
import android.content.Intent;
import android.view.View;
import android.widget.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Actual Android widgets in an owned Main test surface; not the integrated F07 route. */
final class ResearchWorkbenchLifecycleChecks {
 static JSONObject run(FlowInstrumentation t)throws Exception{
  File cache=t.getTargetContext().getCacheDir().getCanonicalFile(),dir=new File(cache,"f07-life-"+UUID.randomUUID());
  t.check(dir.mkdir()&&dir.getCanonicalFile().getParentFile().equals(cache),"owned F07 lifecycle directory");
  t.activity=(MainActivity)t.startActivitySync(new Intent(t.getTargetContext(),MainActivity.class).putExtra("testFixtures",true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));t.waitForIdleSync();t.awaitCollectionService();
  final ResearchWorkbenchScreen[] page={null};int[] requests={0,0};ArrayList<String>failures=new ArrayList<>();int[] checks={0};
  t.ui(()->{page[0]=new ResearchWorkbenchScreen(t.activity,new File(dir,"isolated-business.sqlite"),()->{requests[1]++;return new JSONObject();});page[0].importRequested=()->requests[0]++;t.activity.setContentView(page[0]);page[0].setActive(true);});
  ResearchWorkbenchScreen screen=page[0];RecentRestoreMainChecks.await(t,()->screen.isShown()&&screen.hasWindowFocus());
  t.ui(()->screen.acceptBytes("original manual input".getBytes(StandardCharsets.UTF_8)));
  EditText raw=(EditText)RecentRestoreMainChecks.tag(screen,"f07BatchInput");
  t.ui(()->{verify(raw.getText().toString().equals("original manual input"),"visible input accepted",checks,failures);screen.setActive(false);screen.setVisibility(View.GONE);});
  File draft=new File(new File(dir,"isolated-business.sqlite")+".f07-draft.json");byte[] before=read(draft);
  t.ui(()->{
   ((Button)RecentRestoreMainChecks.tag(screen,"f07Import")).performClick();verify(requests[0]==0,"hidden old import button rejected",checks,failures);
   screen.acceptBytes("late foreign input".getBytes(StandardCharsets.UTF_8));verify(raw.getText().toString().equals("original manual input"),"hidden acceptBytes retains input",checks,failures);
   screen.previewPacket();verify(requests[1]==0,"hidden preview never reads context",checks,failures);
  });
  verify(Arrays.equals(before,read(draft)),"hidden callbacks preserve draft original bytes",checks,failures);
  Thread.sleep(150);t.waitForIdleSync();
  t.ui(()->{screen.setVisibility(View.VISIBLE);screen.setActive(true);});RecentRestoreMainChecks.await(t,()->screen.hasWindowFocus());
  t.ui(()->screen.acceptBytes("normal return new input".getBytes(StandardCharsets.UTF_8)));
  t.ui(()->{verify(raw.getText().toString().equals("normal return new input"),"normal visible return still accepted",checks,failures);raw.setText("intentional leave saves manual draft");screen.setActive(false);});
  JSONObject saved=new JSONObject(new String(read(draft),StandardCharsets.UTF_8));verify(saved.toString().contains("intentional leave saves manual draft"),"intentional leave persists manual draft",checks,failures);
  JSONObject report=new JSONObject().put("checks",checks[0]).put("failures",new JSONArray(failures)).put("passed",failures.isEmpty()).put("ownedDirectory",dir.getName()).put("actualAndroidWidgets",true).put("integratedMainRoute",false);
  try(FileOutputStream out=new FileOutputStream(new File(t.activity.getExternalFilesDir(null),"f07-lifecycle-report.json"))){out.write(report.toString(2).getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
  t.check(failures.isEmpty(),report.toString());return report;
 }
 static void verify(boolean ok,String label,int[] count,List<String>fails){count[0]++;if(!ok)fails.add(label);}
 static byte[] read(File f)throws IOException{try(InputStream in=new FileInputStream(f);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
}
