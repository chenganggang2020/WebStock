#pragma once
#include "industry_archive_state.hpp"
namespace industryArchive {
inline QString describeOperationRow(QJsonObject row){
 auto p=row["preview"].toObject();if(row["id"]!=domain||p["schema"]!="native-industry-restore-preview/v1")return {};
 unifiedBackup::sealed(p);auto input=archivePayload(p["incoming"].toObject());QString out="\n完整旧产业原件：只补入缺失原ID，已有人工内容保留；历史任务保持停用。\n原件身份："+p["sourceKey"].toString()+"\n";
 for(auto value:p["actions"].toArray()){auto a=value.toObject();out+="处理 "+a["status"].toString()+" · "+a["kind"].toString()+" / 原ID "+a["id"].toString()+"\n";}
 out+="\n完整主题、证据、版本与运行原件：\n"+input["source"].toString()+"\n";
 auto receipt=row["receipt"].toObject();if(!receipt.isEmpty()){archiveReceipt(receipt,p["sourceKey"].toString());out+="\n产业原件回执："+receipt["sourceKey"].toString()+"\n真实提交时刻："+receipt["committedAt"].toString()+"\n历史执行未恢复；旧 verified 仍需当前复核。\n";}
 return out;
}
}
