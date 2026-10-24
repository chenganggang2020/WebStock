#include <QtTest>
#include <QFile>
#include "cffex_disclosure_model.hpp"
#include "cffex_position_summary.hpp"

namespace {
struct Row { QString type, party, name, quantity, change; };
QJsonObject contract(std::initializer_list<Row> rows,const QString& code="IF2611") {
  QByteArray xml("<root>");QMap<QString,int> ranks;
  for(const auto& row:rows) {
    const auto type=row.type=="long"?"1":row.type=="short"?"2":"0";
    xml+=QString("<data><tradingday>20261023</tradingday><productid>IF</productid>"
                 "<instrumentid>IF2611</instrumentid><datatypeid>%1</datatypeid>"
                 "<rank>%2</rank><shortname>%3</shortname><partyid>%4</partyid>"
                 "<volume>%5</volume><varvolume>%6</varvolume></data>")
      .arg(type).arg(++ranks[row.type]).arg(row.name.toHtmlEscaped(),row.party,
                                         row.quantity,row.change).toUtf8();
  }
  xml+="</root>";xml.replace("IF2611",code.toUtf8());
  const auto query=cffexDisclosure::request("2026-10-23","IF");
  return cffexDisclosure::parse(xml,query,query["url"].toString(),
    "2026-10-24T08:00:00Z","fixture-constructed")["contracts"].toArray().first().toObject();
}
QJsonObject member(const QJsonObject& summary,const QString& key) {
  for(auto value:summary["members"].toArray())
    if(value.toObject()["memberKey"]==key)return value.toObject();
  return {};
}
}

class CffexPositionSummaryTests:public QObject {
  Q_OBJECT
private slots:
  void allProductsDailyTotalsAreChangesNotHoldings(){
    QJsonArray reports;int i=0;
    for(const auto& product:QStringList{"IF","IH","IC","IM"}){
      auto c=i==0?contract({{"long","0018","中信期货","1200","70"},{"short","0018","中信期货","900","-30"},{"long","0020","其他期货","80","-10"},{"short","0020","其他期货","500","20"}}):i==1?contract({{"long","0018","中信期货","800","-20"},{"short","0018","中信期货","1500","50"}}):i==2?contract({{"long","0018","中信期货","300","0"},{"short","0018","中信期货","600","0"}}):contract({{"long","0018","中信期货","400","5"},{"short","0018","中信期货","500","8"}});
      c["product"]=product;c["contract"]=product+"2611";
      reports.append(QJsonObject{{"request",QJsonObject{{"date","2026-10-23"},{"product",product}}},{"contracts",QJsonArray{c}}});++i;
    }
    auto total=cffexDisclosure::dailyPositionTotals(reports);auto citic=total["citic"].toObject(),listed=total["listed"].toObject();
    QCOMPARE(total["products"].toArray().size(),4);QVERIFY(total["allProducts"].toBool());QCOMPARE(total["contracts"].toInt(),4);
    QCOMPARE(citic["longChange"].toDouble(),55.);QCOMPARE(citic["shortChange"].toDouble(),28.);QCOMPARE(citic["netChange"].toDouble(),27.);QCOMPARE(citic["net"].toDouble(),-800.);
    QCOMPARE(listed["longChange"].toDouble(),45.);QCOMPARE(listed["shortChange"].toDouble(),48.);QCOMPARE(listed["netChange"].toDouble(),-3.);
    QCOMPARE(cffexDisclosure::dailyChangeLabel(citic["netChange"]),QString("净增多 27 手"));QCOMPARE(cffexDisclosure::dailyChangeLabel(listed["netChange"]),QString("净增空 3 手"));
    auto partial=cffexDisclosure::dailyPositionTotals({reports[0]});QVERIFY(!partial["allProducts"].toBool());QCOMPARE(partial["citic"].toObject()["netChange"].toDouble(),100.);
    QVERIFY_EXCEPTION_THROWN(cffexDisclosure::dailyPositionTotals({reports[0],reports[0]}),std::runtime_error);
    auto other=reports[1].toObject();other["request"]=QJsonObject{{"date","2026-10-22"},{"product","IH"}};
    QVERIFY_EXCEPTION_THROWN(cffexDisclosure::dailyPositionTotals({reports[0],other}),std::runtime_error);
  }
  void dailyTotalsKeepMissingValuesAndCoverage(){
    const auto full=contract({{"long","0018","中信期货","1200","70"},{"short","0018","中信期货","900","-30"}});
    const auto missing=contract({{"long","0018","中信期货","300","--"},{"short","0018","中信期货","500","10"}},"IF2612");
    const auto oneSide=contract({{"long","0018","中信期货","300","10"}},"IF2703");
    auto result=cffexDisclosure::dailyPositionTotals({QJsonObject{{"request",QJsonObject{{"date","2026-10-23"},{"product","IF"}}},{"contracts",QJsonArray{full,missing,oneSide}}}});
    auto citic=result["citic"].toObject();QCOMPARE(citic["covered"].toInt(),2);QCOMPARE(citic["net"].toDouble(),100.);QVERIFY(citic["longChange"].isNull());QVERIFY(citic["netChange"].isNull());QVERIFY(result["listed"].toObject()["netChange"].isNull());
    QCOMPARE(cffexDisclosure::dailyChangeLabel(citic["netChange"]),QString("当日净增减未知"));
  }
  void conflictingCiticNameWithinSameIdentityIsUnknown(){
    const auto result=cffexDisclosure::positionSummary(contract({{"long","0018","中信期货","1000","50"},{"short","0018","其他期货","900","20"}}));
    QVERIFY(result["citic"].toObject()["net"].isNull());QVERIFY(result["citic"].toObject()["netChange"].isNull());QVERIFY(!result["citic"].toObject()["complete"].toBool());
  }
  void listedTotalsAndCiticAreDifferentScopes() {
    const auto result=cffexDisclosure::positionSummary(contract({
      {"long","0018","中信期货(代客)","1200","70"},
      {"short","0018","中信期货(代客)","900","-30"},
      {"long","0020","其他期货","80","-10"},
      {"short","0020","其他期货","500","20"},
      {"turnover","0018","中信期货(代客)","999999","999999"}}));
    QCOMPARE(result["listedLong"].toDouble(),1280.);
    QCOMPARE(result["listedShort"].toDouble(),1400.);
    QCOMPARE(result["net"].toDouble(),-120.);
    QCOMPARE(result["netChange"].toDouble(),70.);
    const auto citic=result["citic"].toObject();
    QVERIFY(citic["complete"].toBool());
    QCOMPARE(citic["long"].toDouble(),1200.);
    QCOMPARE(citic["short"].toDouble(),900.);
    QCOMPARE(citic["net"].toDouble(),300.);
    QCOMPARE(citic["netChange"].toDouble(),100.);
    QCOMPARE(result["members"].toArray().size(),2);
  }
  void negativeNetChangeMeansNetShortIncreases() {
    const auto result=cffexDisclosure::positionSummary(contract({
      {"long","0018","中信期货有限公司","1000","-100"},
      {"short","0018","中信期货有限公司","1600","200"}}));
    const auto citic=result["citic"].toObject();
    QCOMPARE(citic["net"].toDouble(),-600.);
    QCOMPARE(citic["netChange"].toDouble(),-300.);
    QCOMPARE(citic["longChange"].toDouble(),-100.);
    QCOMPARE(citic["shortChange"].toDouble(),200.);
    // Net change = change of long minus change of short, not either raw side.
    QCOMPARE(citic["net"].toDouble()-citic["netChange"].toDouble(),-300.);
  }
  void missingSideIsUnknownEvenWhenOtherMembersHaveBothSides() {
    const auto result=cffexDisclosure::positionSummary(contract({
      {"long","0018","中信期货（代客）","1000","50"},
      {"long","0020","其他期货","100","10"},
      {"short","0020","其他期货","500","20"}}));
    QCOMPARE(result["net"].toDouble(),600.);
    const auto citic=result["citic"].toObject();
    QVERIFY(!citic["complete"].toBool());
    QCOMPARE(citic["long"].toDouble(),1000.);
    QVERIFY(citic["short"].isNull());
    QVERIFY(citic["net"].isNull());
    QVERIFY(citic["netChange"].isNull());
    const auto row=member(result,"party:0018");QVERIFY(!row.isEmpty());
    QVERIFY(row["short"].isNull());QVERIFY(row["net"].isNull());
  }
  void sameNameDifferentPartyIdsCannotCancelEachOther() {
    const auto result=cffexDisclosure::positionSummary(contract({
      {"long","0018","中信期货(代客)","1000","50"},
      {"short","0099","中信期货(代客)","900","-10"},
      {"long","0115","中信建投(代客)","6000","600"},
      {"short","0115","中信建投(代客)","2000","100"}}));
    const auto citic=result["citic"].toObject();
    QVERIFY(!citic["complete"].toBool());
    QVERIFY(citic["net"].isNull());QVERIFY(citic["netChange"].isNull());
    const auto longOnly=member(result,"party:0018"),shortOnly=member(result,"party:0099");
    QVERIFY(!longOnly.isEmpty()&&!shortOnly.isEmpty());
    QVERIFY(longOnly["net"].isNull());QVERIFY(shortOnly["net"].isNull());
    QCOMPARE(member(result,"party:0115")["net"].toDouble(),4000.);
    QCOMPARE(result["members"].toArray().size(),3);
  }
  void legitimateZeroAndMissingChangeRemainDistinct() {
    const auto result=cffexDisclosure::positionSummary(contract({
      {"long","0018","中信期货（自营）","0","0"},
      {"short","0018","中信期货（自营）","0","0"},
      {"long","0020","其他期货","10","--"},
      {"short","0020","其他期货","10","1"}}));
    QVERIFY(result["net"].isDouble());QCOMPARE(result["net"].toDouble(),0.);
    QVERIFY(result["netChange"].isNull());
    const auto citic=result["citic"].toObject();QVERIFY(citic["complete"].toBool());
    QVERIFY(citic["net"].isDouble());QCOMPARE(citic["net"].toDouble(),0.);
    QVERIFY(citic["netChange"].isDouble());QCOMPARE(citic["netChange"].toDouble(),0.);
    QVERIFY(member(result,"party:0020")["netChange"].isNull());
  }
  void capturedOfficialCiticRowsMatchEachContract() {
    QFile source(qEnvironmentVariable("NATIVE_CFFEX_CAPTURED_FIXTURE"));
    QVERIFY2(source.open(QIODevice::ReadOnly),"Set NATIVE_CFFEX_CAPTURED_FIXTURE to official captured 2026-10-23 IF XML");
    const auto raw=source.readAll();
    QCOMPARE(cffexDisclosure::hash(raw),QString("13ecebe8d0fb3b9ff7a0decf999aa7f24a9c7d5b71da239fd3d60bd7c8ad6842"));
    const auto query=cffexDisclosure::request("2026-10-23","IF");
    const auto report=cffexDisclosure::parse(raw,query,cffexDisclosure::publicUrl(query),
      "2026-10-24T08:00:00Z","import-unverified");
    const QList<QList<double>> expected{{8556,8738,-428,212,-182,-640},
      {24295,37924,926,-791,-13629,1717},{5205,14419,833,393,-9214,440},
      {1536,3070,345,585,-1534,-240}};
    const QStringList fields{"long","short","longChange","shortChange","net","netChange"};
    const auto contracts=report["contracts"].toArray();QCOMPARE(contracts.size(),expected.size());
    for(int n=0;n<contracts.size();++n) {
      const auto result=cffexDisclosure::positionSummary(contracts[n].toObject());
      const auto citic=result["citic"].toObject();QVERIFY(citic["complete"].toBool());
      for(int k=0;k<fields.size();++k) {
        QVERIFY2(citic[fields[k]].isDouble(),qPrintable(fields[k]));
        QCOMPARE(citic[fields[k]].toDouble(),expected[n][k]);
      }
      QCOMPARE(member(result,"party:0018")["net"],citic["net"]);
    }
  }
  void capturedProductTotalEqualsFourDisclosedCiticContracts() {
    QFile source(qEnvironmentVariable("NATIVE_CFFEX_CAPTURED_FIXTURE"));
    QVERIFY(source.open(QIODevice::ReadOnly));
    const auto query=cffexDisclosure::request("2026-10-23","IF");
    const auto report=cffexDisclosure::parse(source.readAll(),query,cffexDisclosure::publicUrl(query),
      "2026-10-24T08:00:00Z","import-unverified");
    const auto result=cffexDisclosure::citicProductSummary(report);
    QCOMPARE(result["net"].toDouble(),-24559.);
    QCOMPARE(result["netChange"].toDouble(),1277.);
    QCOMPARE(result["completeContracts"].toInt(),4);
    QCOMPARE(result["totalContracts"].toInt(),4);
  }
  void productCoverageCannotTurnMissingContractsOrChangesIntoZero() {
    const auto first=contract({{"long","0018","中信期货","1200","70"},
      {"short","0018","中信期货","900","-30"}},"IF2611");
    const auto oneSided=contract({{"long","0018","中信期货","400","50"}},"IF2612");
    const auto partial=cffexDisclosure::citicProductSummary({{"contracts",QJsonArray{first,oneSided}}});
    // A partial sum is meaningful only together with explicit 1/2 coverage.
    QCOMPARE(partial["net"].toDouble(),300.);
    QCOMPARE(partial["netChange"].toDouble(),100.);
    QCOMPARE(partial["completeContracts"].toInt(),1);
    QCOMPARE(partial["totalContracts"].toInt(),2);
    const auto missingChange=contract({{"long","0018","中信期货","500","--"},
      {"short","0018","中信期货","400","20"}},"IF2703");
    const auto unknownChange=cffexDisclosure::citicProductSummary({{"contracts",QJsonArray{first,missingChange}}});
    QCOMPARE(unknownChange["net"].toDouble(),400.);
    QVERIFY(unknownChange["netChange"].isNull());
    QCOMPARE(unknownChange["completeContracts"].toInt(),2);
    const auto unavailable=cffexDisclosure::citicProductSummary({{"contracts",QJsonArray{oneSided}}});
    QVERIFY(unavailable["net"].isNull());QVERIFY(unavailable["netChange"].isNull());
    QCOMPARE(unavailable["completeContracts"].toInt(),0);
    QCOMPARE(unavailable["totalContracts"].toInt(),1);
  }
  void validSourceIntegersCannotProduceUnsafeAggregateNumbers() {
    const auto source=contract({
      {"long","0018","中信期货","9007199254740000","9007199254740000"},
      {"short","0018","中信期货","0","-9007199254740000"},
      {"long","0020","其他期货","9007199254740000","0"},
      {"short","0020","其他期货","0","0"}});
    QVERIFY(source["listedLong"].isNull());
    const auto result=cffexDisclosure::positionSummary(source);
    QVERIFY(result["listedLong"].isNull());
    QVERIFY(result["net"].isNull());
    QVERIFY(result["netChange"].isNull());
    QVERIFY(result["citic"].toObject()["netChange"].isNull());
    const auto another=contract({
      {"long","0018","中信期货","9007199254740000","0"},
      {"short","0018","中信期货","0","0"}},"IF2612");
    const auto product=cffexDisclosure::citicProductSummary({{"contracts",QJsonArray{source,another}}});
    QVERIFY(product["net"].isNull());
    QCOMPARE(product["completeContracts"].toInt(),2);
  }
};
QTEST_GUILESS_MAIN(CffexPositionSummaryTests)
#include "cffex_position_summary_tests.moc"
