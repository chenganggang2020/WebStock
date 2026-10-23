#pragma once
#include "local_candidate_store.hpp"
#include "window_local_candidate_background.hpp"
#include "industry_archive_store.hpp"
inline QJsonObject backupScopeSnapshot(const QString& businessPath,const localCandidate::Cancel& cancelled={}){
 auto check=[&]{watchlistWorkspace::need(!cancelled||!cancelled(),"备份范围读取已取消");};check();
 const auto directory=QFileInfo(businessPath).absolutePath();QJsonArray rows,errors,failed;
 try{for(auto value:localCandidate::Store(directory+"/local-candidates-v1.sqlite").list(cancelled)){auto row=value.toObject();row["scopeKind"]="candidate";rows.append(row);}}
 catch(const std::exception&e){check();failed.append("candidate");errors.append("候选列表未读取："+QString::fromUtf8(e.what()));}
 try{candidateBackgroundHost::Host host({businessPath,directory+"/recent-v1.sqlite",directory+"/sector-leaders-v1.sqlite",directory+"/local-candidate-background-v2.sqlite"});for(auto value:host.list(cancelled)){auto row=value.toObject();row["scopeKind"]="background";rows.append(row);}}
 catch(const std::exception&e){check();failed.append("background");errors.append("背景方案列表未读取："+QString::fromUtf8(e.what()));}
 try{for(auto value:industryArchive::Store(businessPath).backupChoices(cancelled)){auto row=value.toObject();row["scopeKind"]="industry";rows.append(row);}}
 catch(const std::exception&e){check();failed.append("industry");errors.append("完整产业档案列表未读取："+QString::fromUtf8(e.what()));}
 check();return {{"rows",rows},{"errors",errors},{"failedKinds",failed}};
}
