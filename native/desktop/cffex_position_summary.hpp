#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QMap>
#include <QRegularExpression>
#include <QSet>
#include <cmath>
#include <algorithm>
#include <stdexcept>

namespace cffexDisclosure {
inline QJsonValue positionSafeNumber(double n){return std::isfinite(n)&&std::abs(n)<=9007199254740000.?QJsonValue(n):QJsonValue(QJsonValue::Null);}
inline QJsonValue positionDifference(QJsonValue a,QJsonValue b){return a.isDouble()&&b.isDouble()?positionSafeNumber(a.toDouble()-b.toDouble()):QJsonValue(QJsonValue::Null);}
inline bool isCiticFutures(QString name){name.remove(QRegularExpression("\\s+"));return QRegularExpression(QStringLiteral("^中信期货(?:$|[（(]|有限)")).match(name).hasMatch();}
// Derived display only: retain the signed source report and its raw XML unchanged.
// A missing ranked side is unknown, not a zero holding.
inline QJsonObject positionSummary(const QJsonObject& contract){
 QMap<QString,QJsonObject> members;QJsonValue nil(QJsonValue::Null);
 QMap<QString,qint64> totals;QMap<QString,bool> valid;QMap<QString,int> counts;
 for(auto value:contract["rows"].toArray()){
  const auto row=value.toObject();const auto side=row["type"].toString();if(side!="long"&&side!="short")continue;
  const auto key=row["memberKey"].toString();auto member=members.value(key);
  if(member.isEmpty())member={{"memberKey",key},{"member",row["member"]},{"long",nil},{"short",nil},{"longChange",nil},{"shortChange",nil},{"citic",isCiticFutures(row["member"].toString())}};
  member[side]=row["volume"].isDouble()?row["volume"]:nil;member[side+"Change"]=row["change"].isDouble()?row["change"]:nil;member[side+"Citic"]=isCiticFutures(row["member"].toString());member["citic"]=member["citic"].toBool()||member[side+"Citic"].toBool();members[key]=member;
  for(const auto& pair:QList<QPair<QString,QString>>{{side,"volume"},{side+"Change","change"}}){
   if(!counts[pair.first]++)valid[pair.first]=true;
   if(row[pair.second].isDouble())totals[pair.first]+=qint64(row[pair.second].toDouble());else valid[pair.first]=false;
  }
 }
 auto total=[&](const QString& key)->QJsonValue{return counts.value(key)>0&&valid.value(key)?positionSafeNumber(totals.value(key)):nil;};
 QList<QJsonObject> ordered;QJsonArray citicRows;
 for(auto member:members){member["net"]=positionDifference(member["long"],member["short"]);member["netChange"]=positionDifference(member["longChange"],member["shortChange"]);if(member.contains("longCitic")&&member.contains("shortCitic")&&member["longCitic"]!=member["shortCitic"]){member["net"]=nil;member["netChange"]=nil;member["reason"]="同一标识的会员名称不一致";}member["complete"]=member["net"].isDouble();if(member["citic"].toBool())citicRows.append(member);ordered.append(member);}
 std::stable_sort(ordered.begin(),ordered.end(),[](const auto&a,const auto&b){if(a["citic"].toBool()!=b["citic"].toBool())return a["citic"].toBool();return std::abs(a["net"].toDouble())>std::abs(b["net"].toDouble());});
 QJsonArray rows;for(const auto& row:ordered)rows.append(row);
 QJsonObject citic{{"long",nil},{"short",nil},{"net",nil},{"netChange",nil},{"complete",false},{"matches",citicRows.size()}};
 if(citicRows.size()==1)citic=citicRows[0].toObject();
 return {{"listedLong",total("long")},{"listedShort",total("short")},{"listedLongChange",total("longChange")},{"listedShortChange",total("shortChange")},{"net",positionDifference(total("long"),total("short"))},{"netChange",positionDifference(total("longChange"),total("shortChange"))},{"citic",citic},{"members",rows}};
}
// The old dashboard sums daily disclosed changes across ALL contracts in all four
// products. Selecting a detail contract must never change these two totals.
inline QJsonObject dailyPositionTotals(const QJsonArray& reports){
 if(reports.isEmpty()||reports.size()>4)throw std::runtime_error("披露批次须有1至4个品种");
 QJsonObject citic,listed;QString date;QSet<QString> products;int contracts=0,citicCovered=0,listedCovered=0;
 const QStringList fields{"long","short","longChange","shortChange"};
 for(const auto& key:fields){citic[key]=0;listed[key]=0;}
 auto add=[](QJsonObject& target,const QString& key,QJsonValue value){if(!target[key].isDouble()||!value.isDouble())target[key]=QJsonValue::Null;else target[key]=positionSafeNumber(qint64(target[key].toDouble())+qint64(value.toDouble()));};
 for(auto value:reports){const auto report=value.toObject(),query=report["request"].toObject();const auto day=query["date"].toString(),product=query["product"].toString();
  if(day.isEmpty()||(!date.isEmpty()&&day!=date)||products.contains(product)||!QStringList{"IF","IH","IC","IM"}.contains(product))throw std::runtime_error("汇总须为同一披露日且品种不重复");
  date=day;products.insert(product);if(report["contracts"].toArray().isEmpty())throw std::runtime_error("披露品种没有合约");
  for(auto contract:report["contracts"].toArray()){const auto s=positionSummary(contract.toObject()),member=s["citic"].toObject();++contracts;
   for(const auto& key:fields){const auto sourceKey="listed"+key.left(1).toUpper()+key.mid(1);add(listed,key,s[sourceKey]);}
   if(s["net"].isDouble())++listedCovered;
   if(!member["complete"].toBool())continue;++citicCovered;for(const auto& key:fields)add(citic,key,member[key]);
  }
 }
 if(!citicCovered)for(const auto& key:fields)citic[key]=QJsonValue::Null;
 for(auto* total:{&citic,&listed}){(*total)["net"]=positionDifference((*total)["long"],(*total)["short"]);(*total)["netChange"]=positionDifference((*total)["longChange"],(*total)["shortChange"]);}
 citic["covered"]=citicCovered;listed["covered"]=listedCovered;QStringList sorted=products.values();sorted.sort();
 return {{"date",date},{"products",QJsonArray::fromStringList(sorted)},{"allProducts",products.size()==4},{"contracts",contracts},{"citic",citic},{"listed",listed}};
}
inline QString dailyChangeLabel(QJsonValue value){if(!value.isDouble())return "当日净增减未知";double n=value.toDouble();return n==0?QString("当日净多空无变化"):QString(n>0?"净增多 %1 手":"净增空 %1 手").arg(QString::number(std::abs(n),'f',0));}
inline QJsonObject citicProductSummary(const QJsonObject& report){
 qint64 net=0,change=0;bool netSafe=true,changeSafe=true;int complete=0,changeComplete=0;const auto contracts=report["contracts"].toArray();
 auto add=[](qint64& sum,bool& safe,QJsonValue value){if(!safe)return;sum+=qint64(value.toDouble());safe=std::abs(sum)<=qint64(9007199254740000LL);};
 for(auto value:contracts){const auto citic=positionSummary(value.toObject())["citic"].toObject();if(!citic["net"].isDouble())continue;add(net,netSafe,citic["net"]);++complete;if(citic["netChange"].isDouble()){add(change,changeSafe,citic["netChange"]);++changeComplete;}}
 return {{"net",complete&&netSafe?positionSafeNumber(net):QJsonValue(QJsonValue::Null)},{"netChange",complete&&changeComplete==complete&&changeSafe?positionSafeNumber(change):QJsonValue(QJsonValue::Null)},{"completeContracts",complete},{"totalContracts",contracts.size()}};
}
inline QString positionNumber(QJsonValue value){return value.isDouble()?QString::number(value.toDouble(),'f',0):QStringLiteral("未完整披露");}
inline QString positionLabel(QJsonValue value){if(!value.isDouble())return QStringLiteral("净持仓未知");const auto n=value.toDouble();return n==0?QStringLiteral("多空持平 0 手"):QString(n>0?"净多 %1 手":"净空 %1 手").arg(QString::number(std::abs(n),'f',0));}
inline QString positionChangeLabel(QJsonValue value){if(!value.isDouble())return QStringLiteral("净增减未知");const auto n=value.toDouble();return n==0?QStringLiteral("净增减 0 手"):QString(n>0?"净多方向增加 %1 手":"净空方向增加 %1 手").arg(QString::number(std::abs(n),'f',0));}
inline QString positionMovementLabel(QJsonValue net,QJsonValue change){
 if(!net.isDouble()||!change.isDouble())return positionChangeLabel(change);const double n=net.toDouble(),d=change.toDouble(),before=n-d;if(d==0)return QStringLiteral("净持仓不变");
 if(n<0&&before<=0)return QString(d<0?"净空增加 %1 手":"净空减少 %1 手").arg(QString::number(std::abs(d),'f',0));
 if(n>0&&before>=0)return QString(d>0?"净多增加 %1 手":"净多减少 %1 手").arg(QString::number(std::abs(d),'f',0));
 return QString(n>0?"转为净多 · 净额 +%1 手":n<0?"转为净空 · 净额 −%1 手":"多空转为持平 · 变动 %1 手").arg(QString::number(std::abs(d),'f',0));
}
}
