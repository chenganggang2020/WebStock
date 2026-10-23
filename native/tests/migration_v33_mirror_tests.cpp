#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "portfolio_mirror_page.hpp"
namespace {
QPushButton* action(QWidget* p,QString title){for(auto* b:p->findChildren<QPushButton*>())if(b->text()==title)return b;return nullptr;}
QJsonObject stable(BusinessStore& s){auto b=s.backup();b.remove("createdAt");return b;}
}
class MigrationV33MirrorTests:public QObject {
 Q_OBJECT
private slots:
 void host(){try{for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
  QTemporaryDir dir;BusinessStore business(dir.filePath("business-v1.sqlite"));
  Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
  const QString id=w.instrumentId();QString name;for(int i=0;i<w.stocks->rowCount();++i)if(w.stocks->item(i,0)->data(Qt::UserRole).toString()==id)name=w.stocks->item(i,0)->text().section('\n',0,0);
  business.save("trades",{{"id","mirror-host-trade"},{"accountId","local"},{"instrumentId",id},{"name",name},{"date","2026-10-09"},{"side","buy"},{"quantity",100},{"price",10},{"fee",0},{"tax",0}});
  const auto before=stable(business);
  w.findChild<QPushButton*>("workspace自选与账户")->click();auto* entry=w.findChild<QPushButton*>("accountOpenMirror");QVERIFY(entry);entry->click();
  auto* page=dynamic_cast<PortfolioMirrorPage*>(w.findChild<QWidget*>("portfolioMirrorPage"));QVERIFY2(page&&page->isVisible(),qPrintable(w.statusBar()->currentMessage()));
  PortfolioMirrorStore store(dir.filePath("portfolio-mirror-v1.sqlite"));
  const auto source=portfolioMirror::json({{"holdings",QJsonArray{QJsonObject{{"instrumentId",id},{"code",id.section(':',2,2)},{"name",name},{"quantity",120},{"costValue",1200}}}},
   {"holdingsComplete",true},{"nativeAccountId","local"},{"snapshotDate","2026-10-09"},{"sourceLabel","隔离宿主样例，不是真实券商持仓"}});
  page->previewImport(source);QCOMPARE(store.catalog().size(),0);page->cancelImport();QCOMPARE(store.catalog().size(),0);page->previewImport(source);
  page->findChild<QCheckBox*>("mirrorAccountAck")->setChecked(true);action(page,"预览差异")->click();page->confirmImport();QCOMPARE(store.catalog().size(),1);
  auto record=store.get(store.catalog()[0].toObject()["id"].toString());auto evidence=record["draft"].toObject()["reconciliation"].toObject();
  QCOMPARE(evidence["ledgerAsOf"].toString(),QString());QVERIFY(!evidence["sameInstant"].toBool());QCOMPARE(record["draft"].toObject()["scope"].toObject()["account"].toObject()["id"].toString(),QString("local"));
  QCOMPARE(record["draft"].toObject()["scope"].toObject()["ledger"].toObject()["positions"].toArray()[0].toObject()["quantity"].toInt(),100);
  action(page,"源原文")->click();QCOMPARE(page->findChild<QPlainTextEdit*>("mirrorOriginal")->toPlainText(),QString::fromUtf8(source));
  QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(page->isVisible());w.findChild<QPushButton*>("theme")->click();
  if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v33-mirror.png"));
  action(page,"精确K线")->click();QVERIFY(!page->isVisible());QCOMPARE(w.instrumentId(),id);
  w.findChild<QPushButton*>("workspace自选与账户")->click();entry->click();QCOMPARE(store.catalog().size(),1);QCOMPARE(stable(business),before);
  PortfolioMirrorStore reopened(dir.filePath("portfolio-mirror-v1.sqlite"));QCOMPARE(reopened.get(record["id"].toString()),record);
 }}catch(const std::exception& e){QFAIL(e.what());}}
};
QTEST_MAIN(MigrationV33MirrorTests)
#include "migration_v33_mirror_tests.moc"
