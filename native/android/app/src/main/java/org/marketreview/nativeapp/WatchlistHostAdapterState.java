package org.marketreview.nativeapp;
import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
final class WatchlistHostAdapterState {
 private final AtomicFile file;
 WatchlistHostAdapterState(Context c,boolean testing){file=new AtomicFile(new File(c.getFilesDir(),testing?"watchlist-host-ui-tests-v36.json":"watchlist-host-ui-v36.json"));}
 JSONObject read()throws Exception{if(!file.getBaseFile().exists()&&!new File(file.getBaseFile()+".bak").exists())return new JSONObject();byte[]bytes;try(InputStream in=file.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[]b=new byte[8192];int n;while((n=in.read(b))!=-1){need(out.size()+n<=32*1024*1024,"分组界面状态过大，未截断");out.write(b,0,n);}bytes=out.toByteArray();}JSONObject o=new JSONObject(new String(bytes,StandardCharsets.UTF_8));need(text(o,"schema").equals("watchlist-host-ui-file/v1")&&o.opt("state") instanceof JSONObject&&text(o,"sha256").equals(hash(o.get("state"))),"分组界面状态校验失败，未覆盖");return o.getJSONObject("state");}
 void save(JSONObject state)throws Exception{need(text(state,"schema").equals("watchlist-host-ui-state/v1"),"分组界面状态格式错误");JSONObject merged=copy(state),previous=read();java.util.Iterator<String>keys=previous.keys();while(keys.hasNext()){String k=keys.next();if(!merged.has(k))merged.put(k,previous.get(k));}byte[]bytes=object("schema","watchlist-host-ui-file/v1","state",merged,"sha256",hash(merged)).toString().getBytes(StandardCharsets.UTF_8);need(bytes.length<=32*1024*1024,"完整分组界面状态过大，未截断");FileOutputStream out=file.startWrite();try{out.write(bytes);file.finishWrite(out);}catch(Exception e){file.failWrite(out);throw e;}}
}
