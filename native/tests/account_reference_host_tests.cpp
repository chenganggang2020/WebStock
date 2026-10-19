#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "business_store.hpp"
#include "account_reference_page.hpp"
class AccountReferenceHostTests:public QObject{
 Q_OBJECT
private slots:
 void nativeReadOnly(){
  for(QString layout:{"quotes","classic","focus"}){
   QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   auto cut=QDateTime::currentDateTimeUtc().addSecs(-60);auto local=cut.toOffsetFromUtc(8*3600);auto date=local.date().toString(Qt::ISODate);
   auto accounts=w.businessStore->read("accounts");auto trades=w.businessStore->read("trades");
   w.businessStore->save("trades",QJsonObject{{"id","reference-prior"},{"accountId","local"},{"instrumentId","SH:stock:600000"},{"name","原生参考样本"},{"date",local.date().addDays(-1).toString(Qt::ISODate)},{"side","buy"},{"quantity",100},{"price",10},{"amount",1000},{"fee",0},{"tax",0},{"sourceType","manual"}});
   w.instruments=QJsonArray{QJsonObject{{"id","SH:stock:600000"},{"name","原生参考样本"},{"quote",QJsonObject{{"price",14},{"previousClose",11},{"source","新浪公开报价"},{"tradeDate",date},{"tradeTime",local.time().toString("HH:mm:ss")},{"checkedAt",cut.toString(Qt::ISODateWithMs)},{"cached",false}}}}};
   auto saved=w.businessStore->read("trades");auto roster=w.instruments;
   w.accountView();auto*entry=w.pages["accounts"]->findChild<QPushButton*>("accountOpenReference");QVERIFY(entry);auto*picker=w.pages["accounts"]->findChild<QComboBox*>("ledgerAccount");picker->setCurrentIndex(picker->findData("local"));entry->click();
   auto*page=dynamic_cast<AccountReferencePage*>(w.pages["accountReference"]->findChild<QWidget*>("accountReferencePage"));QVERIFY(page&&page->isVisible());
   auto output=page->frozenOutput();QCOMPARE(output["todayReferencePnl"].toDouble(),300.0);QCOMPARE(output["totalPnlRate"].toDouble(),40.0);QVERIFY(!output["isTwr"].toBool());QVERIFY(!output["isIrr"].toBool());
   auto*table=page->findChild<QTableWidget*>("accountReferenceContributions");QVERIFY(table&&table->rowCount()>0);QTest::mouseClick(table->viewport(),Qt::LeftButton,Qt::NoModifier,table->visualItemRect(table->item(0,0)).center());QVERIFY(page->findChild<QPlainTextEdit*>("accountReferenceDetail")->toPlainText().contains("SH:stock:600000"));
   QCOMPARE(w.businessStore->read("accounts"),accounts);QCOMPARE(w.businessStore->read("trades"),saved);QCOMPARE(w.instruments,roster);
   if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v37-reference-"+layout+".png"));
   auto x=w.instruments[0].toObject();auto q=x["quote"].toObject();q["tradeDate"]=local.date().addDays(-1).toString(Qt::ISODate);x["quote"]=q;w.instruments[0]=x;page->reload();QVERIFY(page->frozenOutput()["todayReferencePnl"].isNull());
   auto*choice=w.pages["accountReference"]->findChild<QComboBox*>("accountReferenceAccount");choice->setCurrentIndex(-1);QVERIFY(page->frozenOutput().isEmpty());
   w.accountReferenceView("local");QVERIFY(!page->frozenOutput().isEmpty());w.home();QVERIFY(!page->isVisible());QCOMPARE(w.businessStore->read("trades"),saved);
  }
 }
};
QTEST_MAIN(AccountReferenceHostTests)
#include "account_reference_host_tests.moc"

