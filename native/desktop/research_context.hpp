#pragma once
#include "research_companies.hpp"
#include <stdexcept>
// Read-only host projection. Original documents/verification and source clocks stay intact.
namespace researchContext {
inline QJsonObject snapshot(const QString& id,const QJsonArray& roster,
                            const QJsonArray& documents,const QJsonArray& relations) {
 QJsonObject result;int matches=0;
 for(auto value:roster)if(value.toObject()["id"].toString()==id){result=value.toObject();++matches;}
 if(matches!=1)throw std::runtime_error("本机完整证券身份缺失或重复，未按名称/裸代码匹配");
 QHash<QString,QJsonObject> byDoc;QHash<QString,QString> texts;
 for(auto value:documents){auto doc=value.toObject();const auto key=doc["id"].toString();
  if(key.isEmpty()||byDoc.contains(key))throw std::runtime_error("研究原文身份缺失或重复，停止关联");
  byDoc[key]=doc;texts[key]=doc["text"].toString();}
 QJsonArray selected,bindings,warnings;QSet<QString> included;
 for(auto value:relations){auto relation=value.toObject();auto company=relation["company"].toObject();
  if(company["instrumentId"].toString()!=id)continue;
  try {
   researchCompanies::validateReferences(relation,texts);
   auto docId=relation["documentId"].toString(),quote=relation["quote"].toString();
   researchCompanies::require(byDoc.contains(docId)&&!quote.isEmpty()&&texts[docId].contains(quote),
      "关联引文缺失或原文已变，未自动绑定");
   bindings.append(relation);
   for(auto key:{company["identityDocumentId"].toString(),docId})
    if(!included.contains(key)){selected.append(byDoc[key]);included.insert(key);}
  }catch(const std::exception& e){warnings.append(QJsonObject{{"relationId",relation["id"]},{"reason",QString::fromUtf8(e.what())}});}
 }
 result["documents"]=selected;result["researchBindings"]=bindings;result["bindingWarnings"]=warnings;
 return result;
}
}
