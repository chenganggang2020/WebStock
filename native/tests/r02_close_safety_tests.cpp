#include <QtTest>
#include <QtWidgets>
#include <QtSql>
#include "window.hpp"
#include "account_edit_page.hpp"
#include "source_plans_page.hpp"
#include "recent_page.hpp"
#include "recent_store.hpp"
class R02CloseSafetyTests:public QObject {
 Q_OBJECT
private slots:
 void failedAccountRestoreCannotDiscardNewDraft(){
  QTemporaryDir dir;const auto path=dir.filePath("settings.ini");const QByteArray bad="{bad original state}";
  {QSettings settings(path,QSettings::IniFormat);settings.setValue("accountEdit/state",bad);settings.sync();}
  Window w(true,path,dir.path());w.show();w.accountEditView();
  auto page=dynamic_cast<AccountEditPage*>(w.pages.value("accountEdit"));QVERIFY(page);QVERIFY(w.accountEditStateFailed);
  page->findChild<QLineEdit*>("accountEditName")->setText("new draft after restore failure");const auto draft=page->saveState();
  const auto accounts=w.businessStore->read("accounts");
  w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.persistenceClosing,5000);
  QVERIFY(w.isVisible());QVERIFY(!w.persistenceCloseReady);QVERIFY(w.centralWidget()->isEnabled());
  QCOMPARE(page->saveState(),draft);QCOMPARE(w.businessStore->read("accounts"),accounts);
  {QSettings saved(path,QSettings::IniFormat);QCOMPARE(saved.value("accountEdit/state").toByteArray(),bad);}
  page->findChild<QPushButton*>("accountEditCancel")->click();w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);
  QSettings saved(path,QSettings::IniFormat);QCOMPARE(saved.value("accountEdit/state").toByteArray(),bad);
 }
 void recentLedgerPrefillKeepsUncommittedTrade(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.show();w.accountView();
  auto page=w.pages.value("accounts");auto ledger=page->findChild<QWidget*>("portfolioPage");QVERIFY(ledger);
  QTRY_VERIFY(ledger->property("ledgerReady").toBool());
  auto note=page->findChild<QLineEdit*>("tradeNote");auto quantity=page->findChild<QDoubleSpinBox*>("tradeQuantity");
  auto symbols=page->findChild<QComboBox*>("tradeInstrument");QVERIFY(symbols&&symbols->count());
  note->setText("retain manual ledger draft");quantity->setValue(321);auto original=symbols->currentData();
  auto trades=w.businessStore->read("trades");QJsonObject target;
  for(auto value:w.instruments){auto row=value.toObject();if(row["id"].toString().contains(":stock:")){target=row;break;}}
  QVERIFY(!target.isEmpty());w.recentStore->recordView(target);w.recentView();
  auto recent=qobject_cast<RecentPage*>(w.pages.value("recent"));QVERIFY(recent);
  QTRY_VERIFY(recent->property("recentSnapshotReady").toBool()&&!recent->property("recentReadPending").toBool());
  recent->findChild<QTableWidget*>("recentTable")->selectRow(0);
  auto action=recent->findChild<QPushButton*>("recentLedger");QVERIFY(action&&action->isEnabled());action->click();
  QCOMPARE(note->text(),QString("retain manual ledger draft"));QCOMPARE(quantity->value(),321.0);
  QCOMPARE(symbols->currentData(),original);QCOMPARE(w.businessStore->read("trades"),trades);
  page->findChild<QPushButton*>("newTrade")->click();w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);
 }
 void unsavedAuthorPlanKeepsActualWindowOpen(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.show();w.collectionView();
  auto page=w.pages.value("collection");QVERIFY(page);
  auto sections=page->findChild<QTabWidget*>("collectionSections");QVERIFY(sections);sections->setCurrentIndex(2);
  QTRY_VERIFY(page->findChild<SourcePlansPage*>());
  auto plans=page->findChild<SourcePlansPage*>();auto name=plans->findChild<QLineEdit*>("planName");QVERIFY(name);
  const auto connection=QUuid::createUuid().toString();
  auto db=QSqlDatabase::addDatabase("QSQLITE",connection);db.setConnectOptions("QSQLITE_OPEN_READONLY");
  db.setDatabaseName(w.businessStore->filePath()+".sources.sqlite");QVERIFY(db.open());
  auto snapshot=[&]{QSqlQuery q(db);if(!q.exec("SELECT payload FROM source_plans ORDER BY id"))throw std::runtime_error(q.lastError().text().toStdString());QStringList rows;while(q.next())rows.append(q.value(0).toString());return rows;};
  const auto before=snapshot();
  name->setText("未保存作者计划");w.close();
  QTRY_VERIFY_WITH_TIMEOUT(!w.persistenceClosing,5000);
  QVERIFY(w.isVisible());QVERIFY(w.centralWidget()->isEnabled());QVERIFY(!w.persistenceCloseReady);
  QCOMPARE(name->text(),QString("未保存作者计划"));QCOMPARE(snapshot(),before);QVERIFY(!plans->scheduling());
  name->clear();w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);QCOMPARE(snapshot(),before);
  db.close();db=QSqlDatabase();QSqlDatabase::removeDatabase(connection);
 }
 void uncommittedTradeCannotBeDiscardedByClose(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.show();w.accountView();
  auto page=w.pages.value("accounts");auto ledger=page->findChild<QWidget*>("portfolioPage");QVERIFY(ledger);
  QTRY_VERIFY(ledger->property("ledgerReady").toBool());auto note=page->findChild<QLineEdit*>("tradeNote");note->setText("manual trade draft");
  auto trades=w.businessStore->read("trades");w.close();QTest::qWait(100);
  QVERIFY(w.isVisible());QCOMPARE(note->text(),QString("manual trade draft"));QCOMPARE(w.businessStore->read("trades"),trades);
  page->findChild<QPushButton*>("newTrade")->click();w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);
 }
 void failedSettingsSaveKeepsWindowAndDraftUntilRetry(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.show();w.accountEditView();
  auto page=dynamic_cast<AccountEditPage*>(w.pages.value("accountEdit"));QVERIFY(page);
  page->findChild<QLineEdit*>("accountEditName")->setText("unsaved retained draft");auto draft=page->saveState();
  auto trades=w.businessStore->read("trades");
  // A directory is not a writable INI file. All fixtures stay in QTemporaryDir.
  auto blocked=dir.filePath("blocked.ini");QVERIFY(QDir().mkdir(blocked));
  w.settings=std::make_unique<QSettings>(blocked,QSettings::IniFormat);
  w.close();QTest::qWait(150);
  QVERIFY(w.isVisible());QVERIFY(w.centralWidget()->isEnabled());QCOMPARE(page->saveState(),draft);
  QVERIFY(!w.persistenceCloseReady);QCOMPARE(w.businessStore->read("trades"),trades);
  QVERIFY(QDir().rmdir(blocked));auto path=blocked;
  w.close();QTRY_VERIFY_WITH_TIMEOUT(!w.isVisible(),5000);
  QSettings reopened(path,QSettings::IniFormat);
  QCOMPARE(QJsonDocument::fromJson(reopened.value("accountEdit/state").toByteArray()).object(),draft);
  QCOMPARE(w.businessStore->read("trades"),trades);
 }
};
QTEST_MAIN(R02CloseSafetyTests)
#include "r02_close_safety_tests.moc"
