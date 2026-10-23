#include "ths_board_public.hpp"
#include "sector_watch_model.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QXmlStreamReader>
#include <QSet>
#include <cmath>
#include <stdexcept>
#ifdef Q_OS_WIN
#include <windows.h>
#endif
namespace thsBoard {
namespace {
void need(bool ok,const char* why){if(!ok)throw std::runtime_error(why);}
QString section(const QString& taxonomy){need(taxonomy=="industry"||taxonomy=="concept","Invalid THS classification");return taxonomy=="industry"?"thshy":"gn";}
QString html(const QByteArray& bytes){
 need(!bytes.isEmpty()&&bytes.size()<=2*1024*1024,"THS HTML empty or oversized");QString text;
 // The official pages declare GBK. Never decode Chinese labels lossily.
 if(QRegularExpression("charset\\s*=\\s*[\"']?gbk",QRegularExpression::CaseInsensitiveOption).match(QString::fromLatin1(bytes.left(2048))).hasMatch()){
#ifdef Q_OS_WIN
  int n=MultiByteToWideChar(936,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),nullptr,0);need(n>0,"Invalid THS GBK");std::wstring wide(size_t(n),L'\0');need(MultiByteToWideChar(936,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),wide.data(),n)==n,"THS GBK decode failed");text=QString::fromWCharArray(wide.data(),n);
#else
  throw std::runtime_error("THS GBK decoder unavailable on this platform");
#endif
 }else{text=QString::fromUtf8(bytes);need(text.toUtf8()==bytes,"THS HTML encoding unknown");}
 need(text.contains("</html>")&&!text.contains(QChar(0xfffd)),"THS page truncated or undecodable");return text;
}
double number(const QString& s){bool ok=false;double d=s.toDouble(&ok);need(ok&&std::isfinite(d),"THS history has invalid numeric field");return d;}
}
QString sha(const QByteArray& b){return QString::fromLatin1(QCryptographicHash::hash(b,QCryptographicHash::Sha256).toHex());}
QUrl directoryUrl(const QString& taxonomy){return QUrl("https://q.10jqka.com.cn/"+section(taxonomy)+"/");}
QUrl detailUrl(const QString& taxonomy,const QString& code){sectorWatch::query(provider,taxonomy,code);need(!code.isEmpty(),"THS detail code missing");return QUrl(directoryUrl(taxonomy).toString()+"detail/code/"+code+"/");}
QUrl yearUrl(const QString& code,int year){need(QRegularExpression("^88[0-9]{4}$").match(code).hasMatch()&&year>=1990&&year<=2100,"Invalid THS chart identity/year");return QUrl(QString("https://d.10jqka.com.cn/v4/line/bk_%1/01/%2.js").arg(code).arg(year));}
QUrl inventoryUrl(const QString& code){auto s=yearUrl(code,2000).toString();s.replace("2000.js","last.js");return QUrl(s);}
QJsonObject inventory(const QByteArray& bytes,const QString& code,const QString& checkedAt){
 auto url=inventoryUrl(code);need(bytes.size()>0&&bytes.size()<=2*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"Invalid THS inventory encoding/size");auto raw=bytes.trimmed(),prefix=QString("quotebridge_v4_line_bk_%1_01_last(").arg(code).toUtf8();need(raw.startsWith(prefix)&&(raw.endsWith(')')||raw.endsWith(");")),"THS inventory callback mismatch");raw=raw.mid(prefix.size());raw.chop(raw.endsWith(");")?2:1);QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"Invalid THS inventory JSON");auto obj=doc.object(),years=obj["year"].toObject();double total=number(obj["total"].isString()?obj["total"].toString():QString::number(obj["total"].toDouble(-1)));need(total>0&&total<=40000&&std::floor(total)==total&&!years.isEmpty(),"THS inventory total missing/invalid");int sum=0;for(auto i=years.begin();i!=years.end();++i){bool ok=false;int y=i.key().toInt(&ok);double n=i.value().toDouble(-1);need(ok&&y>=1990&&y<=2100&&n>0&&n<=370&&std::floor(n)==n,"THS inventory year/count invalid");sum+=int(n);}need(sum==int(total),"THS inventory years do not sum to total");
 auto start=QDate::fromString(obj["start"].toString(),"yyyyMMdd");need(start.isValid()&&start.toString("yyyyMMdd")==obj["start"].toString()&&years.keys().first()==QString::number(start.year()),"THS inventory start mismatch");auto last=obj["data"].toString().split(';').last();int year=last.left(4).toInt();auto candleBytes=QString("quotebridge_v4_line_bk_%1_01_%2(").arg(code).arg(year).toUtf8()+QJsonDocument(QJsonObject{{"data",last}}).toJson(QJsonDocument::Compact)+")";auto lastRow=annual(candleBytes,code,year,checkedAt).last().toObject();need(years.keys().last()==QString::number(year),"THS latest date/year mismatch");return {{"chartCode",code},{"url",url.toString()},{"sha256",sha(bytes)},{"total",int(total)},{"startDate",start.toString(Qt::ISODate)},{"dataDate",lastRow["date"]},{"yearCounts",years},{"latestRow",lastRow}};
}
QJsonObject directory(const QByteArray& bytes,const QJsonObject& q,const QString& start,const QString& fetched){
 sectorWatch::queryKey(q);need(q["provider"]==provider&&q["kind"]=="catalog","THS catalogue query mismatch");auto text=html(bytes);auto kind=q["taxonomy"].toString();
 need(text.contains("class=\"category boxShadow m_links\"")&&text.contains("class=\"cate_inner"),"THS official category section missing");
 QRegularExpression block("<div\\s+class=\"cate_items\"\\s*>(.*?)</div>",QRegularExpression::DotMatchesEverythingOption);
 QRegularExpression link("<a\\b[^>]*>.*?</a>",QRegularExpression::DotMatchesEverythingOption);
 QRegularExpression exact("^<a\\s+href=\"https?://q\\.10jqka\\.com\\.cn/"+section(kind)+"/detail/code/([0-9]{6})/\"\\s+target=\"_blank\"\\s*>([^<]+)</a>$");
 auto blocks=block.globalMatch(text);QJsonArray rows;QSet<QString> codes;int groups=0;
 while(blocks.hasNext()){auto content=blocks.next().captured(1);++groups;auto links=link.globalMatch(content);
  while(links.hasNext()){auto match=exact.match(links.next().captured());need(match.hasMatch(),"THS category leaf changed; refusing partial catalogue");auto code=match.captured(1);need(!codes.contains(code),"THS duplicate category identity");codes.insert(code);auto rowQuery=sectorWatch::query(provider,kind,code);QXmlStreamReader reader("<n>"+match.captured(2)+"</n>");need(reader.readNextStartElement(),"THS category label missing");auto name=reader.readElementText().trimmed();need(!reader.hasError()&&!name.isEmpty()&&name.size()<=160,"THS category label invalid");
   QJsonObject row{{"provider",provider},{"taxonomy",kind},{"code",code},{"boardCode",""},{"key",sectorWatch::queryKey(rowQuery)},{"kind","board"},{"name",name}};for(auto f:{"price","changePct","amount","mainNetInflow"})row[f]=QJsonValue::Null;rows.append(row);
  }
  content.remove(link);need(content.trimmed().isEmpty(),"THS category has unparsed content");
 }
 need(groups==(kind=="industry"?5:6)&&!rows.isEmpty()&&rows.size()<=2048,"THS category group missing/excessive");
 // Newly published concepts can precede the alphabetical catalogue. Keep their
 // explicit page identities too; this is not a claim about every archive page.
 auto visiblePattern=exact.pattern();visiblePattern.remove(0,1);visiblePattern.chop(1);QRegularExpression visible(visiblePattern);auto extras=visible.globalMatch(text);
 while(extras.hasNext()){auto match=extras.next();auto code=match.captured(1);QXmlStreamReader reader("<n>"+match.captured(2)+"</n>");need(reader.readNextStartElement(),"THS visible label missing");auto name=reader.readElementText().trimmed();need(!reader.hasError()&&!name.isEmpty()&&name.size()<=160,"THS visible label invalid");if(codes.contains(code)){for(auto v:rows)if(v.toObject()["code"]==code)need(v.toObject()["name"]==name,"THS visible identity has conflicting names");continue;}auto rowQuery=sectorWatch::query(provider,kind,code);codes.insert(code);QJsonObject row{{"provider",provider},{"taxonomy",kind},{"code",code},{"boardCode",""},{"key",sectorWatch::queryKey(rowQuery)},{"kind","board"},{"name",name}};for(auto f:{"price","changePct","amount","mainNetInflow"})row[f]=QJsonValue::Null;rows.append(row);}
 QJsonObject result{{"schema",sectorWatch::schema},{"query",q},{"key",sectorWatch::queryKey(q)},{"startedAt",start},{"fetchedAt",fetched},{"observedAt",QJsonValue::Null},{"declaredTotal",rows.size()},{"coverageComplete",true},{"quoteComplete",false},{"items",rows},{"failure",""},{"sourceTiming","官网分类与当前新增页可见链接完整，不含实时报价；未扫描历史新增归档页"},{"sourceUrl",directoryUrl(kind).toString()},{"catalogTransport","ths-official-category-html"},{"completenessScope","official-category-and-visible-new-concepts-not-archive-pagination"},{"catalogueHtmlSHA256",sha(bytes)}};
 sectorWatch::validate(result);return result;
}
QString chartCode(const QByteArray& bytes,const QString& taxonomy,const QString& directoryCode){
 detailUrl(taxonomy,directoryCode);auto text=html(bytes);
 need(text.contains("id=\"requestQuery\" value='code/"+directoryCode+"'")&&text.contains("value='"+section(taxonomy)+"/detail'"),"THS detail page directory identity mismatch");
 QRegularExpression pattern("<input\\s+type=\"hidden\"\\s+id=\"clid\"\\s+value='(88[0-9]{4})'\\s*>");auto matches=pattern.globalMatch(text);need(matches.hasNext(),"THS detail chart identity missing");auto code=matches.next().captured(1);need(!matches.hasNext(),"THS ambiguous chart identity");if(taxonomy=="industry")need(code==directoryCode,"THS industry/chart identity mismatch");return code;
}
QJsonArray annual(const QByteArray& bytes,const QString& code,int year,const QString& checkedAt){
 yearUrl(code,year);need(!bytes.isEmpty()&&bytes.size()<=2*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"THS annual response empty/oversized/invalid UTF8");auto raw=bytes.trimmed();auto prefix=QString("quotebridge_v4_line_bk_%1_01_%2(").arg(code).arg(year).toUtf8();need(raw.startsWith(prefix)&&(raw.endsWith(')')||raw.endsWith(");")),"THS callback identity mismatch; scripts never executed");raw=raw.mid(prefix.size());raw.chop(raw.endsWith(");")?2:1);QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);need(error.error==QJsonParseError::NoError&&doc.isObject()&&doc.object()["data"].isString(),"Invalid THS annual JSON");auto text=doc.object()["data"].toString();need(!text.isEmpty(),"THS annual history empty");auto lines=text.split(';');need(lines.size()<=370,"THS annual count exceeds one year");auto clock=QDateTime::fromString(checkedAt,Qt::ISODateWithMs);need(clock.isValid()&&(checkedAt.endsWith('Z')||QRegularExpression("[+-]\\d{2}:\\d{2}$").match(checkedAt).hasMatch()),"THS receipt time invalid");auto today=clock.toOffsetFromUtc(8*3600).date();QJsonArray rows;QString prior;
 for(auto line:lines){auto f=line.split(',');need(f.size()>=7,"THS annual row incomplete");auto d=QDate::fromString(f[0],"yyyyMMdd");need(d.isValid()&&d.toString("yyyyMMdd")==f[0]&&d.year()==year&&d<=today&&f[0]>prior,"THS date wrong year/future/duplicate/unordered");prior=f[0];double o=number(f[1]),h=number(f[2]),l=number(f[3]),c=number(f[4]),v=number(f[5]),a=number(f[6]);need(l>0&&h>=qMax(o,c)&&l<=qMin(o,c)&&v>=0&&a>=0,"THS OHLC/quantity invalid");rows.append(QJsonObject{{"date",d.toString(Qt::ISODate)},{"time",double(QDateTime(d,QTime(0,0),Qt::OffsetFromUTC,8*3600).toMSecsSinceEpoch())},{"open",o},{"high",h},{"low",l},{"close",c},{"volume",v},{"amount",a},{"valid",true},{"closed",d<today}});}
 return rows;
}
}
