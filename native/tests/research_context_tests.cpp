#include <QtTest>
#include "research_context.hpp"
class ResearchContextTests:public QObject {
 Q_OBJECT
 private slots:
 void exactBindingsOnly() {
  const QString id="SH:stock:600001", quote="甲公司 SH:stock:600001 主营设备";
  QJsonObject row{{"id",id},{"quote",QJsonObject{{"price",10.1},{"tradeDate","2026-10-11"}}}};
  QJsonObject doc{{"id","doc"},{"text",quote},{"verification","unverified"}};
  QJsonObject relation{{"id","r"},{"documentId","doc"},{"quote","主营设备"},
    {"verification","candidate"},{"company",QJsonObject{{"name","甲公司"},{"instrumentId",id},
      {"identityDocumentId","doc"},{"identityQuote",quote}}}};
  auto result=researchContext::snapshot(id,{row},{doc},{relation});
  QCOMPARE(result["documents"].toArray(),QJsonArray{doc});
  QCOMPARE(result["researchBindings"].toArray(),QJsonArray{relation});
  QCOMPARE(result["quote"],row["quote"]);
  auto bare=relation, company=relation["company"].toObject();company["instrumentId"]="600001";bare["company"]=company;
  QCOMPARE(researchContext::snapshot(id,{row},{doc},{bare})["documents"].toArray().size(),0);
  auto changed=doc;changed["text"]="原文已变";
  result=researchContext::snapshot(id,{row},{changed},{relation});
  QCOMPARE(result["documents"].toArray().size(),0);
  QCOMPARE(result["bindingWarnings"].toArray().size(),1);
  QVERIFY_EXCEPTION_THROWN(researchContext::snapshot("SZ:stock:000001",{row},{doc},{relation}),std::runtime_error);
  QVERIFY_EXCEPTION_THROWN(researchContext::snapshot(id,{row,row},{doc},{relation}),std::runtime_error);
  QCOMPARE(doc["verification"].toString(),QString("unverified"));
 }
};
QTEST_APPLESS_MAIN(ResearchContextTests)
#include "research_context_tests.moc"
