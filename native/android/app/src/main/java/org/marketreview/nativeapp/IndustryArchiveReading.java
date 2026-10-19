package org.marketreview.nativeapp;
import org.json.*;
final class IndustryArchiveReading {
 static String describeOperationRow(JSONObject row)throws Exception{
  JSONObject p=row.optJSONObject("preview");if(!IndustryArchiveState.DOMAIN.equals(row.optString("id"))||p==null||!"native-industry-restore-preview/v1".equals(p.optString("schema")))return "";
  UnifiedBackup.sealed(p);JSONObject input=IndustryArchiveState.payload(p.getJSONObject("incoming"));StringBuilder out=new StringBuilder("\n完整旧产业原件：只补入缺失原ID，已有人工内容保留；历史任务保持停用。\n原件身份：").append(p.getString("sourceKey")).append("\n");
  JSONArray actions=p.getJSONArray("actions");for(int i=0;i<actions.length();i++){JSONObject a=actions.getJSONObject(i);out.append("处理 ").append(a.getString("status")).append(" · ").append(a.getString("kind")).append(" / 原ID ").append(a.getString("id")).append("\n");}
  out.append("\n完整主题、证据、版本与运行原件：\n").append(input.getString("source")).append("\n");JSONObject receipt=row.optJSONObject("receipt");if(receipt!=null){IndustryArchiveState.receipt(receipt,p.getString("sourceKey"));out.append("\n产业原件回执：").append(receipt.getString("sourceKey")).append("\n真实提交时刻：").append(receipt.getString("committedAt")).append("\n历史执行未恢复；旧 verified 仍需当前复核。\n");}return out.toString();
 }
}
