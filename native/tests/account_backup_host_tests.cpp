#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "account_edit_page.hpp"
#include "watchlist_workspace_page.hpp"
#include "watchlist_workspace_store.hpp"
class AccountBackupHostTests:public QObject{
 Q_OBJECT
 static QJsonObject row(std::shared_ptr<BusinessStore>s,QString id){for(auto v:s->read("accounts"))if(v.toObject()["id"]==id)return v.toObject();return {};}
 static QByteArray bytes(QString p){QFile f(p);if(!f.open(QIODevice::ReadOnly))return {};return f.readAll();}
 static void put(QString p,QByteArray b){QSaveFile f(p);if(!f.open(QIODevice::WriteOnly)||f.write(b)!=b.size()||!f.commit())throw std::runtime_error("fixture output");}
private slots:
 void accountNative(){
  for(QString layout:{"quotes","classic","focus"}){
   QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   auto old=row(w.businessStore,"local");old["history"]=QJsonArray{"preserve"};old["legacyOriginal"]=QJsonObject{{"source","old-account"}};old["cashBalance"]=10;old["cashAsOf"]="2020-01-01";old["cashSource"]="legacy";old=w.businessStore->save("accounts",old);
   auto trades=w.businessStore->read("trades");auto roster=w.instruments;
   w.accountView();auto*entry=w.pages["accounts"]->findChild<QPushButton*>("accountOpenEditor");QVERIFY(entry);entry->click();
   auto*p=dynamic_cast<AccountEditPage*>(w.pages["accountEdit"]);QVERIFY(p&&p->isVisible());
   auto*name=p->findChild<QLineEdit*>("accountEditName");name->setText("cancel");auto*choice=p->findChild<QComboBox*>("accountEditChoice");if(choice->count()>1){choice->setCurrentIndex(1);QCOMPARE(name->text(),QString("cancel"));QCOMPARE(p->saveState()["expected"].toObject()["id"].toString(),QString("local"));}QVERIFY(w.closeInternalReader());p->cancel();QCOMPARE(row(w.businessStore,"local"),old);
   name->setText("stale draft");p->preview();auto changed=old;changed["note"]="external";changed=w.businessStore->save("accounts",changed);p->commit();QCOMPARE(row(w.businessStore,"local"),changed);QCOMPARE(name->text(),QString("stale draft"));
   p->cancel();p->reload();name->setText("原生账户编辑");p->findChild<QCheckBox*>("accountEditCashEnabled")->setChecked(true);p->findChild<QLineEdit*>("accountEditCash")->setText("1234.567");p->preview();p->commit();
   auto saved=row(w.businessStore,"local");QCOMPARE(saved["name"].toString(),QString("原生账户编辑"));QCOMPARE(saved["cashBalance"].toDouble(),1234.57);QVERIFY(!saved.contains("cashAsOf"));QCOMPARE(saved["cashSource"].toString(),QString("manual"));QCOMPARE(saved["cashVerification"].toString(),QString("unverified"));QCOMPARE(saved["history"],old["history"]);QCOMPARE(saved["legacyOriginal"],old["legacyOriginal"]);QCOMPARE(saved["cashEditHistory"].toArray().last().toObject()["previous"].toObject()["cashAsOf"].toString(),QString("2020-01-01"));
   QVERIFY_EXCEPTION_THROWN(w.businessStore->editAccount(changed,changed),std::exception);
   auto forged=saved;forged["type"]="paper";QVERIFY_EXCEPTION_THROWN(w.businessStore->editAccount(saved,forged),std::exception);QCOMPARE(row(w.businessStore,"local"),saved);
   forged=saved;forged["name"]="";QVERIFY_EXCEPTION_THROWN(w.businessStore->editAccount(saved,forged),std::exception);QCOMPARE(row(w.businessStore,"local"),saved);
   forged=saved;forged["cashBalance"]=-1;QVERIFY_EXCEPTION_THROWN(w.businessStore->editAccount(saved,forged),std::exception);QCOMPARE(row(w.businessStore,"local"),saved);
   QCOMPARE(w.businessStore->read("trades"),trades);QCOMPARE(w.instruments,roster);
   p->findChild<QTextEdit*>("accountEditNote")->setPlainText(QString(300000,QChar(0x6587)));auto state=p->saveState();w.saveAccountEditView();QVERIFY(w.settings->value("accountEdit/state").toByteArray().size()>300000);
   p->cancel();p->restoreState(state);QCOMPARE(p->currentDraft()["note"].toString().size(),300000);p->cancel();
   BusinessStore reopened(w.businessStore->filePath());QCOMPARE(reopened.read("accounts"),w.businessStore->read("accounts"));
   if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v36-account-"+layout+".png"));
  }
 }
 void backupNative(){try{
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();
  auto inputs=w.watchlistBridgeCapture()["inputs"].toObject();w.watchlistBridgeStore(true)->initialize(inputs);w.watchlistWorkspaceView();
  auto*p=dynamic_cast<WatchlistWorkspacePage*>(w.pages["watchlistWorkspace"]);QVERIFY(p&&p->isVisible());auto roster=w.instruments;
  // The runtime-lifecycle base branch loads the first snapshot asynchronously.
  QTRY_VERIFY_WITH_TIMEOUT(!p->property("snapshotLoading").toBool(),15000);
  auto file=dir.filePath("groups.json");w.watchlistBackupExportPath(file);auto envelope=watchlistBackup::decodeBackup(bytes(file));
  auto config=envelope["config"].toObject();auto groups=config["groups"].toArray();int at=-1;for(int i=0;i<groups.size();++i)if(!groups[i].toObject()["readOnly"].toBool()){at=i;break;}QVERIFY(at>=0);
  auto g=groups[at].toObject();g["name"]="完整分组恢复";groups[at]=g;config["groups"]=groups;envelope["config"]=config;envelope["sha256"]=watchlistWorkspace::hash(config);put(file,watchlistBackup::encodeBackup(envelope));
  auto dbBefore=bytes(w.watchlistBridgePath());w.watchlistBackupImportPath(file);QCOMPARE(bytes(w.watchlistBridgePath()),dbBefore);QVERIFY(w.closeInternalReader());QCOMPARE(bytes(w.watchlistBridgePath()),dbBefore);
  w.watchlistBackupImportPath(file);p->acceptBackupImport();QCOMPARE(bytes(w.watchlistBridgePath()),dbBefore);p->previewChanges();p->commitChanges();QCOMPARE(p->draftSnapshot()["groups"],QJsonValue(groups));QCOMPARE(w.instruments,roster);
  auto committed=bytes(w.watchlistBridgePath());put(file,QByteArray("{\"schema\":\"bad\"}"));QVERIFY_EXCEPTION_THROWN(w.watchlistBackupImportPath(file),std::exception);QCOMPARE(bytes(w.watchlistBridgePath()),committed);
  auto saved=p->exportBackupBytes();put(file,saved);p->findChild<QLineEdit*>("watchWorkspaceNewName")->setText("未确认新组");QVERIFY_EXCEPTION_THROWN(w.watchlistBackupImportPath(file),std::exception);QCOMPARE(p->findChild<QLineEdit*>("watchWorkspaceNewName")->text(),QString("未确认新组"));p->findChild<QLineEdit*>("watchWorkspaceNewName")->clear();
  w.watchlistBackupImportPath(file);p->acceptBackupImport();w.watchlistBridgeSaveViews();p->reload();w.watchlistBridgeRestoreViews();QCOMPARE(p->draftSnapshot()["groups"],QJsonValue(groups));QCOMPARE(w.instruments,roster);
  if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v36-group-backup.png"));
 }catch(const std::exception& error){QFAIL(error.what());}
 }
};
QTEST_MAIN(AccountBackupHostTests)
#include "account_backup_host_tests.moc"
