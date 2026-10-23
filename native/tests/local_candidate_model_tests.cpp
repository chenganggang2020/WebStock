#include <QtTest>
#include <QFile>
#include <QJsonDocument>
#include "local_candidate_model.hpp"
class LocalCandidateModelTests:public QObject {
 Q_OBJECT
 QJsonArray cases;
 void compare(const QJsonValue& a,const QJsonValue& b,const QString& path){
  QCOMPARE(a.type(),b.type());
  if(a.isDouble()){QVERIFY2(std::abs(a.toDouble()-b.toDouble())<=1e-12*std::max(1.,std::abs(b.toDouble())),qPrintable(path+QString(" got %1 expected %2").arg(a.toDouble(),0,'g',17).arg(b.toDouble(),0,'g',17)));}
  else if(a.isObject()){QCOMPARE(a.toObject().keys(),b.toObject().keys());for(auto k:a.toObject().keys())compare(a.toObject()[k],b.toObject()[k],path+"/"+k);}
  else if(a.isArray()){QCOMPARE(a.toArray().size(),b.toArray().size());for(int i=0;i<a.toArray().size();i++)compare(a.toArray()[i],b.toArray()[i],path+"/"+QString::number(i));}
  else QCOMPARE(a,b);
 }
 private slots:
 void initTestCase(){QFile f(QFINDTESTDATA("fixtures/local-candidate-golden-v1.json"));QVERIFY(f.open(QIODevice::ReadOnly));cases=QJsonDocument::fromJson(f.readAll()).object()["cases"].toArray();QVERIFY(cases.size()>50);}
 void originalJavaGolden_data(){QTest::addColumn<QJsonObject>("test");for(auto v:cases){auto c=v.toObject();QTest::newRow(qPrintable(c["name"].toString()))<<c;}}
 void frozenInputMatchesOriginalJava(){for(auto v:cases){auto c=v.toObject();if(c.contains("error"))continue;auto got=localCandidate::snapshot(c["selected"].toArray(),c["strategy"].toString(),QDateTime::fromString(c["capturedAt"].toString(),Qt::ISODate));QCOMPARE(localCandidate::canonical(got),c["canonicalInput"].toString().toUtf8());QCOMPARE(localCandidate::digest(got),c["result"].toObject()["inputHash"].toString());}}
 void originalJavaGolden(){QFETCH(QJsonObject,test);auto run=[&]{return localCandidate::evaluate(localCandidate::snapshot(test["selected"].toArray(),test["strategy"].toString(),QDateTime::fromString(test["capturedAt"].toString(),Qt::ISODate)));};if(test.contains("error")){QVERIFY_EXCEPTION_THROWN(run(),std::exception);return;}QJsonObject got;try{got=run();}catch(const std::exception& e){QFAIL(e.what());}compare(got,test["result"],test["name"].toString());QCOMPARE(localCandidate::canonical(got["input"]),test["canonicalInput"].toString().toUtf8());localCandidate::verify(got);}
 void tamperCancelAndCsv(){auto input=cases[9].toObject()["result"].toObject()["input"].toObject();auto r=localCandidate::evaluate(input);auto bad=r;auto rows=bad["rows"].toArray();auto row=rows[0].toObject();row["score"]=1;rows[0]=row;bad["rows"]=rows;QVERIFY_EXCEPTION_THROWN(localCandidate::verify(bad),std::exception);QVERIFY_EXCEPTION_THROWN(localCandidate::evaluate(input,[]{return true;}),std::exception);auto inputs=input["inputs"].toArray();auto s=inputs[0].toObject();s["name"]="  =HYPERLINK(\"x\")\n测试";inputs[0]=s;input["inputs"]=inputs;r=localCandidate::evaluate(input);auto csv=localCandidate::csv(r);QVERIFY(csv.startsWith("\xEF\xBB\xBF"));QVERIFY(csv.contains("\"'  =HYPERLINK(\"\"x\"\")\n"));QVERIFY(csv.contains("非外部证据"));}
 void integerCanonicalIntegrity(){auto a=QJsonDocument::fromJson("{\"volume\":9007199254740992}").object(),b=QJsonDocument::fromJson("{\"volume\":9007199254740993}").object();QVERIFY(a!=b);QVERIFY2(localCandidate::digest(a)!=localCandidate::digest(b),"Different exact 64-bit integer inputs must never share canonical bytes");QCOMPARE(localCandidate::canonical(b),QByteArray("{\"volume\":9007199254740993}"));}
};
QTEST_GUILESS_MAIN(LocalCandidateModelTests)
#include "local_candidate_model_tests.moc"
