#pragma once
#include "creator_analysis.hpp"
#include <functional>
#include <algorithm>
namespace creatorIndex {
inline QJsonObject build(const QJsonArray& input,const QString& author = {}, const QString& topic = {},
                         const std::function<bool()>& cancelled = []{return false;}) {
  auto check=[&]{creatorAnalysis::require(!cancelled(),"汇总读取已取消");};check();
  QMap<QString,QJsonObject> authors;QMap<QString,QList<int>> works;
  QJsonArray documents,relations;QSet<QString> topics;QJsonObject counts;
  for(const auto& key:QStringList{"documents","works","superseded","analyzed","empty","pending","blocked","relations"})counts[key]=0;
  auto count=[&](const QString& key){counts[key]=counts[key].toInt()+1;};
  for(int i=0;i<input.size();++i){check();auto row=input[i].toObject(),identity=creatorAnalysis::identity(row);auto key=identity["authorKey"].toString();
    auto entry=authors.value(key,QJsonObject{{"authorKey",key},{"aliases",QJsonArray()},{"documents",0}});
    auto aliases=entry["aliases"].toArray();QString name=row["channel"].toString().trimmed();if(!name.isEmpty()&&!aliases.contains(name))aliases.append(name);
    if(!key.startsWith("document:"))for(auto v:row["creatorAnalyses"].toArray()){check();auto a=v.toObject();QString oldName=a["sourceSnapshot"].toObject()["channel"].toString().trimmed();if(a["sourceIdentity"].toObject()["authorKey"]==key&&!oldName.isEmpty()&&!aliases.contains(oldName))aliases.append(oldName);}
    entry["aliases"]=aliases;entry["documents"]=entry["documents"].toInt()+1;authors[key]=entry;
    if(author.isEmpty()||author==key)works[identity["workKey"].toString()].append(i);
  }
  // No arbitrary tie-break: missing/ambiguous revision dates block the whole work.
  QMap<int,QString> statuses;QMap<int,QString> reasons;
  for(auto work:works){check();count("works");qint64 newest=std::numeric_limits<qint64>::min();int winner=-1;bool ambiguous=false,tie=false;
    bool observed=false;for(int i:work)if(input[i].toObject().contains("sourceMetadata")||input[i].toObject().contains("sourceFingerprint"))observed=true;
    for(int i:work){check();auto row=input[i].toObject();QString root=row["sourceRootId"].toString();bool revision=!root.isEmpty()&&root!=row["id"].toString();auto date=QDateTime::fromString(row["sourceRevisionAt"].toString(),Qt::ISODateWithMs);
      if(observed){auto metadata=row["sourceMetadata"].toObject();auto clean=[](QString s){return s.replace(QRegularExpression("\\s+",QRegularExpression::UseUnicodePropertiesOption)," ").trimmed();};
        auto fingerprint=collectionQuality::bodyHash(clean(metadata["title"].toString())+"\n"+clean(metadata["description"].toString()));date=QDateTime::fromString(metadata["capturedAt"].toString(),Qt::ISODateWithMs);
        if(metadata["title"].toString().trimmed().isEmpty()||!metadata["description"].isString()||metadata["coverage"]!="visible_page_only"||row["sourceFingerprint"]!=fingerprint||!date.isValid())ambiguous=true;
      }else if(revision&&!date.isValid())ambiguous=true;
      qint64 at=(observed||revision)&&date.isValid()?date.toMSecsSinceEpoch():std::numeric_limits<qint64>::min();
      if(winner<0||at>newest){newest=at;winner=i;tie=false;}else if(at==newest)tie=true;
    }
    ambiguous|=tie;
    for(int i:work){statuses[i]=ambiguous?"blocked":i==winner?"current":"superseded";if(ambiguous)reasons[i]="来源捕获 / 修订时间或指纹缺失、冲突，未任选一版";}
  }
  for(int i=0;i<input.size();++i){check();if(!statuses.contains(i))continue;auto row=input[i].toObject(),identity=creatorAnalysis::identity(row);QString status=statuses[i],reason=reasons[i];QJsonObject analysis;
    count("documents");
    if(status=="current"){
      if(!creatorAnalysis::eligible(row)){status="blocked";reason="正文质检或原始证据不满足准入";}
      else if((analysis=creatorAnalysis::current(row)).isEmpty()){status="pending";reason="当前正文尚无合格分析";}
      else {
        try{creatorAnalysis::validate(analysis);}catch(const std::exception&){status="blocked";reason="分析快照校验未通过";}
        if(status=="current"&&(!analysis.contains("sourceIdentity")||!analysis.contains("sourceSnapshot"))){status="blocked";reason="旧分析缺少来源身份快照；仍可单篇查看";}
        if(status=="current"&&analysis["sourceIdentity"].toObject()!=identity){status="blocked";reason="来源身份已改变，不沿用旧归属";}
        // Display-name changes under a stable author ID are aliases, not new authors.
        auto snapshot=analysis["sourceSnapshot"].toObject(),now=creatorAnalysis::sourceSnapshot(row);
        if(status=="current"&&identity["authorKey"].toString().startsWith("document:")&&snapshot["channel"]!=now["channel"]){status="blocked";reason="未知身份的作者名称已改变，不沿用旧归属";}
        for(const auto& field:QStringList{"id","title","publishedAt","sourceUrl"})if(status=="current"&&snapshot[field]!=now[field]){status="blocked";reason="来源元数据已改变，请核对后记录新分析";}
        if(status=="current"){
          status="analyzed";auto edges=analysis["relations"].toArray();if(edges.isEmpty())count("empty");
          for(int n=0;n<edges.size();++n){check();auto edge=edges[n].toObject();topics.insert(edge["topic"].toString());if(!topic.isEmpty()&&edge["topic"]!=topic)continue;
            relations.append(QJsonObject{{"documentId",row["id"]},{"authorKey",identity["authorKey"]},{"workKey",identity["workKey"]},{"analysisId",analysis["id"]},{"bodyHash",analysis["bodyHash"]},{"sourceSnapshot",snapshot},{"edgeIndex",n},{"edge",edge}});
          }
          reason=edges.isEmpty()?"已分析，无明确关系":"作者观点，未外部核验";
        }
      }
    }
    count(status);documents.append(QJsonObject{{"id",row["id"]},{"authorKey",identity["authorKey"]},{"workKey",identity["workKey"]},{"title",row["title"]},{"channel",row["channel"]},{"status",status},{"reason",reason}});
  }
  QJsonArray authorList,topicList;for(auto a:authors)authorList.append(a);auto sorted=topics.values();std::sort(sorted.begin(),sorted.end());for(auto t:sorted)topicList.append(t);
  counts["relations"]=relations.size();return {{"authors",authorList},{"topics",topicList},{"documents",documents},{"relations",relations},{"counts",counts}};
}
}
