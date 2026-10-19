#include "business_search_model.hpp"
#include "stock_profile.hpp"
#include <QHash>
#include <algorithm>
namespace businessSearch {
using stockResearch::need;
static QJsonObject payload(QJsonObject row){
 auto raw=row.value("legacy").toObject().value("payload_json");need(raw.isString(),"旧主营原payload必须为字符串，未补造资料");
 QJsonParseError error;auto doc=QJsonDocument::fromJson(raw.toString().toUtf8(),&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"旧主营payload不可解释，原文保留");return doc.object();
}
void validateLegacy(QString id,QJsonObject excerpt){
 stockResearch::identity(id);need(excerpt.keys()==QStringList{"id","row","schema"}&&excerpt.value("schema")==legacySchema&&excerpt.value("id")==id,"旧摘录版本或完整身份不符");
 auto row=excerpt.value("row").toObject(),legacy=row.value("legacy").toObject();
 need(row.value("id")==id&&row.value("canOpen")==true,"旧摘录身份尚不可核，未联动其他证券");
 need(legacy.keys()==QStringList{"code","fetched_at","payload_json","source","updated_at"},"旧摘录原字段变化");
 for(auto key:{"code","source","fetched_at","updated_at"})need(legacy.value(key).isString()||legacy.value(key).isNull(),"旧摘录原字段类型变化");
 need(stockResearch::bytes(excerpt).size()<=8*stockProfile::limit,"旧摘录超过8MiB，未截断");
 auto p=payload(row);need(p.value("code")==legacy.value("code")&&row.value("code")==legacy.value("code"),"旧摘录原code不一致，未联动其他证券");
 if(QRegularExpression("^[0-9]{6}$").match(legacy.value("code").toString()).hasMatch())need(id.section(':',2,2)==legacy.value("code").toString(),"旧摘录代码与完整证券身份不符");
}
QJsonObject legacyProfile(QString id,QJsonObject row){QJsonObject p{{"schema",legacySchema},{"id",id},{"row",row}};validateLegacy(id,p);return p;}
QString legacyOverview(QJsonObject excerpt){
 validateLegacy(excerpt.value("id").toString(),excerpt);auto row=excerpt.value("row").toObject(),legacy=row.value("legacy").toObject(),p=payload(row);
 QString out=legacyLabel+"\n完整证券身份："+excerpt.value("id").toString()+"\n来源："+stockResearch::display(legacy.value("source"))+"\n原payload取得时刻："+stockResearch::display(p.value("fetchedAt"))+"\n旧库取得时刻："+stockResearch::display(legacy.value("fetched_at"))+"\n旧库更新时刻："+stockResearch::display(legacy.value("updated_at"))+"\n\n";
 for(auto pair:{std::pair<const char*,const char*>{"name","证券简称"},{"companyName","公司"},{"industry","行业"},{"csrcIndustry","证监行业"},{"businessSummary","经营回顾摘录"},{"businessScope","经营范围摘录"}})out+=QString::fromUtf8(pair.second)+"："+stockResearch::display(p.value(pair.first))+"\n";
 out+="主营组成（旧来源报告日）：\n";auto items=p.value("mainBusinessItems").toArray();if(items.isEmpty())out+="未提供\n";
 for(auto v:items){auto item=v.toObject();out+=stockResearch::display(item.value("name"))+" · 占比："+stockResearch::display(item.value("ratio"))+" · 报告日："+stockResearch::display(item.value("reportDate"))+"\n";}
 out+="板块："+QString::fromUtf8(QJsonDocument(p.value("boards").toArray()).toJson())+"\n标签："+QString::fromUtf8(QJsonDocument(p.value("tags").toArray()).toJson())+"\n\n这是旧版整理、截取后的资料；未保存三个F10原响应。原payload可切换完整阅读，原时刻不补今日。";return out;
}
QString legacyOriginal(QJsonObject excerpt){validateLegacy(excerpt.value("id").toString(),excerpt);auto row=excerpt.value("row").toObject(),legacy=row.value("legacy").toObject();return legacyLabel+"\n完整证券身份："+excerpt.value("id").toString()+"\n旧库原字段与时点：\n"+stockResearch::pretty(legacy)+"\n以下保留原payload字符串（不重排键、不改空白）：\n"+legacy.value("payload_json").toString();}
static QString compact(QString value){return value.remove(QRegularExpression("\\s+")).toLower();}
static QString itemText(QJsonValue value){QStringList out;for(auto v:value.toArray()){auto item=v.toObject();auto name=item.value("name").toString();if(name.isEmpty())continue;if(!item.value("ratio").isNull()&&!item.value("ratio").isUndefined())name+=" "+stockResearch::display(item.value("ratio"))+"%";out.append(name);}return out.join(' ');}
static QString texts(QJsonValue value){if(value.isArray()){QStringList out;for(auto v:value.toArray())if(v.isString())out.append(v.toString());return out.join(' ');}return value.toString();}
static bool present(QJsonValue value){return value.isArray()?!value.toArray().isEmpty():value.isString()&&!value.toString().trimmed().isEmpty();}
static bool fuzzy(QString q,QString target){q=compact(q);target=compact(target);if(q.isEmpty()||target.contains(q))return true;int n=0;for(auto c:target)if(n<q.size()&&c==q[n])++n;return n==q.size();}
static QJsonValue parseItems(QJsonValue raw){if(!raw.isString())return QJsonArray{};auto doc=QJsonDocument::fromJson(raw.toString().toUtf8());return doc.isArray()?QJsonValue(doc.array()):QJsonValue(QJsonArray{});}
static QJsonObject clock(QJsonObject old,QString origin,QJsonValue fetched=QJsonValue::Null){return {{"origin",origin},{"source",old.value("source")},{"fetchedAt",fetched},{"updatedAt",old.contains("updated_at")?old.value("updated_at"):QJsonValue(QJsonValue::Null)}};}
static const QStringList fields{"name","industry","csrcIndustry","boards","mainBusinessItems","businessScope","businessSummary","tags"};
static bool newer(QString at,QJsonValue before){auto old=QDateTime::fromString(before.toString(),Qt::ISODateWithMs),next=QDateTime::fromString(at,Qt::ISODateWithMs);return old.isValid()&&next.isValid()&&next>=old;}
static QJsonObject nativeSource(QJsonObject packet,QString field){
 auto parts=packet.value("sources").toObject();QString kind=(field=="boards")?"CoreConception":(field=="name"||field=="industry"||field=="csrcIndustry")?"CompanySurvey":"BusinessAnalysis";
 if(field=="businessSummary"){
  auto business=parts.value("BusinessAnalysis").toObject().value("data").toObject();
  if(stockProfile::text(stockProfile::first(business,"jyps"),"BUSINESS_REVIEW").isNull()&&stockProfile::text(stockProfile::first(business,"zyfw"),"BUSINESS_SCOPE").isNull())kind="CoreConception";
 }
 auto result=parts.value(kind).toObject();result["kind"]=kind;
 if(field=="tags"){
  QJsonArray contributors;QJsonObject newest;for(auto k:stockProfile::kinds){auto source=parts.value(k).toObject();if(source.value("data").isNull())continue;contributors.append(source);if(newest.isEmpty()||stockProfile::stamp(source.value("fetchedAt").toString())>stockProfile::stamp(newest.value("fetchedAt").toString()))newest=source;}
  result=newest;result["kind"]="combined-tags";result["contributors"]=contributors;
 }
 return result;
}
QJsonArray catalog(QJsonArray directory,QJsonArray profiles,std::function<QJsonObject(QString)> cached){
 QHash<QString,QJsonObject> byId,rejectedByCode;QSet<QString> duplicateCodes;
 for(auto v:profiles){need(v.isObject(),"旧主营行不是对象");auto row=v.toObject();auto id=row.value("id").toString();need(!id.isEmpty()&&!byId.contains(id),"旧主营完整身份重复或缺失，未自动合并");byId.insert(id,row);if(!row.value("canOpen").toBool()){auto code=row.value("legacy").toObject().value("code").toString();if(rejectedByCode.contains(code))duplicateCodes.insert(code);else rejectedByCode.insert(code,row);}}
 QSet<QString> seen,consumedProfiles;QJsonArray out;
 for(auto v:directory){need(v.isObject(),"旧索引行不是对象");auto row=v.toObject();auto id=row.value("id").toString();need(!id.isEmpty()&&!seen.contains(id),"旧索引完整身份重复或缺失，未自动合并");seen.insert(id);
  if(row.value("canOpen").toBool())stockResearch::identity(id);
  auto old=row.value("legacy").toObject();QJsonObject values{{"code",row.value("code")},{"name",row.value("name")},{"industry",old.value("industry")},{"csrcIndustry",QJsonValue::Null},{"boards",old.value("boards_text")},{"mainBusinessItems",parseItems(old.value("main_business_json"))},{"businessScope",old.value("business_scope")},{"businessSummary",old.value("business_summary")},{"tags",old.value("tags_text")}};
  QJsonObject sources;for(auto field:fields)sources[field]=clock(old,"legacy-search-index");sources["code"]=clock(old,"legacy-search-index");
  auto profile=byId.value(id);
  // The old tables share an exact source key. This join only exposes rejected text;
  // it never promotes a bare code to a native identity or enables an action.
  auto sourceCode=old.value("code").toString();if(profile.isEmpty()&&!row.value("canOpen").toBool()&&!duplicateCodes.contains(sourceCode))profile=rejectedByCode.value(sourceCode);
  if(!profile.isEmpty()){
   consumedProfiles.insert(profile.value("id").toString());
   try{auto data=payload(profile);bool verified=row.value("canOpen").toBool()&&profile.value("canOpen").toBool();if(verified)row["legacyProfile"]=legacyProfile(id,profile);else row["rejectedProfile"]=profile;
    for(auto field:fields)if(present(data.value(field))){values[field]=data.value(field);sources[field]=clock(profile.value("legacy").toObject(),verified?"legacy-company-excerpt":"legacy-company-excerpt-identity-unverified",data.contains("fetchedAt")?data.value("fetchedAt"):QJsonValue(QJsonValue::Null));}
   }catch(const std::exception& e){row["legacyProfileError"]=QString::fromUtf8(e.what());row["rejectedProfile"]=profile;}
  }
  if(cached&&row.value("canOpen").toBool()&&id.split(':')[1]=="stock"){
   try{auto packet=cached(id);if(!packet.isEmpty()){
    stockProfile::validate(id,packet);row["nativeProfile"]=packet;
    for(auto field:fields){auto part=nativeSource(packet,field);auto val=packet.value(field);auto before=sources.value(field).toObject();auto oldAt=before.value("fetchedAt");if(!QDateTime::fromString(oldAt.toString(),Qt::ISODateWithMs).isValid())oldAt=before.value("updatedAt");bool known=QDateTime::fromString(oldAt.toString(),Qt::ISODateWithMs).isValid();bool fresh=part.value("status")=="ready";
     if(present(val)&&part.value("data").isObject()&&(!present(values.value(field))||newer(part.value("fetchedAt").toString(),oldAt)||(!known&&fresh))){
      values[field]=val;QJsonObject source{{"origin","native-f10"},{"source",packet.value("source")},{"kind",part.value("kind")},{"fetchedAt",part.value("fetchedAt")},{"updatedAt",QJsonValue::Null},{"status",part.value("status")},{"cached",part.value("cached")},{"stale",part.value("stale")},{"lastAttemptAt",part.value("lastAttemptAt")},{"error",part.value("error")},{"selectionReason",known?"比较已知源取得时刻":"旧时刻不可比较；优先成功原生响应，未宣称旧资料更早"}};if(part.contains("contributors"))source["contributors"]=part.value("contributors");sources[field]=source;
     }
    }
   }}catch(const std::exception& e){row["nativeProfileError"]=QString::fromUtf8(e.what());}
  }
  row["values"]=values;row["fieldSources"]=sources;out.append(row);
 }
 // A retained profile without an index remains readable; its explicit API identity is preserved.
 QJsonArray missing,missingProfiles;for(auto v:profiles){auto p=v.toObject();if(consumedProfiles.contains(p.value("id").toString()))continue;auto id=p.value("id").toString();if(p.value("canOpen").toBool())stockResearch::identity(id);QJsonObject row{{"id",id},{"code",p.value("code")},{"name",QJsonValue::Null},{"canOpen",p.value("canOpen")},{"identityReason",p.value("identityReason")},{"legacy",QJsonObject{}},{"market",p.value("canOpen").toBool()?QJsonValue(id.split(':')[0]):QJsonValue(QJsonValue::Null)},{"type",p.value("canOpen").toBool()?QJsonValue(id.split(':')[1]):QJsonValue(QJsonValue::Null)}};missing.append(row);missingProfiles.append(p);}
 if(!missing.isEmpty()){auto extra=catalog(missing,missingProfiles,cached);for(auto v:extra){auto supplemental=v.toObject();supplemental["origin"]="legacy-profile-only";auto name=supplemental.value("values").toObject().value("name");supplemental["name"]=present(name)?name:QJsonValue(QJsonValue::Null);if(!present(name)){supplemental["canOpen"]=false;supplemental["identityReason"]=supplemental.value("identityReason").toString()+"; source display name missing; navigation disabled";}out.append(supplemental);}}
 return out;
}
QJsonArray search(QJsonArray rows,Query query){
 need(QStringList{"all","business","industry","board","scope"}.contains(query.field),"搜索字段无效");need(QStringList{"relevance","name","time"}.contains(query.sort),"搜索排序无效");auto q=compact(query.text);QList<QJsonObject> hits;
 for(auto v:rows){auto row=v.toObject(),data=row.value("values").toObject(),sources=row.value("fieldSources").toObject();
  QString code=compact(data.value("code").toString()),name=compact(data.value("name").toString()),industry=compact(data.value("industry").toString()+" "+data.value("csrcIndustry").toString()),business=compact(itemText(data.value("mainBusinessItems"))),boards=compact(texts(data.value("boards"))),scope=compact(data.value("businessScope").toString()+" "+data.value("businessSummary").toString()+" "+texts(data.value("tags")));
  QString target=query.field=="business"?business:query.field=="industry"?industry:query.field=="board"?boards:query.field=="scope"?scope:code+name+industry+business+boards+scope+compact(row.value("legacy").toObject().value("search_text").toString());if(!fuzzy(q,target))continue;
  int score=50;QString key="search_text",label="资料库近似匹配";
  if(q.isEmpty()){score=0;key="code";label="资料总览";}
  else if(query.field=="all"&&code==q){score=120;key="code";label="代码完全匹配";}
  else if(query.field=="all"&&code.startsWith(q)){score=105;key="code";label="代码前缀匹配";}
  else if(query.field=="all"&&name.contains(q)){score=95;key="name";label="名称命中";}
  else if((query.field=="all"||query.field=="industry")&&industry.contains(q)){score=88;key=compact(data.value("industry").toString()).contains(q)?"industry":"csrcIndustry";label="行业命中";}
  else if((query.field=="all"||query.field=="business")&&business.contains(q)){score=84;key="mainBusinessItems";label="主营命中";}
  else if((query.field=="all"||query.field=="board")&&boards.contains(q)){score=78;key="boards";label="板块命中";}
  else if((query.field=="all"||query.field=="scope")&&scope.contains(q)){score=68;key=compact(data.value("businessScope").toString()).contains(q)?"businessScope":compact(data.value("businessSummary").toString()).contains(q)?"businessSummary":"tags";label="经营范围/回顾/标签命中";}
  else if(query.field!="all"){key=query.field=="business"?"mainBusinessItems":query.field=="industry"?"industry":query.field=="board"?"boards":"businessScope";label="字段近似匹配";}
  auto source=sources.value(key).toObject();if(source.isEmpty())source=clock(row.value("legacy").toObject(),"legacy-search-index");QString excerpt=key=="mainBusinessItems"?itemText(data.value(key)):key=="search_text"?row.value("legacy").toObject().value(key).toString():texts(data.value(key));
  row["score"]=score;row["matchReason"]=label+"："+excerpt;row["matchSource"]=source;row["matchField"]=key;hits.append(row);
 }
 std::stable_sort(hits.begin(),hits.end(),[query](auto a,auto b){if(query.sort=="name"){auto x=a.value("values").toObject().value("name").toString(),y=b.value("values").toObject().value("name").toString();if(x!=y)return x<y;}else if(query.sort=="time"){auto x=QDateTime::fromString(a.value("matchSource").toObject().value("fetchedAt").toString(),Qt::ISODateWithMs),y=QDateTime::fromString(b.value("matchSource").toObject().value("fetchedAt").toString(),Qt::ISODateWithMs);if(x.isValid()!=y.isValid())return x.isValid();if(x.isValid()&&x!=y)return x>y;}else if(a.value("score")!=b.value("score"))return a.value("score").toInt()>b.value("score").toInt();return a.value("id").toString()<b.value("id").toString();});
 QJsonArray out;for(auto row:hits)out.append(row);return out;
}
}
