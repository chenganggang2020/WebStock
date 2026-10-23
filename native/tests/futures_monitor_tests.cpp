#include "futures_monitor_model.hpp"
#include "futures_monitor_page.hpp"
#include <QApplication>
#include <QFile>
#include <QJsonDocument>
#include <QPushButton>
#include <QListWidget>
#include <QDateTime>
#include <QPlainTextEdit>
#include <QTemporaryDir>
#include <stdexcept>
void check(bool ok,const char *why){if(!ok)throw std::runtime_error(why);}
int main(int argc,char **argv){QApplication app(argc,argv);try{
 const QString now="2026-10-13T02:02:10Z";
 QByteArray payload="var _IF0=([{\"d\":\"2026-10-13 10:01:00\",\"o\":\"4000\",\"c\":\"4001\",\"v\":\"0\",\"p\":\"100\"},{\"d\":\"2026-10-13 10:02:00\",\"c\":\"4003\",\"v\":\"5\",\"p\":\"103\"}]);";
 auto r=futuresMonitor::parse("IF0",payload,now);check(r["availability"]=="available","actual JSONP shape");
 if(argc>1){QFile fixtures(argv[1]);check(fixtures.open(QIODevice::ReadOnly),"fixture file");auto cases=QJsonDocument::fromJson(fixtures.readAll()).object()["cases"].toArray();check(cases.size()==4,"four catalog fixtures");for(auto v:cases){auto c=v.toObject();auto actual=futuresMonitor::parse(c["symbol"].toString(),c["payload"].toString().toUtf8(),c["receivedAt"].toString())["summary"].toObject(),expected=c["expected"].toObject();for(QString key:{"price","minuteVolume","openInterest","minutePriceChange","openInterestChange","sessionChangePct"})check(std::abs(actual[key].toDouble()-expected[key].toDouble())<.00001,"actual old JS formula parity");check(actual["positioningState"]==expected["positioningState"],"actual old JS state parity");}}
 auto s=r["summary"].toObject();check(s["minutePriceChange"].toDouble()==2&&s["openInterestChange"].toDouble()==3,"adjacent delta");
 check(r["instrumentId"]=="CFFEX:continuous:IF0"&&r["exchangeTradingDay"].isNull()&&r["expiry"].isNull(),"separate continuous identity");
 check(r["rows"].toArray().first().toObject()["volume"].toDouble()==0,"real zero retained");
 auto gap=futuresMonitor::parse("IF0",QByteArray(payload).replace("10:01:00","10:00:00"),now);
 check(gap["summary"].toObject()["minutePriceChange"].isNull(),"gaps not minute deltas");
 check(futuresMonitor::parse("IF0","var _IF0=([{\"d\":\"2026-10-13 10:02:00\",\"c\":1,\"v\":1}]);",now)["availability"]=="unavailable","missing oi not zero");
 check(futuresMonitor::parse("IF0","bad",now)["availability"]=="unavailable","invalid bytes");
 check(futuresMonitor::parse("IF0",QByteArray(payload).replace("_IF0","_IH0"),now)["availability"]=="unavailable","declared response identity mismatch");
 check(futuresMonitor::parse("IF0",payload,"2026-10-13T10:01:30+08:00")["rows"].toArray().size()==1,"future row excluded");
 bool rejected=false;try{futuresMonitor::parse("IF2410",payload,now);}catch(...){rejected=true;}check(rejected,"no fake expiry");
 QTemporaryDir temp;QString file=temp.filePath("futures.sqlite");futuresMonitor::Store store(file);store.save(r);store.save(r);
 check(store.history("IF0").size()==1&&store.read(r["id"].toString())==r,"append idempotent exact read");
 rejected=false;try{store.save(futuresMonitor::parse("IF0","bad",now));}catch(...){rejected=true;}check(rejected&&store.history("IF0").size()==1,"failure preserves history");
 auto altered=r;altered["summary"]=QJsonObject();rejected=false;try{store.save(altered);}catch(...){rejected=true;}check(rejected,"tamper refused");
 QString token;QStringList symbols;int starts=0,stops=0;FuturesMonitorPage page(file,[&](QString t,QStringList ss){token=t;symbols=ss;starts++;},[&](QString){stops++;});
 check(starts==0,"opening no fetch");page.findChild<QPushButton*>("futuresRefresh")->click();check(starts==1&&symbols.size()==futuresMonitor::catalog().size()&&symbols.first()=="IF0","explicit selected refresh");
 page.cancel();page.deliver(token,QJsonArray{QJsonObject{{"symbol","IF0"},{"payload",QString::fromUtf8(payload)},{"receivedAt",now},{"sourceUrl",futuresMonitor::sourceUrl("IF0")}}});check(stops==1&&store.history("IF0").size()==1,"late cancelled ignored");
 page.findChild<QPushButton*>("futuresRefresh")->click();page.deliver(token,QJsonArray{QJsonObject{{"symbol","IF0"},{"payload",QString::fromUtf8(payload)},{"receivedAt",now},{"sourceUrl",futuresMonitor::sourceUrl("IF0")}}});
 auto state=page.saveState();FuturesMonitorPage restored(file,{},{});restored.restoreState(state);check(starts==2,"restore no fetch");
 check(restored.openSnapshot(r["id"].toString())&&restored.back(),"internal detail and back");
 page.openSnapshot(r["id"].toString());page.findChild<QPushButton*>("futuresFullDetail")->click();auto detailState=page.saveState();restored.restoreState(detailState);check(restored.findChild<QPlainTextEdit*>("futuresReader")->toPlainText().contains("rawPayload")&&restored.back()&&restored.back(),"full reader exact recreation");
 page.findChild<QPushButton*>("futuresRefresh")->click();page.deliver(token,QJsonArray{},"source failed");check(store.history("IF0").size()==1,"transport failure retains history");
 page.findChild<QPushButton*>("futuresRefresh")->click();page.deliver(token,QJsonArray{QJsonObject{{"symbol","IH0"},{"payload",QString::fromUtf8(payload)},{"receivedAt",now},{"sourceUrl",futuresMonitor::sourceUrl("IH0")}}});check(store.history("IF0").size()==1&&store.history("IH0").isEmpty(),"wrong response cannot enter other identity");
 QByteArray invalidDate="x=([{\"d\":\"2026-02-30 10:02:00\",\"c\":1,\"v\":0,\"p\":0}]);";check(futuresMonitor::parse("IF0",invalidDate,now)["availability"]=="unavailable","strict calendar date");
 auto night=futuresMonitor::parse("IF0",QByteArray(payload).replace("10:01:00","00:01:00").replace("10:02:00","00:02:00"),now);check(night["exchangeTradingDay"].isNull()&&night["sourceDate"]=="2026-10-13","night timestamp never guessed trading day");
 for(int i=0;i<24;i++)store.save(futuresMonitor::parse("IF0",payload,QDateTime::fromString(now,Qt::ISODate).addSecs(i+1).toUTC().toString(Qt::ISODateWithMs)));
 check(store.history("IF0",0).size()==20&&store.history("IF0",20).size()==5,"history pagination exact 20");
 QByteArray large=payload;large.replace("\"o\":\"4000\"","\"o\":\"4000\",\"uninterpreted\":\""+QByteArray(300000,'x')+"\"");auto blob=futuresMonitor::parse("IF0",large,now);store.save(blob);check(store.read(blob["id"].toString())["rawPayload"].toString().toUtf8()==large,"large source/audit stored completely");
 QFile foreign(temp.filePath("shared.sqlite"));foreign.open(QIODevice::WriteOnly);foreign.write("not a module database");foreign.close();rejected=false;try{futuresMonitor::Store wrong(foreign.fileName());wrong.history("IF0");}catch(...){rejected=true;}check(rejected,"foreign database refused");
 puts("PASS futures pure JSONP/null/gap/identity/history/tamper/cancel/Qt page/recreation; fixture-only");return 0;
 }catch(const std::exception&e){fprintf(stderr,"FAIL %s\n",e.what());return 1;}}

