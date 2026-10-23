package org.marketreview.nativeapp;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Read-only F06 archive consumer. No AtomicFile recovery, task start, or current-price substitution. */
final class ResearchModelSources {
 static final int MAX_ARCHIVES=50,MAX_CONTEXT=8*1024*1024;
 static byte[] readBounded(File file)throws Exception{
  QuantModelResult.need(!Files.isSymbolicLink(file.toPath())&&file.isFile(),"量化来源不是普通原文件");
  try(InputStream in=new FileInputStream(file);ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] chunk=new byte[8192];int n;while((n=in.read(chunk))!=-1){QuantModelResult.need(out.size()+n<=32*1024*1024,"量化原件超过32MiB，未裁剪");out.write(chunk,0,n);}return out.toByteArray();}
 }
 static JSONObject read(File quantStore)throws Exception{
  File directory=new File(quantStore+".model-results");List<File> files=new ArrayList<>();
  QuantModelResult.need(!Files.isSymbolicLink(directory.toPath()),"量化来源目录不能是链接");
  if(directory.exists()){
   QuantModelResult.need(directory.isDirectory(),"量化来源目录不可读");
   try(DirectoryStream<Path> entries=Files.newDirectoryStream(directory.toPath())){int count=0;for(Path entry:entries){QuantModelResult.need(++count<=4096,"量化目录超过4096项，请明确整理范围；未裁剪");String name=entry.getFileName().toString();QuantModelResult.need(!name.matches("native-[0-9a-f-]{36}\\.json\\.(bak|new)"),"量化原件存在未完成保存，不自动恢复或改写");if(name.matches("native-[0-9a-f-]{36}\\.json"))files.add(entry.toFile());}}
  }
  files.sort(Comparator.comparingLong(File::lastModified).reversed().thenComparing(File::getName));
  JSONArray quant=new JSONArray(),factors=new JSONArray(),sources=new JSONArray(),gaps=new JSONArray();
  JSONObject out=new JSONObject().put("quantEntries",quant).put("factorEntries",factors).put("nativeModelSources",sources).put("nativeModelGaps",gaps).put("nativeModelSelection",new JSONObject().put("archiveCount",files.size()).put("selectedCount",Math.min(files.size(),MAX_ARCHIVES)).put("omittedCount",Math.max(0,files.size()-MAX_ARCHIVES)).put("order","archive-file-modified-desc; identity-asc-tie").put("limit",MAX_ARCHIVES));
  for(File file:files.subList(0,Math.min(files.size(),MAX_ARCHIVES))){
   byte[] bytes=readBounded(file);String raw=new String(bytes,StandardCharsets.UTF_8);QuantModelResult.need(Arrays.equals(bytes,raw.getBytes(StandardCharsets.UTF_8)),"量化原件UTF8损坏");JSONObject receipt=QuantModelResult.verify(raw);String id=receipt.getString("id");QuantModelResult.need(file.getName().equals(id+".json"),"量化文件身份与完整回执不一致");
   String sha=QuantModelResult.hash(bytes);JSONObject summary=QuantModelResult.summary(receipt);summary.remove("androidExecution");sources.put(new JSONObject().put("id",id).put("bundleSha256",sha).put("verifiedSummary",summary));
   for(int i=0;i<receipt.getJSONArray("steps").length();i++){JSONObject step=receipt.getJSONArray("steps").getJSONObject(i);String kind=step.getJSONObject("step").getString("kind");JSONObject entry=new JSONObject().put("valid",true).put("result",step.getJSONObject("result")).put("nativeBundleId",id).put("nativeBundleSha256",sha);if(kind.equals("lightgbm")||kind.equals("master"))quant.put(entry);else if(kind.equals("factor"))factors.put(entry);}
   QuantModelResult.need(out.toString().getBytes(StandardCharsets.UTF_8).length<=MAX_CONTEXT,"完整量化上下文超过8MiB，整份拒绝，未裁剪结果");
   QuantModelResult.need(sha.equals(QuantModelResult.hash(readBounded(file)))&&!new File(file+".bak").exists()&&!new File(file+".new").exists(),"量化原件在核验中变化，请重新预览");
  }
  gaps.put("仅纳入逐份通过F06完整附件校验的模型/因子；策略/信号不冒充训练模型。历史原时点保留，不代表真实行情预测精度。");
  if(files.size()>MAX_ARCHIVES)gaps.put("明确仅选最近50份原档；遗漏"+(files.size()-MAX_ARCHIVES)+"份，不代表全仓结果。");
  if(quant.length()==0)gaps.put("所选原档没有已核验训练模型结果，不补零分。");
  QuantModelResult.need(out.toString().getBytes(StandardCharsets.UTF_8).length<=MAX_CONTEXT,"完整量化上下文超过8MiB，整份拒绝，未裁剪结果");return out;
 }
}
