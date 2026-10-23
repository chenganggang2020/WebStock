#include <QTemporaryDir>
#include <QtTest>
#include <QtWidgets>

#include "collection_page.hpp"
#include "collection_pipeline.hpp"
#include "source_page.hpp"
#include "source_plans_page.hpp"
class CollectionUiV10 : public QObject {
  Q_OBJECT
 private slots:
  void sameAuthorUsesOneMergedFilterAndPublicationOrder() {
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("AuthorMerge-"+QUuid::createUuid().toString(QUuid::WithoutBraces));
    QStandardPaths::setTestModeEnabled(true);
    QTemporaryDir dir;
    auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    const QString profile="https://www.douyin.com/user/confirmed_author";
    const QJsonObject legacy{{"channel_id",1}};
    store->save("collections",{{"id","old"},{"title","旧作品"},{"channel","同一作者"},
      {"publishedAt","2026-09-01T02:00:00.000Z"},{"status","imported"},{"text","原校对稿"},
      {"legacySource","expert_observations"},{"legacyOriginal",legacy}});
    store->save("collections",{{"id","bridge"},{"title","已核实旧作品"},{"channel","同一作者"},
      {"publishedAt","2026-10-10T02:00:00.000Z"},{"status","imported"},{"text","旧作品正文"},
      {"legacySource","expert_observations"},{"legacyOriginal",legacy},{"sourceProfile",profile}});
    store->save("collections",{{"id","new"},{"title","最新作品"},{"channel","同一作者"},
      {"publishedAt","2026-10-18T02:00:00.000Z"},{"status","imported"},{"text","新作品正文"},
      {"sourceProfile",profile}});
    store->save("collections",{{"id","namesake"},{"title","重名作者作品"},{"channel","同一作者"},
      {"publishedAt","2026-10-18T03:00:00.000Z"},{"status","imported"},{"text","另一作者正文"},
      {"sourceProfile","https://www.douyin.com/user/different_author"}});
    const auto before=store->read("collections");
    CollectionPipeline pipeline(store,dir.filePath("media"));
    std::unique_ptr<QWidget> page(collectionPage(store,nullptr,&pipeline));
    page->resize(1400,950);page->show();
    QTRY_VERIFY(page->property("listReady").toBool());
    auto author=page->findChild<QComboBox*>("collectionAuthor");
    QCOMPARE(author->count(),3); // All + one merged identity + the distinct namesake.
    author->setCurrentIndex(author->findData("profile:"+profile));
    auto list=page->findChild<QListWidget*>("collectionList");
    QCOMPARE(list->count(),3);
    QCOMPARE(list->item(0)->data(Qt::UserRole).toString(),QString("new"));
    QCOMPARE(list->item(1)->data(Qt::UserRole).toString(),QString("bridge"));
    QCOMPARE(list->item(2)->data(Qt::UserRole).toString(),QString("old"));
    QCOMPARE(store->read("collections"),before);
    QSettings settings;settings.clear();settings.sync();
  }
  void conflictingAuthorLinksRemainSeparate() {
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("AuthorConflict-"+QUuid::createUuid().toString(QUuid::WithoutBraces));
    QStandardPaths::setTestModeEnabled(true);
    QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    const QString first="https://www.douyin.com/user/author_first",second="https://www.douyin.com/user/author_second";
    for(const auto& pair:QList<QPair<QString,QString>>{{"old-a",first},{"old-b",second},{"live-a",first},{"live-b",second}}){
      QJsonObject row{{"id",pair.first},{"title",pair.first},{"channel","相同显示名"},{"status","imported"},{"text","原稿"},{"sourceProfile",pair.second}};
      if(pair.first.startsWith("old-")){row["legacySource"]="expert_observations";row["legacyOriginal"]=QJsonObject{{"channel_id",9}};}
      store->save("collections",row);
    }
    const auto before=store->read("collections");
    CollectionPipeline pipeline(store,dir.filePath("media"));
    std::unique_ptr<QWidget> page(collectionPage(store,nullptr,&pipeline));page->show();
    QTRY_VERIFY(page->property("listReady").toBool());
    auto author=page->findChild<QComboBox*>("collectionAuthor");auto list=page->findChild<QListWidget*>("collectionList");
    QCOMPARE(author->count(),4);
    author->setCurrentIndex(author->findData("author:9"));QCOMPARE(list->count(),2);
    author->setCurrentIndex(author->findData("profile:"+first));QCOMPARE(list->count(),1);
    QCOMPARE(list->item(0)->data(Qt::UserRole).toString(),QString("live-a"));
    QCOMPARE(store->read("collections"),before);
    QSettings settings;settings.clear();settings.sync();
  }
  void nativeRunLinkUsesExactRevisionAndProtectsDraft() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    store->save("collections", {{"id","first"},{"title","初版"},{"text","旧文稿"},{"status","imported"},
                                {"sourceUrl","https://www.douyin.com/video/7259684447530929443"}});
    store->save("collections", {{"id","update"},{"title","更新版本"},{"text","更新正文"},{"status","imported"},
                                {"sourceUrl","https://www.douyin.com/video/7259684447530929443"},
                                {"executionRevision","revision-2"}});
    CollectionPipeline pipeline(store, dir.filePath("media"));
    std::unique_ptr<QWidget> page(collectionPage(store,nullptr,&pipeline));
    auto history=page->findChild<SourcePlansPage*>();
    QVERIFY(history);
    history->openRunCollection("update","revision-2");
    auto title=page->findChild<QLineEdit*>("collectionTitle");
    QCOMPARE(title->text(),QString("更新版本"));
    title->selectAll();QTest::keyClicks(title,"Unsaved draft");
    history->openRunCollection("first","");
    QCOMPARE(title->text(),QString("Unsaved draft"));
    QVERIFY(history->findChild<QLabel*>("sourcePlansState")->text().contains("请先保存"));
    page->findChild<QPushButton*>("saveCollection")->click();
    history->openRunCollection("first","");
    QCOMPARE(title->text(),QString("初版"));
    history->openRunCollection("update","old-revision");
    QCOMPARE(title->text(),QString("初版"));
    QVERIFY(history->findChild<QLabel*>("sourcePlansState")->text().contains("替换"));
    QCOMPARE(store->read("docs").size(),0);
  }
  void readerCannotClaimAuthorPlanLedgerBeforeOwnerOpensPage() {
    QTemporaryDir d;
    auto s=std::make_shared<BusinessStore>(d.filePath("db"));
    auto owner=std::make_unique<CollectionPipeline>(s,d.filePath("media"));
    CollectionPipeline second(s,d.filePath("media"));
    std::unique_ptr<QWidget> reader(collectionPage(s,nullptr,&second));
    QVERIFY(!reader->findChild<QWidget*>("sourcePlansPage"));
    QVERIFY(!QFile::exists(s->filePath()+".sources.sqlite"));
    std::unique_ptr<QWidget> writer(collectionPage(s,nullptr,owner.get()));
    QVERIFY(writer->findChild<QWidget*>("sourcePlansPage"));
    writer.reset();owner.reset();
    reader->findChild<QPushButton*>("acquireCollectionQueue")->click();
    QVERIFY(second.ownsQueue());
    QVERIFY(reader->findChild<QWidget*>("sourcePlansPage"));
  }
  void otherWindowIsReadOnlyUntilExplicitTakeover() {
    QTemporaryDir d;
    auto s=std::make_shared<BusinessStore>(d.filePath("db"));
    auto owner=std::make_unique<CollectionPipeline>(s,d.filePath("media"));
    const auto row=s->save("collections",{{"id","j"},{"title","隔离任务"},
      {"text","正文不得被第二窗口改写"},{"status","running"}});
    CollectionPipeline second(s,d.filePath("media"));
    std::unique_ptr<QWidget> page(collectionPage(s,nullptr,&second));
    page->resize(1400,950);page->show();
    auto title=page->findChild<QLineEdit*>("collectionTitle");
    QVERIFY(title->isReadOnly());
    for(auto name:{"saveCollection","publishCollection","startTranscription",
                   "cancelTranscription","startCollectionPipeline","stopCollectionPipeline",
                   "newCollectionLink","saveQualityReview","saveCollectionEngine"})
      QVERIFY2(!page->findChild<QPushButton*>(name)->isEnabled(),name);
    auto takeover=page->findChild<QPushButton*>("acquireCollectionQueue");
    QVERIFY(takeover);QVERIFY(takeover->isEnabled());
    QTest::mouseClick(takeover,Qt::LeftButton);
    QCOMPARE(s->read("collections")[0].toObject(),row);
    QVERIFY(page->findChild<QLabel*>("collectionOwnership")->text().contains("只读"));
    const auto dir=qEnvironmentVariable("QUEUE_UI_EVIDENCE");
    if(!dir.isEmpty()){QDir().mkpath(dir);QTest::qWait(30);QVERIFY(page->grab().save(dir+"/queue-readonly.png"));}
    owner.reset();
    QTest::mouseClick(takeover,Qt::LeftButton);
    QVERIFY(second.ownsQueue());QVERIFY(!title->isReadOnly());
    QVERIFY(!takeover->isEnabled());
    title->selectAll();QTest::keyClicks(title,"Saved after takeover");
    page->findChild<QPushButton*>("saveCollection")->click();
    QCOMPARE(s->read("collections")[0].toObject()["title"].toString(),QString("Saved after takeover"));
    QCOMPARE(s->read("collections")[0].toObject()["text"].toString(),row["text"].toString());
    QCOMPARE(s->read("docs").size(),0);
    QVERIFY(QApplication::activeModalWidget()==nullptr);
    if(!dir.isEmpty()){QTest::qWait(30);QVERIFY(page->grab().save(dir+"/queue-owner.png"));}
  }
  void sourceRevisionCanOpenRootWithoutLosingDraft() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "root"}, {"title", "初版人工稿"}, {"text", "旧文稿"}, {"status", "completed"}});
    s->save("collections", {{"id", "version"}, {"title", "来源更新稿"}, {"text", "新文稿"}, {"status", "completed"}, {"sourceRootId", "root"}});
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    auto list = p->findChild<QListWidget*>("collectionList");
    for (int n = 0; n < list->count(); ++n) if (list->item(n)->data(Qt::UserRole) == "version") list->setCurrentRow(n);
    auto title = p->findChild<QLineEdit*>("collectionTitle");
    auto button = p->findChild<QPushButton*>("viewSourceRoot");
    QVERIFY(button->isEnabled());
    title->selectAll(); QTest::keyClicks(title, "Unsaved draft");
    button->click(); QCOMPARE(title->text(), QString("Unsaved draft"));
    QVERIFY(p->findChild<QLabel*>("collectionState")->text().contains("请先保存"));
    p->findChild<QPushButton*>("saveCollection")->click();
    button->click(); QCOMPARE(title->text(), QString("初版人工稿"));
    QCOMPARE(list->currentItem()->data(Qt::UserRole).toString(), QString("root"));
    QVERIFY(!button->isEnabled());
  }
  void authorPlansAreAnInternalNativePage() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    auto plans = p->findChild<QWidget*>("sourcePlansPage");
    QVERIFY(plans);
    QVERIFY(!plans->isWindow());
    QVERIFY(plans->findChild<QPushButton*>("saveSourcePlan"));
    QCOMPARE(plans->findChild<QTableWidget*>("sourcePlanHistory")->rowCount(), 0);
  }
  void engineSettingsAreSharedWithSourceCollection() {
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("EngineUiTest");
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    auto save = p->findChild<QPushButton*>("saveCollectionEngine");
    QVERIFY(save);
    p->findChild<QLineEdit*>("collectionPython")
        ->setText(d.filePath("python.exe"));
    p->findChild<QLineEdit*>("collectionModel")->setText(d.filePath("model"));
    save->click();
    QSettings settings;
    QCOMPARE(settings.value("asr/python").toString(), d.filePath("python.exe"));
    QCOMPARE(settings.value("asr/model").toString(), d.filePath("model"));
    QVERIFY(p->findChild<QLabel*>("collectionState")
                ->text()
                .contains("已保存引擎"));
    settings.clear();
    settings.sync();
  }
  void sourceRecordsRefreshListWithoutOverwritingDraft() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "old"},
                            {"title", "已有资料"},
                            {"text", "原文"},
                            {"status", "imported"}});
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    p->show();
    auto title = p->findChild<QLineEdit*>("collectionTitle");
    title->selectAll();
    QTest::keyClicks(title, "Draft");
    s->save("collections", {{"id", "new"},
                            {"title", "新来源"},
                            {"text", ""},
                            {"status", "imported"}});
    emit p->findChild<SourcePage*>("sourceCollectionPage")->recordsChanged();
    QCOMPARE(p->findChild<QListWidget*>("collectionList")->count(), 2);
    QCOMPARE(title->text(), QString("Draft"));
    QCOMPARE(s->read("collections").size(), 2);
  }
  void storageFailureIsVisibleWhenQueueIsSuspended() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "任务"},
                            {"status", "imported"},
                            {"text", "原文"},
                            {"rightsBasis", "test"},
                            {"autoPipeline", true},
                            {"pipelineState", "queued"}});
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    const auto name = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", name);
      db.setDatabaseName(d.filePath("db"));
      QVERIFY(db.open());
      QSqlQuery q(db);
      QVERIFY(
          q.exec("CREATE TRIGGER reject_collection_writes BEFORE INSERT ON "
                 "records WHEN NEW.kind='collections' BEGIN SELECT "
                 "RAISE(ABORT,'test full disk'); END"));
      db.close();
    }
    QSqlDatabase::removeDatabase(name);
    pipeline.tick();
    QVERIFY(p->findChild<QLabel*>("collectionState")->text().contains("暂停"));
    std::unique_ptr<QWidget> reopened(collectionPage(s, nullptr, &pipeline));
    QVERIFY(reopened->findChild<QLabel*>("collectionState")
                ->text()
                .contains("暂停"));
  }
  void backgroundResultDoesNotGetOverwrittenByTitleDraft() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save(
        "collections",
        {{"id", "j"}, {"title", "任务"}, {"status", "imported"}, {"text", ""}});
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    p->show();
    auto title = p->findChild<QLineEdit*>("collectionTitle");
    title->selectAll();
    QTest::keyClicks(title, "Changed");
    auto result = s->read("collections")[0].toObject();
    result["assetPath"] = "downloaded.mp4";
    result["text"] = "刚完成的识别稿";
    result["originalText"] = "刚完成的识别稿";
    s->save("collections", result);
    QTest::mouseClick(p->findChild<QPushButton*>("saveCollection"),
                      Qt::LeftButton);
    result = s->read("collections")[0].toObject();
    QCOMPARE(result["title"].toString(), QString("Changed"));
    QCOMPARE(result["assetPath"].toString(), QString("downloaded.mp4"));
    QCOMPARE(result["text"].toString(), QString("刚完成的识别稿"));
  }
  void nativeQueuePublishesTextAndSupportsNewLinkTask() {
    QTemporaryDir d;
    auto s = std::make_shared<BusinessStore>(d.filePath("db"));
    s->save("collections", {{"id", "j"},
                            {"title", "授权资料"},
                            {"status", "imported"},
                            {"text", "本机资料"},
                            {"rightsBasis", "test"}});
    CollectionPipeline pipeline(s, d.filePath("media"));
    std::unique_ptr<QWidget> p(collectionPage(s, nullptr, &pipeline));
    p->resize(1450, 940);
    p->show();
    QTest::mouseClick(p->findChild<QPushButton*>("startCollectionPipeline"),
                      Qt::LeftButton);
    QTRY_COMPARE(s->read("docs").size(), 1);
    QTest::mouseClick(p->findChild<QPushButton*>("newCollectionLink"),
                      Qt::LeftButton);
    QCOMPARE(s->read("collections").size(), 2);
    QVERIFY(p->findChild<QLineEdit*>("collectionMediaUrl"));
  }
};
QTEST_MAIN(CollectionUiV10)
#include "collection_ui_v10_tests.moc"
