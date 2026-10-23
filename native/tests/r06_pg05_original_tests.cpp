#include "collection_page.hpp"
#include "collection_pipeline.hpp"
#include "native_read_pool.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QTimeZone>
#include <QSemaphore>
#include <QStackedWidget>
#include <QSqlQuery>
#include <QCryptographicHash>

namespace {
const QString RootId="root-original",ChildId="child-current";
bool waitFor(std::function<bool()> ready,int milliseconds=5000){QElapsedTimer time;time.start();while(!ready()&&time.elapsed()<milliseconds){QCoreApplication::processEvents();QTest::qWait(5);}return ready();}
template<class T>T* widget(QWidget*p,const char*name){auto*value=p->findChild<T*>(name);if(!value)throw std::runtime_error(name);return value;}
int rowFor(QListWidget*list,const QString&id){for(int i=0;i<list->count();++i)if(list->item(i)->data(Qt::UserRole)==id)return i;return -1;}
QJsonObject read(const std::shared_ptr<BusinessStore>&store,const QString&id){return BusinessStore::readRecord(store->filePath(),"collections",id);}
QByteArray recordsDigest(const QString&path){
 const auto name=QUuid::createUuid().toString();QByteArray bytes;
 {auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY");if(!db.open())throw std::runtime_error("fixture readonly open failed");{QSqlQuery q(db);if(!q.exec("SELECT kind,id,payload FROM records ORDER BY kind,id"))throw std::runtime_error("fixture digest failed");while(q.next())for(int n=0;n<3;++n){bytes+=q.value(n).toString().toUtf8();bytes+='\0';}}db.close();}
 QSqlDatabase::removeDatabase(name);return QCryptographicHash::hash(bytes,QCryptographicHash::Sha256);
}
struct Rig {
 QTemporaryDir dir;
 std::shared_ptr<BusinessStore> store;
 std::unique_ptr<CollectionPipeline> pipeline;
 std::unique_ptr<QStackedWidget> host;
 QWidget*page=nullptr;QWidget*other=nullptr;
 explicit Rig(const QString&source,std::function<void(std::shared_ptr<BusinessStore>)> beforeOpen={}){
  if(!dir.isValid()||!QFile::copy(source,dir.filePath("business.sqlite")))throw std::runtime_error("private fixture copy failed");
  store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));if(beforeOpen)beforeOpen(store);pipeline=std::make_unique<CollectionPipeline>(store,dir.filePath("media"));if(!pipeline->ownsQueue())throw std::runtime_error("private queue ownership failed");
  host=std::make_unique<QStackedWidget>();page=collectionPage(store,host.get(),pipeline.get());other=new QWidget(host.get());host->addWidget(page);host->addWidget(other);host->resize(1400,950);host->show();
 }
 ~Rig(){host.reset();pipeline.reset();nativeReadPool()->waitForDone();QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QCoreApplication::processEvents();}
 QLineEdit*title(){return widget<QLineEdit>(page,"collectionTitle");}
 QPlainTextEdit*text(){return widget<QPlainTextEdit>(page,"collectionText");}
 QLineEdit*search(){return widget<QLineEdit>(page,"collectionSearch");}
 QComboBox*author(){return widget<QComboBox>(page,"collectionAuthor");}
 QListWidget*list(){return widget<QListWidget>(page,"collectionList");}
 QPushButton*open(){return widget<QPushButton>(page,"viewSourceRoot");}
 QLabel*state(){return widget<QLabel>(page,"collectionState");}
 QString pager(){return widget<QLabel>(page,"collectionVisibleCount")->text();}
 QStringList visibleIds(){QStringList ids;for(int i=0;i<list()->count();++i)ids<<list()->item(i)->data(Qt::UserRole).toString();return ids;}
 bool ready(){return waitFor([&]{return page->property("listReady").toBool()&&title()->text().contains("CHILD_NEEDLE")&&list()->count()==100;});}
 bool rootShown(const QJsonObject&root){return waitFor([&]{return title()->text()==root["title"].toString();},1200);}
 bool exactFields(const QJsonObject&root){return title()->text()==root["title"].toString()&&text()->toPlainText()==root["text"].toString()&&widget<QPlainTextEdit>(page,"collectionOriginal")->toPlainText()==root["originalText"].toString()&&widget<QLineEdit>(page,"collectionSource")->text()==root["sourceUrl"].toString()&&widget<QLineEdit>(page,"collectionRights")->text()==root["rightsBasis"].toString()&&widget<QLineEdit>(page,"collectionMedia")->text()==root["assetPath"].toString()&&widget<QLineEdit>(page,"collectionMediaUrl")->text()==root["mediaUrl"].toString();}
};
struct PoolGate {
 std::shared_ptr<QSemaphore> entered=std::make_shared<QSemaphore>(),proceed=std::make_shared<QSemaphore>();int maximum;bool released=false;
 PoolGate(){nativeReadPool()->waitForDone();maximum=nativeReadPool()->maxThreadCount();nativeReadPool()->setMaxThreadCount(1);auto in=entered,out=proceed;nativeReadPool()->start([in,out]{in->release();out->acquire();});}
 bool started(){return entered->tryAcquire(1,3000);}
 void release(){if(!released){released=true;proceed->release();}}
 ~PoolGate(){release();nativeReadPool()->waitForDone();nativeReadPool()->setMaxThreadCount(maximum);}
};
}
class Pg05OriginalTests:public QObject {
 Q_OBJECT
 QTemporaryDir seedDirectory;
 QString fixture;
private slots:
 void initTestCase(){
  QStandardPaths::setTestModeEnabled(true);QCoreApplication::setOrganizationName("NativeMarketReviewTests");QCoreApplication::setApplicationName("PG05Original-"+QUuid::createUuid().toString(QUuid::WithoutBraces));QVERIFY(seedDirectory.isValid());fixture=seedDirectory.filePath("template.sqlite");BusinessStore store(fixture);
  QJsonObject root{{"id",RootId},{"title","ROOT full original title"},{"text","ROOT_BODY_BEGIN\n"+QString(12000,'R')+"\nROOT_BODY_END"},{"originalText","ORIGINAL_TRANSCRIPT_BEGIN\n"+QString(6000,'O')+"\nORIGINAL_TRANSCRIPT_END"},{"sourceUrl","https://example.invalid/root?source=original"},{"rightsBasis","Synthetic root permission"},{"assetPath",""},{"mediaUrl","https://example.invalid/root-media.mp4"},{"channel","Author B"},{"sourceProfile","https://example.invalid/author-b"},{"publishedAt","2020-01-01T00:00:00Z"},{"status","imported"},{"autoEnabled",false},{"autoPipeline",false}};store.save("collections",root);
  for(int i=0;i<199;++i)store.save("collections",{{"id",QString("filler-%1").arg(i,3,10,QChar('0'))},{"title",QString("Filler %1").arg(i)},{"text","Synthetic filler text"},{"originalText","Synthetic filler original"},{"channel","Author A"},{"sourceProfile","https://example.invalid/author-a"},{"publishedAt",QDateTime(QDate(2025,1,1).addDays(i),QTime(0,0),QTimeZone::UTC).toString(Qt::ISODate)},{"status","imported"},{"autoEnabled",false},{"autoPipeline",false}});
  store.save("collections",{{"id",ChildId},{"sourceRootId",RootId},{"title","CHILD_NEEDLE corrected title"},{"text","Child corrected body"},{"originalText","Child retained recognition"},{"sourceUrl","https://example.invalid/child"},{"rightsBasis","Synthetic child permission"},{"channel","Author A"},{"sourceProfile","https://example.invalid/author-a"},{"publishedAt","2026-10-19T00:00:00Z"},{"status","imported"},{"autoEnabled",false},{"autoPipeline",false}});QCOMPARE(store.read("collections").size(),201);
 }
 void cleanup(){nativeReadPool()->waitForDone();QCoreApplication::sendPostedEvents(nullptr,QEvent::DeferredDelete);QCoreApplication::processEvents();QSettings settings;settings.clear();settings.sync();}
 void originalOnThirdPageOpensWithoutChangingCurrentPage(){
  Rig r(fixture);QVERIFY(r.ready());QCOMPARE(rowFor(r.list(),RootId),-1);auto root=read(r.store,RootId);auto digest=recordsDigest(r.store->filePath());auto ids=r.visibleIds();auto pager=r.pager();r.open()->click();QVERIFY2(r.rootShown(root),"root on page 3 was not opened from page 1");QVERIFY(r.exactFields(root));QCOMPARE(r.visibleIds(),ids);QCOMPARE(r.pager(),pager);QCOMPARE(r.list()->currentRow(),-1);QCOMPARE(recordsDigest(r.store->filePath()),digest);QVERIFY(!r.open()->isEnabled());QVERIFY_THROWS_NO_EXCEPTION(prepareCollectionClose(r.page));
 }
 void originalOutsideAuthorFilterOpensWithoutChangingFilter(){
  Rig r(fixture);QVERIFY(r.ready());const QString key="profile:https://example.invalid/author-a";int at=r.author()->findData(key);QVERIFY(at>=0);r.author()->setCurrentIndex(at);QCOMPARE(r.list()->count(),100);QCOMPARE(rowFor(r.list(),RootId),-1);auto ids=r.visibleIds();auto pager=r.pager();auto root=read(r.store,RootId);auto digest=recordsDigest(r.store->filePath());r.open()->click();QVERIFY2(r.rootShown(root),"root excluded by author filter was not opened");QVERIFY(r.exactFields(root));QCOMPARE(r.author()->currentData().toString(),key);QCOMPARE(r.visibleIds(),ids);QCOMPARE(r.pager(),pager);QCOMPARE(recordsDigest(r.store->filePath()),digest);
 }
 void originalOutsideSearchOpensWithoutClearingSearch(){
  Rig r(fixture);QVERIFY(r.ready());r.search()->setText("CHILD_NEEDLE");QVERIFY(waitFor([&]{return r.list()->count()==1;}));auto root=read(r.store,RootId);auto pager=r.pager();r.open()->click();QVERIFY2(r.rootShown(root),"search-excluded root was not opened");QVERIFY(r.exactFields(root));QCOMPARE(r.search()->text(),QString("CHILD_NEEDLE"));QCOMPARE(r.list()->count(),1);QCOMPARE(r.pager(),pager);QCOMPARE(r.list()->currentRow(),-1);
 }
 void visibleRootRemainsAPositiveControl(){
  Rig r(fixture);QVERIFY(r.ready());widget<QPushButton>(r.page,"collectionNext")->click();widget<QPushButton>(r.page,"collectionNext")->click();QCOMPARE(r.list()->count(),1);QCOMPARE(rowFor(r.list(),RootId),0);auto root=read(r.store,RootId);r.open()->click();QVERIFY(r.rootShown(root));QVERIFY(r.exactFields(root));QCOMPARE(r.list()->currentItem()->data(Qt::UserRole).toString(),RootId);
 }
 void unsavedTextBlocksOriginalAndHiddenCloseUntilExplicitSave(){
  Rig r(fixture);QVERIFY(r.ready());const auto child=read(r.store,ChildId);r.text()->setPlainText("UNSAVED CHILD BODY");r.open()->click();QVERIFY(r.state()->text().contains("保存"));QCOMPARE(r.title()->text(),child["title"].toString());QCOMPARE(r.text()->toPlainText(),QString("UNSAVED CHILD BODY"));QCOMPARE(read(r.store,ChildId),child);r.host->setCurrentWidget(r.other);QVERIFY_THROWS_EXCEPTION(std::runtime_error,prepareCollectionClose(r.page));QCOMPARE(r.text()->toPlainText(),QString("UNSAVED CHILD BODY"));r.host->setCurrentWidget(r.page);widget<QPushButton>(r.page,"saveCollection")->click();QVERIFY(waitFor([&]{return read(r.store,ChildId)["text"]=="UNSAVED CHILD BODY";}));QVERIFY_THROWS_NO_EXCEPTION(prepareCollectionClose(r.page));
 }
 void reviewNoteBlocksOriginalAndHiddenClose(){
  Rig r(fixture);QVERIFY(r.ready());auto note=widget<QPlainTextEdit>(r.page,"qualityReviewNote");note->setPlainText("UNSAVED REVIEW NOTE");r.open()->click();QVERIFY(r.state()->text().contains("复核"));QVERIFY(r.title()->text().contains("CHILD_NEEDLE"));QCOMPARE(note->toPlainText(),QString("UNSAVED REVIEW NOTE"));r.host->setCurrentWidget(r.other);QVERIFY_THROWS_EXCEPTION(std::runtime_error,prepareCollectionClose(r.page));QCOMPARE(note->toPlainText(),QString("UNSAVED REVIEW NOTE"));note->clear();QVERIFY_THROWS_NO_EXCEPTION(prepareCollectionClose(r.page));
 }
 void missingRootKeepsCurrentReaderAndFilters(){
  Rig r(fixture,[](auto store){auto child=read(store,ChildId);child["sourceRootId"]="absent-root";store->save("collections",child);});QVERIFY(r.ready());const auto child=read(r.store,ChildId);const auto before=r.visibleIds();r.open()->click();QVERIFY(r.state()->text().contains("来源初版不存在"));QVERIFY(r.exactFields(child));QCOMPARE(r.visibleIds(),before);QVERIFY_THROWS_NO_EXCEPTION(prepareCollectionClose(r.page));
 }
 void changedLoadedChildCannotRetargetTheOriginal(){
  Rig r(fixture);QVERIFY(r.ready());const auto child=read(r.store,ChildId);auto changed=child;changed["sourceRootId"]="filler-198";r.store->save("collections",changed);r.open()->click();QVERIFY2(r.state()->text().contains("变化"),"changed loaded version did not reject the source-root navigation");QVERIFY(r.exactFields(child));QCOMPARE(read(r.store,ChildId)["sourceRootId"].toString(),QString("filler-198"));
 }
 void frozenOldRootReferenceStillRejectsVersionChanges(){
  Rig r(fixture);QVERIFY(r.ready());const auto child=read(r.store,ChildId),old=read(r.store,RootId);auto changed=old;changed["text"]="REPLACED ROOT BODY";r.store->save("collections",changed);QVERIFY_THROWS_EXCEPTION(std::runtime_error,openCollectionDocument(r.page,old));QVERIFY(r.exactFields(child));QCOMPARE(read(r.store,RootId)["text"].toString(),QString("REPLACED ROOT BODY"));QVERIFY_THROWS_NO_EXCEPTION(prepareCollectionClose(r.page));
 }
 void buttonReadsCurrentExactRootVersionInsteadOfStaleListMetadata(){
  Rig r(fixture);QVERIFY(r.ready());auto changed=read(r.store,RootId);changed["title"]="CURRENT EXACT ROOT VERSION";changed["text"]="CURRENT EXACT ROOT BODY\n"+QString(9000,'X')+"\nCURRENT ROOT END";r.store->save("collections",changed);const auto current=read(r.store,RootId);r.open()->click();QVERIFY(r.rootShown(current));QVERIFY(r.exactFields(current));QCOMPARE(read(r.store,RootId),current);
 }
 void exactOriginalReadCancelsOlderQueuedRowRead(){
  Rig r(fixture);QVERIFY(r.ready());PoolGate gate;QVERIFY(gate.started());int target=rowFor(r.list(),"filler-198");QVERIFY(target>=0);r.list()->setCurrentRow(target);const auto root=read(r.store,RootId);r.open()->click();gate.release();nativeReadPool()->waitForDone();QCoreApplication::sendPostedEvents(nullptr,QEvent::MetaCall);QCoreApplication::processEvents();QVERIFY2(r.rootShown(root),"older queued row read replaced the exact original");QVERIFY(r.exactFields(root));
 }
 void switchingPageCancelsReadAndHiddenButtonDoesNotClearSearch(){
  Rig r(fixture);QVERIFY(r.ready());PoolGate gate;QVERIFY(gate.started());int target=rowFor(r.list(),"filler-198");QVERIFY(target>=0);r.list()->setCurrentRow(target);r.search()->setText("CHILD_NEEDLE");r.host->setCurrentWidget(r.other);QVERIFY(!r.page->isVisible());r.open()->click();QCOMPARE(r.search()->text(),QString("CHILD_NEEDLE"));gate.release();nativeReadPool()->waitForDone();QCoreApplication::sendPostedEvents(nullptr,QEvent::MetaCall);QCoreApplication::processEvents();QVERIFY(r.title()->text().contains("CHILD_NEEDLE"));QVERIFY_THROWS_NO_EXCEPTION(prepareCollectionClose(r.page));r.host->setCurrentWidget(r.page);QVERIFY(waitFor([&]{return r.list()->count()==1;}));QCOMPARE(r.search()->text(),QString("CHILD_NEEDLE"));
 }
};
QTEST_MAIN(Pg05OriginalTests)
#include "r06_pg05_original_tests.moc"
