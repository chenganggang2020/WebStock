#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "watchlist_workspace_page.hpp"
#include "watchlist_reconciliation_page.hpp"
#include "watchlist_host_adapter.hpp"
class WatchlistHostTests:public QObject {
 Q_OBJECT
 static bool click(QWidget*p,QString text){for(auto*b:p->findChildren<QPushButton*>())if(b->text()==text){b->click();return true;}return false;}
 static QByteArray bytes(QString path){QFile f(path);if(!f.open(QIODevice::ReadOnly))return {};return f.readAll();}
private slots:
 void nativeFlow(){
  for(QString layout:{"quotes","classic","focus"}){
   QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   const auto roster=QJsonDocument(w.instruments).toJson();QVERIFY(!w.instruments.isEmpty());
   w.renderWatchlistDirectory();QCOMPARE(w.watchlistBridgeDirectory()["state"].toString(),QString("uninitialized"));QVERIFY(!QFile::exists(w.watchlistBridgePath()));
   w.editGroups();auto*host=w.pages.value("watchlistHost");QVERIFY(host&&host->isVisible());
   QVERIFY(click(host,"预览首次初始化"));QVERIFY(!w.watchlistInitPacket.isEmpty());QVERIFY(!QFile::exists(w.watchlistBridgePath()));
   QVERIFY(click(host,"取消初始化预览"));QVERIFY(w.watchlistInitPacket.isEmpty());QVERIFY(!QFile::exists(w.watchlistBridgePath()));
   QVERIFY(click(host,"预览首次初始化"));host->findChild<QCheckBox*>("watchlistInitAck")->setChecked(true);QVERIFY(click(host,"确认初始化"));
   auto ready=w.watchlistBridgeRead(w.watchlistBridgeCapture()["inputs"].toObject());QCOMPARE(ready["state"].toString(),QString("ready"));
   w.watchlistWorkspaceView();auto*p=dynamic_cast<WatchlistWorkspacePage*>(w.pages.value("watchlistWorkspace"));QVERIFY(p&&p->isVisible());
   auto*newName=p->findChild<QLineEdit*>("watchWorkspaceNewName");newName->setText("双组观察");p->findChild<QPushButton*>("watchWorkspaceAddGroup")->click();
   auto gs=p->draftSnapshot()["groups"].toArray();QString id=gs.last().toObject()["groupId"].toString();QVERIFY(id.startsWith("local:"));
   QString stock=w.instruments[0].toObject()["id"].toString();p->applyOperation({{"op","addMember"},{"groupId",id},{"instrumentId",stock}});
   p->findChild<QLineEdit*>("watchWorkspaceName")->setText("持久观察");p->findChild<QLineEdit*>("watchWorkspaceColor")->setText("#8844cc");p->findChild<QPushButton*>("watchWorkspaceMetadata")->click();
   p->previewChanges();QVERIFY(w.closeInternalReader());p->previewChanges();p->commitChanges();
   auto saved=w.watchlistBridgeRead(w.watchlistBridgeCapture()["inputs"].toObject())["snapshot"].toObject();
   QCOMPARE(saved["groups"].toArray().last().toObject()["groupId"].toString(),id);QCOMPARE(QJsonDocument(w.instruments).toJson(),roster);
   w.renderWatchlistDirectory(id);w.fillStocks();QCOMPARE(w.groups->currentItem()->data(Qt::UserRole).toString(),id);QCOMPARE(w.stocks->rowCount(),1);
   auto before=bytes(w.watchlistBridgePath());p->applyOperation({{"op","deleteGroup"},{"groupId",id}});p->previewChanges();p->cancelChanges();QCOMPARE(bytes(w.watchlistBridgePath()),before);
   p->findChild<QLineEdit*>("watchWorkspaceNewName")->setText("完整未保存草稿");w.watchlistBridgeSaveViews();p->findChild<QLineEdit*>("watchWorkspaceNewName")->clear();w.watchlistBridgeRestoreViews();QCOMPARE(p->findChild<QLineEdit*>("watchWorkspaceNewName")->text(),QString("完整未保存草稿"));
   w.instruments.removeAt(0);const auto removed=QJsonDocument(w.instruments).toJson();
   QCOMPARE(w.watchlistBridgeRead(w.watchlistBridgeCapture()["inputs"].toObject())["state"].toString(),QString("needsReconciliation"));
   w.watchlistReconciliationView();auto*r=dynamic_cast<WatchlistReconciliationPage*>(w.pages.value("watchlistReconciliation"));QVERIFY(r);before=bytes(w.watchlistBridgePath());r->previewChanges();r->cancelChanges();QCOMPARE(bytes(w.watchlistBridgePath()),before);
   r->previewChanges();r->findChild<QCheckBox*>("reconciliationAck")->setChecked(true);r->confirmChanges();QCOMPARE(w.watchlistBridgeRead(w.watchlistBridgeCapture()["inputs"].toObject())["state"].toString(),QString("ready"));
   QVERIFY(r->findChild<QPlainTextEdit*>("reconciliationReader")->toPlainText().contains(stock));QCOMPARE(QJsonDocument(w.instruments).toJson(),removed);QCOMPARE(w.layoutMode(),layout);
   w.watchlistWorkspaceView();p->reload();
   if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v35-watchlist-"+layout+".png"));
  }
 }
};
QTEST_MAIN(WatchlistHostTests)
#include "watchlist_host_tests.moc"
