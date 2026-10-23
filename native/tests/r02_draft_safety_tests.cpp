#include <QtTest>
#include <QtWidgets>
#include "account_edit_page.hpp"
#include "business_pages.hpp"

class R02DraftSafetyTests: public QObject {
 Q_OBJECT
private slots:
 void ledgerDisplaysCodesWithoutChangingIdentityOrData() {
  QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
  const QStringList ids{"SH:stock:600183","SZ:stock:000070","SH:etf:510300"};
  QJsonArray roster;
  for(const auto& id:ids){
   store->save("trades",{{"accountId","local"},{"instrumentId",id},{"name","隔离测试证券"},
    {"date","2026-10-21"},{"side","buy"},{"quantity",100},{"price",10.0}});
   // Leave one holding out of the roster to exercise the existing-record editor fallback.
   if(id!=ids[1])roster.append(QJsonObject{{"id",id},{"name","隔离测试证券"},{"symbol","sh"+id.section(':',2,2)}});
  }
  const auto saved=store->read("trades");const auto accounts=store->read("accounts");
  QString opened;
  std::unique_ptr<QWidget> page(portfolioPage(store,false,[=]{return roster;},[&](QString id){opened=id;},nullptr));
  page->resize(1400,800);page->show();QTRY_VERIFY_WITH_TIMEOUT(page->property("ledgerReady").toBool(),10000);
  auto positions=page->findChild<QTableWidget*>("positionTable");
  auto trades=page->findChild<QTableWidget*>("tradeTable");
  auto symbols=page->findChild<QComboBox*>("tradeInstrument");
  QCOMPARE(positions->rowCount(),3);QCOMPARE(trades->rowCount(),3);
  if(!qEnvironmentVariable("LEDGER_LABEL_SCREENSHOT").isEmpty())
   QVERIFY(page->grab().save(qEnvironmentVariable("LEDGER_LABEL_SCREENSHOT")));
  for(int r=0;r<positions->rowCount();++r){
   auto raw=positions->item(r,0)->data(Qt::UserRole).toJsonObject();
   QVERIFY(ids.contains(raw["instrumentId"].toString()));
   QCOMPARE(positions->item(r,0)->text(),raw["instrumentId"].toString().section(':',2,2));
   QCOMPARE(positions->item(r,1)->text(),QString("隔离测试证券"));
   QCOMPARE(positions->item(r,2)->text(),QString("100.00"));
   QCOMPARE(positions->item(r,3)->text(),QString("1000.00"));
   QVERIFY(QMetaObject::invokeMethod(positions,"cellDoubleClicked",Qt::DirectConnection,Q_ARG(int,r),Q_ARG(int,0)));
   QCOMPARE(opened,raw["instrumentId"].toString());
  }
  page->findChild<QTabWidget*>("ledgerViews")->setCurrentIndex(1);
  for(int r=0;r<trades->rowCount();++r){
   auto raw=trades->item(r,1)->data(Qt::UserRole).toJsonObject();
   auto id=raw["instrumentId"].toString();
   QCOMPARE(trades->item(r,1)->text(),id.section(':',2,2));
   QVERIFY(QMetaObject::invokeMethod(trades,"cellClicked",Qt::DirectConnection,Q_ARG(int,r),Q_ARG(int,1)));
   QCOMPARE(symbols->currentData().toString(),id);
   QCOMPARE(symbols->currentText(),QString("隔离测试证券 ")+id.section(':',2,2));
   QCOMPARE(page->findChild<QDoubleSpinBox*>("tradeQuantity")->value(),100.0);
  }
  QCOMPARE(store->read("trades"),saved);QCOMPARE(store->read("accounts"),accounts);
  preparePortfolioClose(page.get());
 }
 void accountReloadPreservesDraftAndIdentity() {
  QJsonArray rows{QJsonObject{{"id","account-a"},{"type","ledger"},{"name","A"}},QJsonObject{{"id","account-b"},{"type","ledger"},{"name","B"}}};
  int writes=0;AccountEditPage page({[&]{return rows;},[&](auto,auto candidate){++writes;return candidate;},true});
  auto choice=page.findChild<QComboBox*>("accountEditChoice");
  choice->setCurrentIndex(choice->findData("account-b"));
  auto name=page.findChild<QLineEdit*>("accountEditName");name->setText("B unsaved");
  auto before=page.saveState();page.reload();
  QCOMPARE(page.saveState(),before);QCOMPARE(writes,0);
  page.cancel();page.reload();QCOMPARE(choice->currentData().toString(),QString("account-b"));
  QCOMPARE(name->text(),QString("B"));
 }
 void ledgerAccountSwitchDoesNotCarryOrLoseDraft() {
  for(bool paper:{false,true}) {
   QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
   auto accounts=store->read("accounts");QString a;
   for(auto value:accounts){auto row=value.toObject();if((row["type"]=="paper")==paper){a=row["id"].toString();break;}}
   QVERIFY(!a.isEmpty());auto b=store->save("accounts",{{"name","second"},{"type",paper?"paper":"ledger"}})["id"].toString();
   QJsonArray roster{QJsonObject{{"id","SH:stock:600000"},{"name","sample"},{"symbol","600000"}}};
   std::unique_ptr<QWidget> page(portfolioPage(store,paper,[=]{return roster;},[](QString){},nullptr));
   page->show();QTRY_VERIFY_WITH_TIMEOUT(page->property("ledgerReady").toBool(),10000);
   auto picker=page->findChild<QComboBox*>("ledgerAccount");picker->setCurrentIndex(picker->findData(a));
   QTest::qWait(60);auto note=page->findChild<QLineEdit*>("tradeNote");auto quantity=page->findChild<QDoubleSpinBox*>("tradeQuantity");
   note->setText("private draft A");quantity->setValue(321);
   auto saved=store->read("trades");picker->setCurrentIndex(picker->findData(b));
   QCOMPARE(picker->currentData().toString(),a);QCOMPARE(note->text(),QString("private draft A"));QCOMPARE(quantity->value(),321.0);
   QCOMPARE(store->read("trades"),saved);
  }
 }
};
QTEST_MAIN(R02DraftSafetyTests)
#include "r02_draft_safety_tests.moc"
