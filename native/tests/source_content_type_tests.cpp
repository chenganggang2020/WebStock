#include "source_plans_page.hpp"
#include <QTemporaryDir>
#include <QtTest>

class MixedContentBrowser : public SourceBrowser {
 public:
  QUrl current;
  QStringList details;
  bool detailBecomesNote=false;
  QString author="https://www.douyin.com/user/abcdef";
  QJsonArray visible{
    QJsonObject{{"contentId","7259684447530929441"},{"sourceUrl","https://www.douyin.com/note/7259684447530929441"},{"title","图文A"}},
    QJsonObject{{"contentId","7259684447530929442"},{"sourceUrl","https://www.douyin.com/video/7259684447530929442"},{"title","视频B"}},
    QJsonObject{{"contentId","7259684447530929443"},{"sourceUrl","https://www.douyin.com/note/7259684447530929443"},{"title","图文C"}},
    QJsonObject{{"contentId","7259684447530929444"},{"sourceUrl","https://www.douyin.com/video/7259684447530929444"},{"title","视频D"}}};
  QJsonArray detailCatalog=visible;
  void initialize(const QString&)override{emit ready();}
  void navigate(const QUrl& url)override{
    current=url;
    if(!url.path().startsWith("/user/"))details<<url.toString();
    QTimer::singleShot(0,this,[this]{emit loaded(current,true);});
  }
  void stop()override{}
  QUrl source()const override{return current;}
  void capture()override{
    QJsonArray items=visible;
    if(!current.path().startsWith("/user/")){
      QJsonObject item;
      for(auto v:detailCatalog)if(v.toObject()["contentId"].toString()==sourceCapture::contentId(current.toString()))item=v.toObject();
      if(detailBecomesNote){item["sourceUrl"]="https://www.douyin.com/note/"+item["contentId"].toString();item["mediaType"]="note";}
      item["description"]="隔离测试公开说明";
      item["publishedAt"]="2026-10-18T01:00:00Z";
      items=QJsonArray{item};
    }
    emit snapshot({{"pageUrl",current.toString()},{"pageType",current.path().startsWith("/user/")?"profile":"video"},
      {"loggedIn",true},{"profile",QJsonObject{{"profileUrl",author},{"displayName","测试作者"}}},{"items",items}});
  }
};

class SourceContentTypeTests : public QObject {
  Q_OBJECT
  QJsonObject plan(const QString& mode={},const QString& suffix="abcdef"){
    QJsonObject p{{"name",suffix},{"profileUrl","https://www.douyin.com/user/"+suffix},
                  {"rightsBasis","隔离测试依据"},{"limit",2},{"intervalMinutes",30}};
    if(!mode.isEmpty())p["contentType"]=mode;
    return p;
  }
private slots:
  void initTestCase(){
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("SourceContentTypeTests");
  }
  void preferencesPersistIndependentlyAndRunsKeepOriginalSelection(){
    QTemporaryDir dir;QString first,second;
    {
      SourceSchedule db(dir.filePath("plans.sqlite"));
      auto a=db.save(plan("video")),b=db.save(plan("note","ghijkl"));
      first=a["id"].toString();second=b["id"].toString();
      QCOMPARE(a["contentType"].toString(),QString("video"));
      QCOMPARE(b["contentType"].toString(),QString("note"));
      db.enable(first,true);auto run=db.begin(first,1000,true);
      QCOMPARE(run["plan"].toObject()["contentType"].toString(),QString("video"));
      QVERIFY_EXCEPTION_THROWN(db.save(plan("note")),std::exception);
      QVERIFY(db.finish(run["id"].toString(),"complete",2000,{},"仅来源结束"));
      auto oldRun=db.history()[0].toObject();
      auto updated=db.save(plan("note"));QVERIFY(updated["enabled"].toBool());
      QCOMPARE(db.history()[0].toObject(),oldRun);
    }
    SourceSchedule db(dir.filePath("plans.sqlite"));
    for(auto value:db.plans())QCOMPARE(value.toObject()["contentType"].toString(),QString("note"));
    auto omitted=plan();auto saved=db.save(omitted);QCOMPARE(saved["contentType"].toString(),QString("note"));
    QCOMPARE(db.save(plan({},"mnopqr"))["contentType"].toString(),QString("all"));
    for(auto invalid:QJsonArray{"bad",QJsonValue::Null,17,true}){
      auto p=plan();p["contentType"]=invalid;
      QVERIFY_EXCEPTION_THROWN(db.save(p),std::exception);
    }
  }
  void realControlsSaveLoadEachAuthorWithoutStartingCollection(){
    QTemporaryDir dir;auto db=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    auto a=db->save(plan("video")),b=db->save(plan("note","ghijkl"));
    auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    CollectionPipeline pipeline(store,dir.filePath("media"));auto browser=new MixedContentBrowser;
    SourcePage source(store,&pipeline,nullptr,browser);
    SourcePlansPage page(db,&source);page.resize(1400,850);page.show();
    auto* choice=page.findChild<QComboBox*>("planContentType");
    QVERIFY2(choice,"Each author needs a persisted content type control");
    QCOMPARE(choice->count(),3);
    auto* table=page.findChild<QTableWidget*>("savedSourcePlans");QVERIFY(table);
    for(int row=0;row<table->rowCount();++row){
      table->setCurrentCell(row,0);table->selectRow(row);
      const auto id=table->item(row,0)->data(Qt::UserRole).toString();
      QCOMPARE(choice->currentData().toString(),id==a["id"].toString()?QString("video"):QString("note"));
    }
    choice->setCurrentIndex(choice->findData("all"));
    page.findChild<QPushButton*>("saveSourcePlan")->click();
    QVERIFY(!page.scheduling());QVERIFY(db->history().isEmpty());
    for(auto value:db->plans())QCOMPARE(value.toObject()["contentType"].toString(),value.toObject()["id"]==a["id"]?QString("video"):QString("all"));
    page.grab().save(QString(CONTENT_TYPE_OUTPUT)+"/author-content-types.png");
    auto* add=page.findChild<QPushButton*>("newSourcePlan");QVERIFY(add);add->click();
    QCOMPARE(choice->currentData().toString(),QString("all"));
  }
  void preFeaturePlanLoadsAsBothWithoutRewritingItOrStartingWork(){
    QTemporaryDir dir;auto db=std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    auto old=db->save(plan());old.remove("contentType");
    const auto connection=QUuid::createUuid().toString();
    {
      auto sql=QSqlDatabase::addDatabase("QSQLITE",connection);sql.setDatabaseName(dir.filePath("plans.sqlite"));QVERIFY(sql.open());
      QSqlQuery query(sql);query.prepare("UPDATE source_plans SET payload=? WHERE id=?");
      query.addBindValue(QJsonDocument(old).toJson(QJsonDocument::Compact));query.addBindValue(old["id"].toString());QVERIFY(query.exec());
    }
    QSqlDatabase::removeDatabase(connection);
    auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    CollectionPipeline pipeline(store,dir.filePath("media"));auto browser=new MixedContentBrowser;
    SourcePage source(store,&pipeline,nullptr,browser);SourcePlansPage page(db,&source);
    auto table=page.findChild<QTableWidget*>("savedSourcePlans");table->setCurrentCell(0,0);table->selectRow(0);
    QCOMPARE(page.findChild<QComboBox*>("planContentType")->currentData().toString(),QString("all"));
    QCOMPARE(db->plans(),QJsonArray{old});QVERIFY(db->history().isEmpty());QVERIFY(browser->details.isEmpty());QVERIFY(!page.scheduling());
    auto run=db->begin(old["id"].toString(),1000,true);
    QCOMPARE(run["plan"].toObject()["contentType"].toString(),QString("all"));
  }
  void executionFiltersBeforeRoundLimitAndIncludesPendingInventory_data(){
    QTest::addColumn<QString>("mode");QTest::addColumn<QString>("path");
    QTest::newRow("video")<<QString("video")<<QString("/video/");
    QTest::newRow("note")<<QString("note")<<QString("/note/");
    QTest::newRow("both")<<QString("all")<<QString();
  }
  void executionFiltersBeforeRoundLimitAndIncludesPendingInventory(){
    QFETCH(QString,mode);QFETCH(QString,path);
    QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    CollectionPipeline pipeline(store,dir.filePath("media"));auto browser=new MixedContentBrowser;
    SourcePage source(store,&pipeline,nullptr,browser);QSignalSpy finished(&source,&SourcePage::planFinished);
    auto p=plan(mode);p["limit"]=mode=="all"?4:2;
    source.runPlan(p,"round1");
    QTRY_COMPARE_WITH_TIMEOUT(finished.count(),1,20000);
    QCOMPARE(finished[0][1].toString(),QString("complete"));
    QCOMPARE(browser->details.size(),mode=="all"?4:2);
    for(const auto& url:browser->details)QVERIFY(path.isEmpty()||url.contains(path));
    QCOMPARE(store->read("collections").size(),browser->details.size());
    // The alternate type remains pending, not deleted/acknowledged by a filter.
    auto old=store->read("collections");
    browser->visible=QJsonArray{browser->visible[0]};browser->details.clear();
    p["contentType"]=mode=="video"?"note":"video";p["limit"]=2;
    source.runPlan(p,"round2");QTRY_COMPARE_WITH_TIMEOUT(finished.count(),2,20000);
    QVERIFY2(finished[1][1].toString()=="complete",qPrintable(finished[1][3].toString()));QCOMPARE(browser->details.size(),mode=="all"?0:2);
    for(const auto& url:browser->details)QVERIFY(url.contains(p["contentType"]=="note"?"/note/":"/video/"));
    for(auto value:old){bool found=false;for(auto current:store->read("collections"))if(current.toObject()["id"]==value.toObject()["id"]){found=true;QCOMPARE(current.toObject()["text"],value.toObject()["text"]);}QVERIFY(found);}
  }
  void excludedOnlyPageCompletesWithoutFallbackAndKeepsOriginalRecords(){
    QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto existing=store->save("collections",{{"id","keep-manual"},{"title","人工稿"},{"text","原稿不可变"},{"status","imported"},{"sourceUrl","https://www.douyin.com/video/7259684447530929449"}});
    CollectionPipeline pipeline(store,dir.filePath("media"));auto browser=new MixedContentBrowser;
    browser->visible=QJsonArray{browser->visible[0]};
    SourcePage source(store,&pipeline,nullptr,browser);QSignalSpy finished(&source,&SourcePage::planFinished);
    source.runPlan(plan("video"),"only-notes");QTRY_COMPARE_WITH_TIMEOUT(finished.count(),1,5000);
    QCOMPARE(finished[0][1].toString(),QString("complete"));QVERIFY(browser->details.isEmpty());
    QCOMPARE(store->read("collections"),QJsonArray{existing});
    QCOMPARE(finished[0][2].toJsonObject()["processed"].toInt(),0);
  }
  void detailTypeIsCheckedAgainBeforeSaving(){
    QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    CollectionPipeline pipeline(store,dir.filePath("media"));auto browser=new MixedContentBrowser;
    browser->visible=QJsonArray{browser->visible[1]};browser->detailBecomesNote=true;
    SourcePage source(store,&pipeline,nullptr,browser);QSignalSpy finished(&source,&SourcePage::planFinished);
    source.runPlan(plan("video"),"changed-type");QTRY_COMPARE_WITH_TIMEOUT(finished.count(),1,5000);
    QCOMPARE(finished[0][1].toString(),QString("failed"));QVERIFY(store->read("collections").isEmpty());
  }
};
QTEST_MAIN(SourceContentTypeTests)
#include "source_content_type_tests.moc"
