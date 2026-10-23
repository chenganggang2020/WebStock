#include <QtTest>
#include <QTableWidget>
#include <QComboBox>
#include <QLabel>
#include <QPushButton>
#include <QDateEdit>
#include <QFile>
#include <QCryptographicHash>
#include "rotation_page.hpp"
#include "dark_rotation.hpp"
class RotationLiveTests:public QObject {
 Q_OBJECT
 private slots:
 void actualOldModelParity(){
   auto out=qEnvironmentVariable("ROTATION_OUTPUT"),input=qEnvironmentVariable("ROTATION_OLD_FILE");QVERIFY(!out.isEmpty()&&!input.isEmpty());
   darkRotation::Store store(out+"/parity.sqlite");store.importFile(input);QFile f(out+"/old-model-oracle.json");QVERIFY(f.open(QIODevice::ReadOnly));auto cases=QJsonDocument::fromJson(f.readAll()).object()["cases"].toArray();QCOMPARE(cases.size(),18);
   QMap<QString,QJsonArray> scopes;for(QString scope:{"industry","concept"})scopes[scope]=store.read("2026-10-09",scope,false);
   for(auto v:cases){auto expected=v.toObject();auto data=scopes[expected["scope"].toString()];QElapsedTimer elapsed;elapsed.start();auto actual=darkRotation::analyze(data,expected["field"].toString(),expected["minutes"].toInt(),expected["now"].toString());qInfo()<<expected["scope"].toString()<<expected["field"].toString()<<expected["minutes"].toInt()<<elapsed.elapsed()<<"ms";QCOMPARE(actual["eligible"],expected["eligible"]);QCOMPARE(actual["windowEndAt"],expected["windowEndAt"]);
     QMap<QString,QJsonObject> rows;for(auto r:actual["rows"].toArray())rows[r.toObject()["code"].toString()]=r.toObject();
     for(auto r:expected["rows"].toArray()){auto e=r.toObject(),a=rows[e["code"].toString()];for(auto key:e.keys()){if(e[key].isDouble())QVERIFY2(qAbs(e[key].toDouble()-a[key].toDouble())<1e-7*std::max(1.,qAbs(e[key].toDouble())),qPrintable(key));else QCOMPARE(a[key],e[key]);}}
     for(auto key:QStringList{"inflow","outflow","accelerating","decelerating"}){QJsonArray codes;for(auto r:actual[key].toArray())codes.append(r.toObject()["code"]);QCOMPARE(codes,expected[key].toArray());}
   }
 }
 void oldFilesAndNativeControls(){
   auto out=qEnvironmentVariable("ROTATION_OUTPUT"),input=qEnvironmentVariable("ROTATION_OLD_FILE"),day=qEnvironmentVariable("ROTATION_OLD_DAY");QVERIFY(!out.isEmpty()&&!input.isEmpty()&&!day.isEmpty());
   QFile source(input);QVERIFY(source.open(QIODevice::ReadOnly));auto before=QCryptographicHash::hash(source.readAll(),QCryptographicHash::Sha256);source.close();
   RotationPage page(out+"/real-rotation.sqlite",false);page.resize(1440,900);page.show();
   auto* table=page.findChild<QTableWidget*>("rotationTable");auto* state=page.findChild<QLabel*>("rotationState");
   page.importArchive(input);QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),71,60000);QCOMPARE(page.findChild<QDateEdit*>("rotationDate")->date(),QDate(2026,10,9));
   QTRY_VERIFY(state->text().contains("216/216"));table->selectRow(0);QVERIFY(page.findChild<QLabel*>("rotationDetail")->text().contains("2026-10-09"));QApplication::processEvents();QVERIFY(page.grab().save(out+"/windows-rotation-industry.png"));
   page.findChild<QComboBox*>("rotationScope")->setCurrentIndex(1);QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),342,30000);QVERIFY(state->text().contains("178/178"));QApplication::processEvents();QVERIFY(page.grab().save(out+"/windows-rotation-concept.png"));
   page.importArchive(day);QTRY_VERIFY_WITH_TIMEOUT(!state->text().contains("后台")&&!state->text().contains("读取"),30000);
   page.findChild<QComboBox*>("rotationScope")->setCurrentIndex(0);page.findChild<QComboBox*>("rotationKind")->setCurrentIndex(1);page.findChild<QDateEdit*>("rotationDate")->setDate(QDate(2026,10,8));QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),71,30000);QVERIFY(page.findChild<QLabel*>("rotationDetail")->text().contains("不足"));
   QVERIFY(source.open(QIODevice::ReadOnly));QCOMPARE(QCryptographicHash::hash(source.readAll(),QCryptographicHash::Sha256),before);
 }
 void explicitOldSourceOnce(){
   auto out=qEnvironmentVariable("ROTATION_OUTPUT");QVERIFY(!out.isEmpty());RotationPage page(out+"/qt-direct-source.sqlite",true);page.resize(1440,900);page.show();
   auto* table=page.findChild<QTableWidget*>("rotationTable");auto* state=page.findChild<QLabel*>("rotationState");auto* refresh=page.findChild<QPushButton*>("rotationRefresh");
   QTRY_VERIFY(!state->text().contains("读取"));page.findChild<QComboBox*>("rotationKind")->setCurrentIndex(1);page.findChild<QDateEdit*>("rotationDate")->setDate(QDate(2026,10,9));QTRY_VERIFY(!state->text().contains("读取"));
   refresh->click();QTRY_VERIFY_WITH_TIMEOUT(refresh->isEnabled(),60000);QTRY_VERIFY_WITH_TIMEOUT(!state->text().contains("读取"),15000);
   QJsonObject receipt{{"attempted",true},{"platform","Qt native"},{"checkedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"requestedDate","2026-10-09"},{"rows",table->rowCount()},{"sourceClockKnown",false},{"realtimeVerified",false},{"state",state->text()}};
   QFile f(out+"/qt-direct-source.json");QVERIFY(f.open(QIODevice::WriteOnly));f.write(QJsonDocument(receipt).toJson());f.close();QApplication::processEvents();QVERIFY(page.grab().save(out+"/windows-rotation-source.png"));
   QVERIFY(table->rowCount()==71||state->text().contains("未更新"));
 }
};
QTEST_MAIN(RotationLiveTests)
#include "rotation_live_tests.moc"
