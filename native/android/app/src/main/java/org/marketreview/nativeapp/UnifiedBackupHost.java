package org.marketreview.nativeapp;
import android.os.Build;
import org.json.*;
import java.io.*;
import java.util.*;
import static org.marketreview.nativeapp.UnifiedBackup.*;
import static org.marketreview.nativeapp.WatchlistWorkspaceModel.*;

/** One root-owned lane shared with authoritative roster and group writers. */
public final class UnifiedBackupHost {
 public static final class Paths {
  public final File groups,leaders,recent,candidates,receipts,background,business;
  public Paths(File groups,File leaders,File recent,File candidates,File receipts){this(groups,leaders,recent,candidates,receipts,new File(candidates.getAbsoluteFile().getParentFile(),"local-candidate-background-v2.sqlite"));}
  public Paths(File groups,File leaders,File recent,File candidates,File receipts,File background){this(groups,leaders,recent,candidates,receipts,background,null);}
  public Paths(File groups,File leaders,File recent,File candidates,File receipts,File background,File business){this.groups=groups;this.leaders=leaders;this.recent=recent;this.candidates=candidates;this.receipts=receipts;this.background=background;this.business=business;}
 }
 public interface SaveGroups {JSONObject run(JSONObject change,JSONObject freshInputs)throws Exception;}
 final Paths paths;final String producer;final List<Adapter> adapters;final UnifiedBackupFiles.FileJournal journal;
 public final Coordinator coordinator;
 public UnifiedBackupHost(Paths paths,String producer,Read freshInputs,SaveGroups saveGroups,JSONArray selectedCandidates)throws Exception{this(paths,producer,freshInputs,saveGroups,selectedCandidates,new JSONArray());}
 public UnifiedBackupHost(Paths paths,String producer,Read freshInputs,SaveGroups saveGroups,JSONArray selectedCandidates,JSONArray selectedBackground)throws Exception{this(paths,producer,freshInputs,saveGroups,selectedCandidates,selectedBackground,Collections.emptyList());}
 public UnifiedBackupHost(Paths paths,String producer,Read freshInputs,SaveGroups saveGroups,JSONArray selectedCandidates,JSONArray selectedBackground,List<String> selectedIndustry)throws Exception{
  this.paths=paths;this.producer=producer;
  Read read=freshInputs==null?null:()->WatchlistWorkspaceStore.readExisting(paths.groups,freshInputs.get()).getJSONObject("snapshot");
  Commit save=freshInputs==null||saveGroups==null?null:p->saveGroups.run(p,freshInputs.get());
  Adapter group=Build.VERSION.SDK_INT>=35?UnifiedBackupAdapters.groups(read,save):UnifiedBackupAdapters.groups(null,null);
  if(Build.VERSION.SDK_INT<35)group.reason="当前 Android API "+Build.VERSION.SDK_INT+"：分组多次读取的一致快照需要 API 35+；本域导出与恢复均禁用，原文件保留";
  SectorLeaderStore leaders=new SectorLeaderStore(paths.leaders);RecentStore recent=new RecentStore(paths.recent);LocalCandidateStore candidates=new LocalCandidateStore(paths.candidates);
  Adapter frozen=UnifiedBackupAdapters.candidates(new JSONArray(selectedCandidates.toString()),id->{JSONObject row=candidates.read(id);need("native-local-candidates/v1".equals(row.getJSONObject("result").optString("model")),"候选结果版本含未审阅的背景字段；本轮仅归档v1，整域未导出");return row;});
  Adapter backgrounds=new Adapter("candidate-background","已选命名背景方案",HostCandidateBackground.SCHEMA,CandidateRestore.scope(true),"需要API 35+完整只读事务，未接触背景库");
  if(Build.VERSION.SDK_INT>=35){frozen=CandidateRestoreStore.adapter(paths.candidates,false,selectedCandidates);backgrounds=CandidateRestoreStore.adapter(paths.background,true,selectedBackground);}
  else frozen.reason="当前Android保留v1仅归档；完整候选恢复需要API 35+正式只读事务，未接触恢复库";
  Adapter recentDomain=Build.VERSION.SDK_INT>=35?UnifiedBackupAdapters.recentRestore(recent::restoreSnapshot,recent::previewRestore,p->recent.commitRestore(p),recent::verifyRestore):UnifiedBackupAdapters.recent(()->recent.list("","last_viewed",10000));
  if(Build.VERSION.SDK_INT<35)recentDomain.reason="当前 Android API "+Build.VERSION.SDK_INT+"：保留原字段恢复需要 API 35+ 的真正只读事务；恢复未接触数据库文件，旧归档入口保留";
  Adapter industry=new Adapter(IndustryArchiveState.DOMAIN,"完整旧产业报告、配置与运行原件",IndustryReportArchive.SCHEMA,IndustryArchiveState.SCOPE,"完整恢复需要原业务库路径和API 35+真正只读事务，未接触数据库");
  if(paths.business!=null&&Build.VERSION.SDK_INT>=35)industry=IndustryArchiveStore.adapter(paths.business,selectedIndustry);
  Adapter businessDomain=UnifiedBackupAdapters.business();
  if(paths.business!=null&&Build.VERSION.SDK_INT>=35){BusinessRestoreStore business=new BusinessRestoreStore(paths.business);businessDomain=UnifiedBackupAdapters.business(business::capture,(input,before)->{JSONObject p=business.preview(input,before);need(p.getJSONArray("issues").length()==0,BusinessRestore.describePreview(p));return p;},business::commit,business::verify);}
  else if(Build.VERSION.SDK_INT<35)businessDomain.reason="当前 Android API "+Build.VERSION.SDK_INT+"：业务七类需 API35+ 真只读事务；导出与恢复均禁用，未打开业务文件";
  Adapter observations=Build.VERSION.SDK_INT>=35?UnifiedBackupAdapters.observations(()->leaders.restoreSnapshot(null),(p,before)->leaders.previewRestore(p,before,null),p->leaders.commitRestore(p,null),(p,r,after)->leaders.verifyRestore(p,r,after,null)):UnifiedBackupAdapters.observations();
  if(Build.VERSION.SDK_INT<35)observations.reason="当前 Android API "+Build.VERSION.SDK_INT+"：原版本观察恢复需要 API 35+ 真正只读事务；本域未接触数据库文件";
  adapters=Arrays.asList(group,UnifiedBackupAdapters.leaders(()->leaders.read(null),p->leaders.importPreview(p,null)),
    recentDomain,frozen,backgrounds,industry,
    businessDomain,observations);
  journal=new UnifiedBackupFiles.FileJournal(UnifiedBackupFiles.newReceipt(paths.receipts));
  coordinator=new Coordinator(producer,adapters,journal.callbacks());
 }
 public File receiptFile(){return journal.file;}
 public byte[] readImport(UnifiedBackupFiles.Source source)throws Exception{
  byte[] bytes=UnifiedBackupFiles.read(source,BUNDLE_LIMIT);String raw=new String(bytes,java.nio.charset.StandardCharsets.UTF_8);need(Arrays.equals(bytes,raw.getBytes(java.nio.charset.StandardCharsets.UTF_8)),"备份UTF8损坏");new WatchlistBackupModel.JsonGate(raw).run();JSONObject object=new JSONObject(raw);
  if("native-unified-backup/v1".equals(object.optString("schema"))){decode(bytes);return bytes;}
  JSONObject payload=IndustryArchiveState.payload(raw),e=entry(IndustryArchiveState.DOMAIN,IndustryReportArchive.SCHEMA,IndustryArchiveState.SCOPE,payload,8*1024*1024);
  return encode(seal(WatchlistWorkspaceModel.object("schema","native-unified-backup/v1","producerVersion","legacy-industry-research","createdAt",java.time.Instant.now().toString(),"selectedDomainIds",new JSONArray().put(IndustryArchiveState.DOMAIN),"entries",new JSONArray().put(e))));
 }
 public JSONObject exportPreview(byte[] bytes)throws Exception{return UnifiedBackupFiles.summary(bytes);}
 public void saveExportNew(UnifiedBackupFiles.NewTarget target,byte[] bytes)throws Exception{UnifiedBackupFiles.exportNewVerified(target,bytes);}
 public JSONObject inspectReceipt(File file)throws Exception{
  File owned=UnifiedBackupFiles.inspectedReceipt(paths.receipts,file);
  Coordinator reader=new Coordinator(producer,adapters,new Journal(v->{need(false,"历史回执只读，禁止继续执行");},()->decodeReceipt(UnifiedBackupFiles.read(UnifiedBackupFiles.localSource(owned),JOURNAL_LIMIT))));
  return reader.rereadReceipt();
 }
}
