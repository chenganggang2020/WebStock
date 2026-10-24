#include "cffex_disclosure_model.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QRegularExpression>
#include <QXmlStreamReader>
#include <QStringDecoder>
#include <QMap>
#include <QSet>
#include <cmath>
#include <stdexcept>
namespace cffexDisclosure {
namespace {
void need(bool value,const char* message){if(!value)throw std::runtime_error(message);}
QDate day(QString text){need(QRegularExpression("^[0-9]{4}-[0-9]{2}-[0-9]{2}$").match(text).hasMatch(),"日期须为YYYY-MM-DD");auto d=QDate::fromString(text,Qt::ISODate);need(d.isValid()&&d.year()>=2000&&d.year()<=2099,"日期无效");return d;}
QJsonValue quantity(QString text,bool nonnegative){if(text.isEmpty()||text=="-"||text=="--")return QJsonValue::Null;need(QRegularExpression("^-?[0-9]+$").match(text).hasMatch(),"披露数量不是整数");bool ok;double n=text.toDouble(&ok);need(ok&&std::isfinite(n)&&std::abs(n)<=9007199254740000.&&(!nonnegative||n>=0),"披露数量无效");return n;}
QJsonValue total(const QJsonArray& rows,QString type,QString key){double value=0;int count=0;for(auto v:rows){auto r=v.toObject();if(r["type"]!=type)continue;++count;auto q=r[key];if(q.isNull())return QJsonValue::Null;value+=q.toDouble();if(std::abs(value)>9007199254740000.)return QJsonValue::Null;}return count?QJsonValue(value):QJsonValue(QJsonValue::Null);}
QJsonValue difference(QJsonValue a,QJsonValue b){if(a.isNull()||b.isNull())return QJsonValue(QJsonValue::Null);double d=a.toDouble()-b.toDouble();return std::abs(d)>9007199254740000.?QJsonValue(QJsonValue::Null):QJsonValue(d);}
}
QString hash(const QByteArray& bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
QJsonObject request(const QString& date,const QString& product){auto d=day(date);need(QSet<QString>{"IF","IH","IC","IM"}.contains(product),"仅支持IF/IH/IC/IM指定品种");return {{"date",date},{"product",product},{"url","https://www.cffex.com.cn/sj/ccpm/"+d.toString("yyyyMM")+"/"+d.toString("dd")+"/"+product+".xml"},{"maxBytes",2*1024*1024}};}
QString publicUrl(const QJsonObject& query){
 auto expected=request(query["date"].toString(),query["product"].toString());need(query==expected,"请求日期/品种/来源不符");
 return QString("http://")+expected["url"].toString().mid(8);
}
QJsonObject parse(const QByteArray& raw,const QJsonObject& query,const QString& url,const QString& checkedAt,const QString& origin){
 auto expected=request(query["date"].toString(),query["product"].toString());need(query==expected&&(url==expected["url"].toString()||url==publicUrl(expected)),"请求日期/品种/实际来源URL不符");
 auto receipt=QDateTime::fromString(checkedAt,Qt::ISODateWithMs);need(receipt.isValid()&&QRegularExpression("(Z|[+-][0-9]{2}:[0-9]{2})$").match(checkedAt).hasMatch()&&day(query["date"].toString())<=receipt.toOffsetFromUtc(28800).date(),"接收时点无效或请求日期在未来");
 need(QSet<QString>{"import-unverified","fixture-constructed","host-fetch-response"}.contains(origin),"原文来源状态无效");need(!raw.isEmpty()&&raw.size()<=2*1024*1024,"原文长度无效");
 QStringDecoder decoder(QStringDecoder::Utf8,QStringConverter::Flag::ConvertInitialBom);QString text=decoder(raw);need(!decoder.hasError()&&!text.contains(QChar(0)),"仅接收完整UTF8原文");need(!QRegularExpression("<!DOCTYPE|<!ENTITY",QRegularExpression::CaseInsensitiveOption).match(text).hasMatch(),"拒绝DTD/外部实体");
 QXmlStreamReader xml(raw);QMap<QString,QJsonArray> grouped;QSet<QString> ranks,members;int ignored=0,sourceRows=0;
 while(!xml.atEnd()){xml.readNext();if(xml.isStartDocument())need(xml.documentEncoding().isEmpty()||xml.documentEncoding().toString().compare("UTF-8",Qt::CaseInsensitive)==0,"XML编码声明须为UTF-8");if(!xml.isStartElement()||xml.name().toString().toLower()!="data")continue;need(++sourceRows<=4000,"原文记录过多");QMap<QString,QString> fields;auto attributes=xml.attributes();
  while(xml.readNextStartElement()){QString key=xml.name().toString().toLower();need(!fields.contains(key),"同一披露行字段重复");fields[key]=xml.readElementText(QXmlStreamReader::ErrorOnUnexpectedElement).trimmed();}
  QString product=fields["productid"].toUpper(),contract=fields["instrumentid"].toUpper(),date=fields["tradingday"];if(QRegularExpression("^[0-9]{8}$").match(date).hasMatch())date=date.left(4)+"-"+date.mid(4,2)+"-"+date.mid(6,2);need(date==query["date"].toString()&&product==query["product"].toString(),"原文交易日/品种与请求不符");day(date);
  need(QRegularExpression("^"+product+"[0-9]{2}(0[1-9]|1[0-2])$").match(contract).hasMatch(),"须真实编码到期月份的合约，拒绝连续符号");QString expiry="20"+contract.mid(product.size(),2)+"-"+contract.right(2);need(expiry>=date.left(7),"原文合约到期月份早于披露月");QString attrContract=attributes.value("Text").toString();need(attrContract.isEmpty()||attrContract.toUpper()==contract,"合约属性与正文不符");
  QString type=fields["datatypeid"];need(type=="0"||type=="1"||type=="2","未知披露类别");bool ok;int rank=fields["rank"].toInt(&ok);need(ok&&QRegularExpression("^[0-9]+$").match(fields["rank"]).hasMatch(),"排名无效");if(rank<1||rank>20){++ignored;continue;}
  QString member=fields["shortname"],party=fields["partyid"];need(!member.isEmpty()&&member.size()<=200&&party.size()<=60,"会员身份无效");QString side=type=="0"?"turnover":type=="1"?"long":"short",memberKey=party.isEmpty()?"name:"+member:"party:"+party;QString prefix=contract+":"+side+":";need(!ranks.contains(prefix+QString::number(rank))&&!members.contains(prefix+memberKey),"重复排名或会员披露");ranks.insert(prefix+QString::number(rank));members.insert(prefix+memberKey);
  grouped[contract].append(QJsonObject{{"rank",rank},{"type",side},{"member",member},{"partyId",party},{"memberKey",memberKey},{"volume",quantity(fields["volume"],true)},{"change",quantity(fields["varvolume"],false)}});
 }
 need(!xml.hasError()&&!grouped.isEmpty(),"XML无效或没有可用排名行");QJsonArray contracts;
 for(auto it=grouped.begin();it!=grouped.end();++it){auto rows=it.value();auto l=total(rows,"long","volume"),s=total(rows,"short","volume"),lc=total(rows,"long","change"),sc=total(rows,"short","change");QJsonObject counts;for(auto type:{"turnover","long","short"}){int n=0;for(auto v:rows)if(v.toObject()["type"]==type)++n;counts[type]=n;}
  contracts.append(QJsonObject{{"id","CFFEX:futures:"+it.key()},{"contract",it.key()},{"product",query["product"]},{"expiryMonth","20"+it.key().mid(it.key().size()-4,2)+"-"+it.key().right(2)},{"tradingDay",query["date"]},{"rows",rows},{"rowCounts",counts},{"listedLong",l},{"listedShort",s},{"listedLongChange",lc},{"listedShortChange",sc},{"listedDifference",difference(l,s)},{"listedDifferenceChange",difference(lc,sc)},{"scope","listed-ranked-members-only"},{"fullMarket",false}});
 }
 return {{"schema","native-cffex-disclosure/v1"},{"request",expected},{"sourceUrl",url},{"provider","CFFEX"},{"unit","手"},{"checkedAt",checkedAt},{"origin",origin},{"rawXml",text},{"rawSha256",hash(raw)},{"contracts",contracts},{"ignoredNonRankRows",ignored},{"calendarVerified",false},{"publicationTime",QJsonValue(QJsonValue::Null)},{"meaning","日终排名会员披露；仅已列出行，不是全市场净流入/净多空；缺项不是0"}};
}
QJsonObject validate(const QJsonObject& report){need(report["schema"]=="native-cffex-disclosure/v1"&&report["rawXml"].isString(),"不是CFFEX独立披露格式");auto raw=report["rawXml"].toString().toUtf8();need(hash(raw)==report["rawSha256"],"原文摘要不符");auto expected=parse(raw,report["request"].toObject(),report["sourceUrl"].toString(),report["checkedAt"].toString(),report["origin"].toString());need(expected==report,"披露内容或未知字段与原文不符");return expected;}
}
