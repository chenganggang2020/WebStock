#include "window.hpp"
#include "navigation_model.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QJsonDocument>

class MigrationV34HostsTests : public QObject {
 Q_OBJECT
 static QByteArray bytes(const QString& path){QFile file(path);if(!file.open(QIODevice::ReadOnly))return {};return file.readAll();}
 static bool write(const QString& path,const QByteArray& data){QFile file(path);return file.open(QIODevice::WriteOnly)&&file.write(data)==data.size();}
 static QTabWidget* tabs(QWidget* page){if(auto* t=qobject_cast<QTabWidget*>(page))return t;return page->findChild<QTabWidget*>(QString(),Qt::FindDirectChildrenOnly);}
 static void settle(){QCoreApplication::processEvents();QTest::qWait(15);}
 static bool click(QWidget& w,const char* name){auto* b=w.findChild<QPushButton*>(name);if(!b||!b->isVisible())return false;QTest::mouseClick(b,Qt::LeftButton);settle();return true;}
 static bool shot(Window& w,const QString& name){settle();return w.grab().save(QString(NAV_OUTPUT)+"/"+name+".png");}
 static QStringList displayed(Window& w){QStringList out;for(auto* a:w.navigationToolbar->actions())if(!a->data().toString().isEmpty())out<<a->data().toString();return out;}
private slots:
 void deeperPagesAndAppearance(){
  QTemporaryDir dir;QVERIFY(dir.isValid());Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1280,900);w.show();QVERIFY(QTest::qWaitForWindowExposed(&w));
  auto assertGroup=[&](const QString& group,const QString& entry){return w.moduleNavigation->isVisible()&&w.moduleNavigation->property("workspace")==group&&w.navigationActions[entry]->isChecked();};
  w.businessStore->save("reports",{{"id","navigation-report"},{"title","隔离导航报告"},{"text","完整报告原文"}});
  QJsonObject version;for(auto v:w.personMethodVersions())if(v.toObject()["id"]=="navigation-report")version=v.toObject();QVERIFY(!version.isEmpty());w.openPersonMethodSource(version);settle();
  QCOMPARE(w.workspaceTabs->currentWidget(),w.pages.value("methodReport"));QVERIFY(assertGroup("研究","personMethod"));QVERIFY(shot(w,"11-report-reader"));
  auto collection=w.businessStore->save("collections",{{"id","navigation-video"},{"title","隔离导航文稿（无媒体）"},{"text","逐字文稿原文"},{"originalText","原稿"},{"status","imported"},{"autoEnabled",false}});
  w.archiveVideoView(collection);settle();QCOMPARE(w.workspaceTabs->currentWidget(),w.pages.value("archiveVideo"));QVERIFY(assertGroup("采集","collection"));QVERIFY(shot(w,"12-video-reader"));
  w.unifiedBackupView();auto* setup=w.pages.value("unifiedBackupSetup");QVERIFY(setup);
  for(auto* b:setup->findChildren<QPushButton*>())if(b->text().startsWith("以所选范围"))b->click();settle();QVERIFY(w.pages.value("unifiedBackup"));QCOMPARE(w.workspaceTabs->currentWidget(),w.pages.value("unifiedBackup"));QVERIFY(assertGroup("设置","unifiedBackupSetup"));
  for(auto layout:{"quotes","classic","focus"}){w.home();w.setLayoutMode(layout);settle();QVERIFY(assertGroup("主页","home"));w.marketOverviewView();settle();QVERIFY(assertGroup("主页","marketOverview"));}
  w.openNavigation("research");w.resize(880,820);settle();auto* more=w.navigationToolbar->findChild<QToolButton*>("qt_toolbar_ext_button");QVERIFY(more&&more->isVisible());QVERIFY(more->accessibleName()=="更多本模块菜单");QVERIFY(shot(w,"13-narrow-dark-final"));
  bool picked=false;QTimer::singleShot(100,&w,[&]{if(auto* menu=qobject_cast<QMenu*>(QApplication::activePopupWidget())){w.grab().save(QString(NAV_OUTPUT)+"/14-narrow-menu-final.png");menu->grab().save(QString(NAV_OUTPUT)+"/15-overflow-menu-final.png");for(auto* a:menu->actions())if(a->data()=="comments"){a->trigger();picked=true;break;}menu->close();}});QTest::mouseClick(more,Qt::LeftButton);settle();QVERIFY(picked);QVERIFY(assertGroup("研究","comments"));
  w.openNavigation("research");QVERIFY(click(w,"theme"));QVERIFY(shot(w,"16-narrow-light-final"));QVERIFY(click(w,"openNavigationSettings"));
  auto* choices=w.findChild<QListWidget*>("navigationSettingsList");QVERIFY(choices);QCOMPARE(choices->item(0)->checkState(),Qt::Checked);
  choices->item(1)->setCheckState(Qt::Unchecked);QVERIFY(shot(w,"17-settings-narrow-final"));
  QVERIFY(click(w,"theme"));QVERIFY(shot(w,"18-settings-dark-final"));
 }
 void allRoutesAndNestedPages(){
  QTemporaryDir dir;QVERIFY(dir.isValid());Window w(true,dir.filePath("review.ini"),dir.path());
  w.resize(1440,960);w.show();w.activateWindow();QVERIFY(QTest::qWaitForWindowExposed(&w));settle();
  QVERIFY(w.moduleNavigation->isVisible());QVERIFY(!w.workspaceTabs->tabBar()->isVisible());QVERIFY(shot(w,"01-home"));
  // These existing pages require explicit group initialization; seed only this temporary test root.
  w.editGroups();auto* groupHost=w.pages.value("watchlistHost");QVERIFY(groupHost);
  for(auto* b:groupHost->findChildren<QPushButton*>())if(b->text()=="预览首次初始化")b->click();
  QVERIFY(!w.watchlistInitPacket.isEmpty());groupHost->findChild<QCheckBox*>("watchlistInitAck")->setChecked(true);
  for(auto* b:groupHost->findChildren<QPushButton*>())if(b->text()=="确认初始化")b->click();
  QCOMPARE(w.watchlistBridgeRead(w.watchlistBridgeCapture()["inputs"].toObject())["state"].toString(),QString("ready"));
  QJsonArray routes;QSet<QString> visitedPages;QString lastGroup;int nestedCount=0;
  for(const auto& e:navigation::entries()){
   qInfo().noquote()<<"NAV_ROUTE"<<e.id;
   if(lastGroup!=e.group){auto* primary=w.findChild<QPushButton*>("workspace"+e.group);QVERIFY(primary);QTest::mouseClick(primary,Qt::LeftButton);settle();lastGroup=e.group;}
   QVERIFY2(w.navigationToolbar->actions().contains(w.navigationActions.value(e.id)),qPrintable(e.id));
   w.navigationActions.value(e.id)->trigger();settle();
   QString key=e.page=="auction"?"auction:"+w.activeId:e.page;
   auto* expected=e.page=="home"?w.workspaceTabs->widget(0):w.pages.value(key);
   QVERIFY2(expected,qPrintable("Missing page: "+e.id));QCOMPARE(w.workspaceTabs->currentWidget(),expected);
   QVERIFY2(w.moduleNavigation->isVisible(),qPrintable(e.id));QCOMPARE(w.moduleNavigation->property("workspace").toString(),e.group);
   QVERIFY(w.findChild<QPushButton*>("workspace"+e.group)->isChecked());QVERIFY(w.navigationActions.value(e.id)->isChecked());
   QVERIFY(w.findChild<QPushButton*>("openNavigationSettings")->isVisible());
   if(e.tab>=0){QVERIFY(tabs(expected));QCOMPARE(tabs(expected)->currentIndex(),e.tab);}
   routes.append(QJsonObject{{"id",e.id},{"group",e.group},{"page",key},{"persistent",true}});
   if(!visitedPages.contains(key)&&e.page!="home"){
    visitedPages.insert(key);
    const auto children=expected->findChildren<QTabWidget*>();
    for(auto* child:children){int old=child->currentIndex();for(int i=0;i<child->count();++i){child->setCurrentIndex(i);settle();QVERIFY(w.moduleNavigation->isVisible());++nestedCount;}child->setCurrentIndex(old);}
   }
   if(e.id=="marketOverview"||e.id=="watchlistWorkspace"||e.id=="funds"||e.id=="research"||e.id=="collection"||e.id=="paper"||e.id=="settings")QVERIFY(shot(w,"route-"+e.id));
  }
  QCOMPARE(routes.size(),navigation::entries().size());QVERIFY(!QFile::exists(w.navigationFilePath()));
  // Genuine nested reader lives inside the research workspace; outer navigation remains present.
  w.openNavigation("creator");settle();QVERIFY(w.moduleNavigation->isVisible());
  w.resize(880,820);w.openNavigation("research");settle();
  auto* overflow=w.navigationToolbar->findChild<QToolButton*>("qt_toolbar_ext_button");
  QVERIFY2(overflow&&overflow->isVisible(),"Narrow-window overflow must remain accessible");
  QVERIFY(w.findChild<QPushButton*>("openNavigationSettings")->isVisible());QVERIFY(shot(w,"09-narrow-research"));
  bool overflowChosen=false;
  QTimer::singleShot(100,&w,[&]{if(auto* menu=qobject_cast<QMenu*>(QApplication::activePopupWidget())){for(auto* a:menu->actions())if(a->data()=="comments"){a->trigger();overflowChosen=true;break;}menu->close();}});
  QTest::mouseClick(overflow,Qt::LeftButton);settle();QVERIFY(overflowChosen);QVERIFY(w.navigationActions["comments"]->isChecked());
  auto report=QJsonObject{{"routes",routes},{"routeCount",routes.size()},{"nestedTabSwitches",nestedCount},{"narrowOverflowTriggered",overflowChosen},{"isolatedData",true}};
  QVERIFY(write(QString(NAV_OUTPUT)+"/navigation-route-verification.json",QJsonDocument(report).toJson()));
 }
 void preferencesAndDrafts(){
  QTemporaryDir dir;QVERIFY(dir.isValid());const auto file=dir.filePath("navigation-v1.json");QByteArray saved;
  {
   Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1280,900);w.show();w.activateWindow();QVERIFY(QTest::qWaitForWindowExposed(&w));
   w.openNavigation("research");auto* original=w.pages["research"];auto* draft=original->findChild<QPlainTextEdit*>("evidenceText");QVERIFY(draft);draft->setPlainText("未保存的人工原文 / navigation draft 012345");
   auto instrument=w.instrumentId();auto period=w.period;w.openNavigation("marketOverview");w.openNavigation("research");QCOMPARE(w.pages["research"],original);QCOMPARE(draft->toPlainText(),QString("未保存的人工原文 / navigation draft 012345"));QCOMPARE(w.instrumentId(),instrument);QCOMPARE(w.period,period);
   QVERIFY(click(w,"openNavigationSettings"));auto* list=w.findChild<QListWidget*>("navigationSettingsList");auto* group=w.findChild<QComboBox*>("navigationSettingsGroup");QVERIFY(list&&group);
   QCOMPARE(group->currentText(),QString("主页"));
   int index=-1;for(int i=0;i<list->count();++i)if(list->item(i)->data(Qt::UserRole)=="globalMarket")index=i;QVERIFY(index>=0);
   list->setCurrentRow(index);QVERIFY(click(w,"navigationMoveUp"));QVERIFY(click(w,"navigationMoveUp"));QCOMPARE(list->item(0)->data(Qt::UserRole).toString(),QString("globalMarket"));
   for(int i=0;i<list->count();++i)if(list->item(i)->data(Qt::UserRole)=="news")list->item(i)->setCheckState(Qt::Unchecked);
   QVERIFY(!QFile::exists(file));QVERIFY(click(w,"navigationApply"));saved=bytes(file);QVERIFY(!saved.isEmpty());
   w.home();settle();QCOMPARE(displayed(w).first(),QString("globalMarket"));QVERIFY(!displayed(w).contains("news"));
   // A stale hidden entry must not navigate or lose the current chart state.
   auto* before=w.workspaceTabs->currentWidget();w.navigationActions["news"]->trigger();QCOMPARE(w.workspaceTabs->currentWidget(),before);
   w.openNavigation("funds");QCOMPARE(displayed(w),navigation::defaults("资金"));
   QVERIFY(click(w,"openNavigationSettings"));group->setCurrentText("研究");settle();
   list->item(0)->setCheckState(Qt::Unchecked);w.home();w.navigationSettingsView();QCOMPARE(list->item(0)->checkState(),Qt::Unchecked);QCOMPARE(bytes(file),saved);
   QVERIFY(click(w,"navigationReload"));QCOMPARE(list->item(0)->checkState(),Qt::Checked);QCOMPARE(bytes(file),saved);
   // Empty group is allowed, but the settings recovery entry remains visible.
   for(int i=0;i<list->count();++i)list->item(i)->setCheckState(Qt::Unchecked);QVERIFY(click(w,"navigationApply"));
   w.openNavigation("research");QVERIFY(displayed(w).isEmpty());QVERIFY(w.findChild<QPushButton*>("openNavigationSettings")->isVisible());
   QVERIFY(click(w,"openNavigationSettings"));QVERIFY(click(w,"navigationResetGroup"));QVERIFY(click(w,"navigationApply"));
   auto parsed=QJsonDocument::fromJson(bytes(file)).object();QVERIFY(navigation::hidden(parsed,"主页","news"));QVERIFY(!navigation::hidden(parsed,"研究","research"));
   QVERIFY(QDir(dir.path()).entryList({"navigation-v1.json.before-*.bak"},QDir::Files).size()>=2);
   QVERIFY(shot(w,"10-navigation-settings"));
   w.openNavigation("research");QCOMPARE(draft->toPlainText(),QString("未保存的人工原文 / navigation draft 012345"));
  }
  {
   Window reopen(true,dir.filePath("review.ini"),dir.path());reopen.resize(1280,900);reopen.show();QVERIFY(QTest::qWaitForWindowExposed(&reopen));
   QCOMPARE(displayed(reopen).first(),QString("globalMarket"));QVERIFY(!displayed(reopen).contains("news"));
   QVERIFY(click(reopen,"openNavigationSettings"));QVERIFY(click(reopen,"navigationResetAll"));QVERIFY(click(reopen,"navigationApply"));reopen.home();QCOMPARE(displayed(reopen),navigation::defaults("主页"));
  }
 }
 void preferenceSafety(){
  QTemporaryDir dir;QVERIFY(dir.isValid());const auto file=dir.filePath("navigation-v1.json");QByteArray original="{ broken original navigation : preserve exactly }";QVERIFY(write(file,original));
  Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1280,900);w.show();QVERIFY(QTest::qWaitForWindowExposed(&w));QCOMPARE(bytes(file),original);QCOMPARE(displayed(w),navigation::defaults("主页"));
  QVERIFY(click(w,"openNavigationSettings"));QVERIFY(click(w,"navigationApply"));auto backups=QDir(dir.path()).entryList({"navigation-v1.json.before-*.bak"},QDir::Files);QCOMPARE(backups.size(),1);QCOMPARE(bytes(dir.filePath(backups[0])),original);
  auto saved=bytes(file);auto external=saved+"\n ";QVERIFY(write(file,external));QVERIFY(click(w,"navigationResetAll"));QVERIFY(click(w,"navigationApply"));QCOMPARE(bytes(file),external);
  QVERIFY(w.findChild<QLabel*>("navigationSettingsStatus")->text().contains("其他窗口"));QVERIFY(click(w,"navigationReload"));QVERIFY(click(w,"navigationApply"));QCOMPARE(bytes(file),saved);
  // Oversized and unreadable (directory) inputs are never silently overwritten.
  QByteArray oversized(65537,'x');QVERIFY(write(file,oversized));QVERIFY(click(w,"navigationReload"));QVERIFY(click(w,"navigationApply"));QCOMPARE(bytes(file),oversized);
  QVERIFY(QFile::remove(file));QVERIFY(QDir().mkdir(file));QVERIFY(click(w,"navigationReload"));QVERIFY(click(w,"navigationApply"));QVERIFY(QFileInfo(file).isDir());
 }
};
QTEST_MAIN(MigrationV34HostsTests)
#include "navigation_window_tests.moc"
