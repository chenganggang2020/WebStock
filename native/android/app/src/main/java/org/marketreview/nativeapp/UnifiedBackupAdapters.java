package org.marketreview.nativeapp;
import org.json.*;
import java.util.*;
import java.nio.charset.StandardCharsets;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;
public final class UnifiedBackupAdapters {
 public interface Rows {JSONArray get()throws Exception;}
 public interface ById {JSONObject get(String id)throws Exception;}
 static void allowed(JSONObject o,String...names)throws Exception{Set<String>set=new HashSet<>(Arrays.asList(names));Iterator<String>it=o.keys();while(it.hasNext())need(set.contains(it.next()),"未知字段需先明确非敏感归档契约；整域未导出");}
 static JSONObject state(JSONObject p)throws Exception{return state(p,hash(p));}
 static JSONObject state(JSONObject p,String baseline)throws Exception{return copy(object("payload",p,"baseline",baseline));}
 public static Adapter groups(Read read,Commit save){
  Adapter a=new Adapter("watchlist-config","自选分组配置","watchlist-workspace-backup/v1","完整分组配置；主自选身份仅核对，行情与目录不导入","需接入完整当前数据及保存时版本核对");
  if(read!=null)a.capture=()->{JSONObject s=read.get();return state(WatchlistBackupModel.exportBackup(s),hash(management(s)));};
  if(read!=null&&save!=null){
   Preview preview=(p,before)->{JSONObject now=read.get();need(equal(hash(management(now)),before.get("baseline")),"分组开始/当前基线变化");JSONObject owner=WatchlistBackupModel.previewImport(p,now,now);return object("owner",owner,"expected",before.get("baseline"),"noChange",owner.getJSONObject("change").get("noChange"));};
   a.preview=preview;
   a.commit=p->{JSONObject now=read.get(),before=state(WatchlistBackupModel.exportBackup(now),hash(management(now)));need(equal(preview.run(p.getJSONObject("owner").getJSONObject("backup"),before),p),"分组确认时基线/预览变化");JSONObject draft=WatchlistBackupModel.importDraft(now,p.getJSONObject("owner"),now),saved=receipt(now,draft,save.run(copy(p.getJSONObject("owner").getJSONObject("change"))));return object("revision",saved.get("revision"),"groupsHash",hash(saved.get("groups")),"mainIdsHash",hash(saved.get("mainIds")));};
   a.matches=(p,s)->{JSONObject c=s.getJSONObject("payload").getJSONObject("config"),t=p.getJSONObject("owner").getJSONObject("change");return equal(c.get("groups"),t.get("groups"))&&equal(c.get("mainIds"),t.get("mainIds"));};
   a.verify=(p,r,s)->{JSONObject c=s.getJSONObject("payload").getJSONObject("config");return equal(r.get("revision"),c.get("revision"))&&r.getString("groupsHash").equals(hash(c.get("groups")))&&r.getString("mainIdsHash").equals(hash(c.get("mainIds")));};
   a.reason="条件恢复：主自选和只读来源必须相符；保留原生限制";
  }return a;
 }
 static void leaderConfig(JSONObject c)throws Exception{
  SectorLeaderModel.validate(c);WatchlistBackupModel.keys(c,"schema","revision","updatedAt","sectors");need(c.isNull("updatedAt")||c.opt("updatedAt") instanceof String,"人工配置更新时间无效");if(c.opt("updatedAt") instanceof String)time(c.getString("updatedAt"));JSONArray boards=c.getJSONArray("sectors");for(int i=0;i<boards.length();i++){JSONObject b=boards.getJSONObject(i);allowed(b,"id","name","description","sortOrder","leaders");JSONArray rs=b.getJSONArray("leaders");for(int j=0;j<rs.length();j++)allowed(rs.getJSONObject(j),"id","sectorId","code","name","fullId","identityState","role","reason","weight","note");}sensitive(c,0);
 }
 public static Adapter leaders(Read read,Commit confirm){
  Adapter a=new Adapter("manual-leader-config","人工龙头配置（合并）",SectorLeaderModel.SCHEMA,"人工板块/候选配置；合并新增，同项保留当前；不含观察历史","需接入配置读取及原有的确认合并入口");a.limit=2*1024*1024;
  if(read!=null)a.capture=()->{JSONObject c=read.get();leaderConfig(c);return state(c);};
  if(read!=null&&confirm!=null){
   Preview preview=(payload,before)->{leaderConfig(payload);JSONObject current=read.get();leaderConfig(current);need(hash(current).equals(before.getString("baseline")),"人工配置基线变化");JSONObject owner=SectorLeaderModel.preview(payload.toString().getBytes(StandardCharsets.UTF_8),current);return copy(object("incoming",payload,"owner",owner,"expected",before.get("baseline"),"noChange",equal(owner.getJSONObject("config").get("sectors"),current.get("sectors"))));};
   a.preview=preview;
   a.commit=p->{JSONObject current=read.get();need(equal(preview.run(p.getJSONObject("incoming"),state(current)),p),"人工配置确认时基线/预览变化");JSONObject owner=p.getJSONObject("owner"),saved=confirm.run(copy(owner));leaderConfig(saved);need(saved.getDouble("revision")==current.getDouble("revision")+1&&equal(saved.get("sectors"),owner.getJSONObject("config").get("sectors")),"原生合并回执未确认；可能已导入或标记冲突，禁止重试");return object("revision",saved.get("revision"),"sectorsHash",hash(saved.get("sectors")),"digest",owner.get("digest"));};
   a.matches=(p,s)->equal(p.getJSONObject("owner").getJSONObject("config").get("sectors"),s.getJSONObject("payload").get("sectors"));
   a.verify=(p,r,s)->{JSONObject c=s.getJSONObject("payload");return equal(r.get("revision"),c.get("revision"))&&r.getString("sectorsHash").equals(hash(c.get("sectors")))&&equal(r.get("digest"),p.getJSONObject("owner").get("digest"));};
   a.reason="只合并新增；冲突保留当前；既有导入标记可能阻止重新合并，失败明确报告";
  }return a;
 }
 public static Adapter recent(Rows read){
  Adapter a=new Adapter("recent-entries","最近查看条目（仅归档）","native-recent-entries-archive/v1","全部原生最近查看条目；不含导入标记；仅归档不可恢复","缺保留原身份、时点和来源的恢复入口，以及保存时版本核对、预览和回执");
  if(read!=null)a.capture=()->{JSONArray rows=read.get();need(rows.length()<=10000,"最近查看超过10000，未截断");Set<String>seen=new HashSet<>();for(int i=0;i<rows.length();i++){JSONObject r=rows.getJSONObject(i);allowed(r,"id","guessedId","code","name","symbol","lastViewedAt","createdAt","viewCount","quote","origin","canOpen","identityNote");String id=text(r,"id");need(!id.isEmpty()&&seen.add(id),"最近查看身份缺失或重复");for(String k:new String[]{"code","name","symbol","origin","lastViewedAt","createdAt"})text(r,k);time(text(r,"lastViewedAt"));time(text(r,"createdAt"));Object count=r.opt("viewCount");need(r.opt("canOpen") instanceof Boolean&&count instanceof Number&&((Number)count).doubleValue()>=1&&((Number)count).doubleValue()<=2147483647&&((Number)count).doubleValue()==((Number)count).longValue(),"最近查看字段无效");allowed(r.getJSONObject("quote"),"price","changePercent","tradeDate","tradeTime","checkedAt","source","cached","error");}return state(object("schema","native-recent-entries-archive/v1","entries",rows));};
  return a;
 }
 public static Adapter recentRestore(Read read,Preview preview,Commit commit,Verify verify){
  Adapter a=new Adapter("recent-entries","最近查看条目（保留原字段合并）",RecentRestore.ARCHIVE,RecentRestore.SCOPE,"只插入缺失原ID，同项冲突保留当前；确认时核对完整基线并保存独立回执");
  a.sourceScopeAliases.add(RecentRestore.LEGACY_SCOPE);a.capture=read;a.preview=preview;a.commit=commit;a.matches=RecentRestore::matches;a.verify=verify;return a;
 }
 public static Adapter candidates(JSONArray input,ById read)throws Exception{
  final JSONArray selected=input==null?new JSONArray():new JSONArray(input.toString());Adapter a=new Adapter("candidate-selection","已选冻结候选结果（仅归档）",LocalCandidateModel.VERSION,"仅明确选择的冻结结果ID；不含草稿/导出槽；仅归档不可恢复","缺保留原结果身份的导入、预览、版本核对及可防止重复导入的回执");
  if(read!=null&&selected.length()>0)a.capture=()->{need(selected.length()<=100,"冻结结果最多100个明确ID");Set<String>seen=new HashSet<>();JSONArray rows=new JSONArray();for(int i=0;i<selected.length();i++){need(selected.get(i) instanceof String&&!selected.getString(i).isEmpty()&&seen.add(selected.getString(i)),"冻结结果身份缺失/重复");JSONObject r=read.get(selected.getString(i));WatchlistBackupModel.keys(r,"id","title","savedAt","result");need(equal(r.get("id"),selected.get(i))&&!text(r,"title").trim().isEmpty(),"冻结结果读取不完整");time(text(r,"savedAt"));LocalCandidateModel.verify(r.getJSONObject("result"));rows.put(r);}return state(object("schema","native-candidate-selection-archive/v1","selectedIds",selected,"records",rows));};
  return a;
 }
 public static Adapter business(){return new Adapter("business-seven","业务七类（未开放）","native-business-v1","账户、交易、资料、报告、主题、关系、采集","原始字段尚未确认可安全备份；关联记录预览、保存时版本核对和提交回执仍缺失；导出与恢复均禁用");}
 public static Adapter business(Read read,Preview preview,Commit commit,Verify verify){
  Adapter a=new Adapter("business-seven","本机业务七类（保留完整原记录）",BusinessRestore.ARCHIVE,BusinessRestore.SCOPE,"只插入缺失原ID；冲突/人工历史保留本机，显式关联须闭合；活动任务/媒体/凭据或未审阅字段整域拒绝");
  a.capture=read;a.preview=preview;a.commit=commit;a.verify=verify;a.matches=BusinessRestore::matches;return a;
 }
 public static Adapter observations(){return observations(null,null,null,null);}
 public static Adapter observations(Read read,Preview preview,Commit commit,Verify verify){Adapter a=new Adapter("manual-leader-observations","人工龙头观察历史（原版本合并）",SectorObservationRestore.ARCHIVE,SectorObservationRestore.SCOPE,"含原配置合并；仅新增原观察ID，确认时完整CAS，原版本与回执同库事务保留");a.capture=read;a.preview=preview;a.commit=commit;a.matches=SectorObservationRestore::matches;a.verify=verify;return a;}
}
