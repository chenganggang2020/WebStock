#include "concept_public.hpp"
#include <QCryptographicHash>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QUrlQuery>
#include <QXmlStreamReader>
#include <stdexcept>
namespace conceptPublic {
static void need(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
static QString sha(QByteArray bytes){return QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());}
bool enabled(QJsonObject q){return q.value("provider")=="eastmoney-public-board"&&q.value("taxonomy")=="concept";}
QUrl guestUrl(QJsonObject q,int page,bool directoryCheck){
 sectorWatch::queryKey(q);need(enabled(q)&&page>=1&&page<=100,"Only verified Eastmoney concept queries use the public guest route");
 QUrl url("https://pushguest.eastmoney.com/api/qt/clist/get");QUrlQuery p;
 for(auto pair:QList<QPair<QString,QString>>{{"timil","1"},{"np","1"},{"fltt",directoryCheck?"1":"2"},{"invt","2"},{"cb",callback},{"fs",directoryCheck?"m:90+t:3+f:!50":"b:"+q.value("code").toString()},{"fields",directoryCheck?"f12,f14":"f2,f3,f6,f12,f13,f14,f62"},{"fid","f12"},{"pn",QString::number(page)},{"pz","20"},{"po","1"},{"dect","1"},{"ut","fa5fd1943c7b386f172d6893dbfba10b"},{"wbp2u","|0|0|0|web"}})p.addQueryItem(pair.first,pair.second);
 need(directoryCheck?q.value("kind")=="catalog":q.value("kind")=="constituents","Guest query phase mismatch");url.setQuery(p);
 // A literal plus belongs to the source filter, not form-encoded whitespace.
 return QUrl::fromEncoded(url.toEncoded().replace("+","%2B"));
}
QJsonObject guestPayload(QByteArray bytes,QString expected){
 need(!bytes.isEmpty()&&bytes.size()<=2*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"Guest response empty, oversized or invalid UTF8");need(QRegularExpression("^[A-Za-z][A-Za-z0-9_]{0,63}$").match(expected).hasMatch(),"Invalid fixed callback");
 auto raw=bytes.trimmed(),prefix=expected.toUtf8()+"(";need(raw.startsWith(prefix)&&(raw.endsWith(");")||raw.endsWith(")")),"Guest JSONP callback or suffix mismatch");raw=raw.mid(prefix.size());raw.chop(raw.endsWith(");")?2:1);QJsonParseError error;auto doc=QJsonDocument::fromJson(raw,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"Guest response is not one JSON object; scripts are never evaluated");return doc.object();
}
QJsonObject directory(QByteArray bytes,QJsonObject check,QJsonObject q,QString start,QString fetched){
 sectorWatch::queryKey(q);need(enabled(q)&&q.value("kind")=="catalog","Concept catalogue query identity mismatch");need(!bytes.isEmpty()&&bytes.size()<=2*1024*1024&&QString::fromUtf8(bytes).toUtf8()==bytes,"Official catalogue HTML empty, oversized or invalid UTF8");auto html=QString::fromUtf8(bytes);
 need(html.contains(QRegularExpression("var\\s+page_type\\s*=\\s*\"gnzjl\"\\s*;"))&&html.contains("<title>概念板块资金流向排行"),"Official concept page markers changed");
 QRegularExpression block("<div\\s+class=\"pop-cont(?:\\s+[^\"]*)?\"[^>]*>(.*?)</div>",QRegularExpression::DotMatchesEverythingOption);auto found=block.globalMatch(html);QStringList sections;while(found.hasNext())sections.append(found.next().captured(1));need(sections.size()==3,"Industry/concept/region catalogue sections missing or duplicated");
 auto content=sections[1];QRegularExpression link("<a\\b[^>]*>.*?</a>",QRegularExpression::DotMatchesEverythingOption),exact("^<a\\s+href=\"/bkzj/(BK[0-9]{4})\\.html\"\\s*>([^<]*)</a>$");auto links=link.globalMatch(content);QJsonArray rows;QHash<QString,QString> names;
 while(links.hasNext()){
  auto item=exact.match(links.next().captured());need(item.hasMatch(),"Concept catalogue contains a malformed or non-BK leaf; incomplete lists are not accepted");auto code=item.captured(1);need(!names.contains(code),"Concept catalogue contains duplicate BK identity");QXmlStreamReader text("<n>"+item.captured(2)+"</n>");need(text.readNextStartElement(),"Concept label missing");auto name=text.readElementText();need(!text.hasError()&&!name.trimmed().isEmpty()&&name.size()<=128,"Concept label invalid");names.insert(code,name);rows.append(QJsonObject{{"f12",code},{"f14",name}});
 }
 need(!rows.isEmpty()&&rows.size()<=2048,"Official concept section empty or excessive");auto data=check.value("data").toObject();auto total=data.value("total");need(check.value("rc")==0&&total.isDouble()&&total.toDouble()==rows.size()&&data.value("diff").isArray(),"Official HTML catalogue and guest declared total disagree");auto sample=data.value("diff").toArray();need(!sample.isEmpty()&&sample.size()<=20,"Guest count-check page missing or oversized");QSet<QString> seen;
 for(auto v:sample){need(v.isObject(),"Guest count-check row malformed");auto row=v.toObject();auto code=row.value("f12").toString();need(!seen.contains(code)&&names.contains(code)&&row.value("f14")==names.value(code),"Guest catalogue identity/name differs from the explicit official HTML links");seen.insert(code);}
 sectorWatch::Assembly assembly(q,start);int page=1;for(int offset=0;offset<rows.size();offset+=500){QJsonArray chunk;for(int i=offset;i<qMin(offset+500,rows.size());++i)chunk.append(rows[i]);assembly.appendEastmoney({{"rc",0},{"data",QJsonObject{{"total",rows.size()},{"diff",chunk}}}},page++,0);}auto result=assembly.finish(fetched,0);
 result["pages"]=1;result["sourceRequests"]=2;result["catalogTransport"]="official-concept-html-with-public-guest-count-check";result["sourceUrl"]=directoryUrl;result["validationUrl"]=guestUrl(q,1,true).toString();result["rawCatalogueHtml"]=html;result["catalogueHtmlSHA256"]=sha(bytes);result["rawCatalogueCheck"]=check;result["catalogueCheckSHA256"]=sha(QJsonDocument(check).toJson(QJsonDocument::Compact));sectorWatch::validate(result);return result;
}
}
