#include <QtTest>
#include "sector_watch_model.hpp"
using namespace sectorWatch;
namespace {
const QString start="2026-10-12T01:30:00.000Z",end="2026-10-12T01:30:01.000Z";
QJsonObject board(QString code="BK0001"){return {{"f12",code},{"f14","测试板块"},{"f2",100.},{"f3",0.},{"f6",0.},{"f62",QJsonValue::Null}};}
QJsonObject member(QString code="600000",int market=1){return {{"f12",code},{"f13",market},{"f14","测试股票"},{"f2",10.},{"f3",0.},{"f6",0.},{"f62",QJsonValue::Null}};}
QJsonObject raw(QJsonArray rows,int total){return {{"rc",0},{"data",QJsonObject{{"total",total},{"diff",rows}}}};}
QJsonObject result(){Assembly a(query("eastmoney-public-board","industry"),start);a.appendEastmoney(raw({board()},1),1,1000);return a.finish(end,1000);}
}
class SectorWatchModelTests:public QObject {
 Q_OBJECT
 private slots:
 void identities(){QCOMPARE(queryKey(query("eastmoney-public-board","industry","BK0001")),QString("eastmoney-public-board|industry|BK0001"));QVERIFY(queryKey(query("eastmoney-public-board","concept","BK0001"))!=queryKey(query("eastmoney-public-board","industry","BK0001")));QVERIFY_EXCEPTION_THROWN(query("sina-public-industry","concept","sw2_1101"),std::exception);QVERIFY_EXCEPTION_THROWN(query("eastmoney-public-board","style"),std::exception);QVERIFY_EXCEPTION_THROWN(query("eastmoney-public-board","industry","https://other"),std::exception);}
 void completeAndNull(){auto s=result();validate(s);QVERIFY(s["coverageComplete"].toBool());QVERIFY(s["quoteComplete"].toBool());auto row=s["items"].toArray()[0].toObject();QCOMPARE(row["changePct"].toDouble(),0.);QCOMPARE(row["amount"].toDouble(),0.);QVERIFY(row["mainNetInflow"].isNull());QVERIFY(s["observedAt"].isNull());}
 void pagesAndDuplicate(){Assembly a(query("eastmoney-public-board","concept"),start);QVERIFY(!a.appendEastmoney(raw({board()},2),1,100));QVERIFY_EXCEPTION_THROWN(a.appendEastmoney(raw({board()},2),2,200),std::exception);QVERIFY(!a.finish(end,1000,"重复页")["coverageComplete"].toBool());QVERIFY(a.appendEastmoney(raw({board("BK0002")},2),2,300));QCOMPARE(a.finish(end,1000)["items"].toArray().size(),2);}
 void totalChangeAndDeadline(){Assembly a(query("eastmoney-public-board","industry"),start);a.appendEastmoney(raw({board()},2),1,100);QVERIFY_EXCEPTION_THROWN(a.appendEastmoney(raw({board("BK0002")},3),2,200),std::exception);QVERIFY_EXCEPTION_THROWN(a.appendEastmoney(raw({board("BK0002")},2),2,8001),std::exception);QVERIFY(!a.finish("2026-10-12T01:30:09Z",9000,"总截止")["coverageComplete"].toBool());}
 void sourceIdentity(){Assembly a(query("eastmoney-public-board","industry","BK0001"),start);auto unknown=member("830001",0);a.appendEastmoney(raw({member(),member("000001",0),unknown},3),1,100);auto rows=a.finish(end,1000)["items"].toArray();QCOMPARE(rows[0].toObject()["id"].toString(),QString("SH:stock:600000"));QCOMPARE(rows[1].toObject()["id"].toString(),QString("SZ:stock:000001"));QVERIFY(rows[2].toObject()["id"].isNull());QVERIFY(!rows[2].toObject()["canOpen"].toBool());}
 void quoteCoverageSeparate(){auto r=board();r.remove("f2");r.remove("f3");r.remove("f6");Assembly a(query("eastmoney-public-board","industry"),start);a.appendEastmoney(raw({r},1),1,100);auto s=a.finish(end,1000);QVERIFY(s["coverageComplete"].toBool());QVERIFY(!s["quoteComplete"].toBool());QVERIFY(s["items"].toArray()[0].toObject()["price"].isNull());}
 void missingSortLast(){QJsonArray rows{QJsonObject{{"key","a"},{"changePct",QJsonValue::Null}},QJsonObject{{"key","b"},{"changePct",-1.}},QJsonObject{{"key","c"},{"changePct",0.}}};auto sortedRows=sorted(rows,"changePct");QCOMPARE(sortedRows[0].toObject()["key"].toString(),QString("c"));QCOMPARE(sortedRows[2].toObject()["key"].toString(),QString("a"));}
 void sinaFullMarketIdentity(){Assembly a(query("sina-public-concept","concept","gn_test"),start);QJsonArray rows{QJsonObject{{"symbol","bj830001"},{"code","830001"},{"name","北交测试"},{"trade","10"},{"changepercent","0"},{"amount","0"}}};QVERIFY(a.appendSina(rows,1,1,100));auto s=a.finish(end,1000);validate(s);QCOMPARE(s["items"].toArray()[0].toObject()["id"].toString(),QString("BJ:stock:830001"));QVERIFY(s["items"].toArray()[0].toObject()["mainNetInflow"].isNull());}
 void sinaTaxonomy(){QJsonArray tree{QJsonArray{"申万二级",QJsonArray{QJsonArray{"半导体","","sw2_801080"}},"","sw2_hy","cn"},QJsonArray{"热门概念",QJsonArray{QJsonArray{"测试概念","","chgn_100"}},"","ch_gn","cn"}};auto s=sinaCatalog(tree,"concept",start,end);validate(s);QCOMPARE(s["items"].toArray().size(),1);QCOMPARE(s["items"].toArray()[0].toObject()["code"].toString(),QString("chgn_100"));QVERIFY(s["coverageComplete"].toBool());QVERIFY(!s["quoteComplete"].toBool());}
 void validationAndCsv(){auto s=result();auto bad=s;bad["query"]=query("eastmoney-public-board","concept");QVERIFY_EXCEPTION_THROWN(validate(bad),std::exception);bad=s;bad["observedAt"]=end;QVERIFY_EXCEPTION_THROWN(validate(bad),std::exception);auto bytes=csv(s);QVERIFY(bytes.startsWith("\xEF\xBB\xBF"));QVERIFY(bytes.contains("provider"));}
 void sinaInvalidLeafCannotBecomeComplete(){QJsonArray tree{QJsonArray{"热门概念",QJsonArray{QJsonArray{"有效","","chgn_100"},QJsonArray{"来源新增未知代码","","unknown_200"}},"","ch_gn","cn"}};QVERIFY_EXCEPTION_THROWN(sinaCatalog(tree,"concept",start,end),std::exception);}
};
QTEST_GUILESS_MAIN(SectorWatchModelTests)
#include "sector_watch_model_tests.moc"
