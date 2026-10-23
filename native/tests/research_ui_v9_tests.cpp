#include <QComboBox>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QListWidget>
#include <QTabWidget>
#include <QLabel>
#include <QGraphicsView>
#include <QGraphicsItem>
#include <QtTest>

#include "business_pages.hpp"
#include "collection_page.hpp"
#include "creator_page.hpp"
#include "creator_index.hpp"
class ResearchUiV9Tests : public QObject {
  Q_OBJECT
 private slots:
  void unanalysedManuscriptKeepsOriginalText() {
    QTemporaryDir dir;auto store=std::make_shared<BusinessStore>(dir.filePath("db"));
    QString body="真实原稿尚未记录关系分析，应完整保留在原文阅读区。这份文稿只用于原文展示测试，不应生成任何观点关系。";
    store->save("collections",{{"id","original"},{"title","未分析原稿"},{"text",body},{"status","completed"},{"asrResult",QJsonObject{{"text",body},{"durationSeconds",10},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",10},{"text",body}}}}}}});
    QVERIFY(creatorAnalysis::eligible(store->read("collections")[0].toObject()));
    std::unique_ptr<QWidget> page(creatorPage(store));
    QCOMPARE(page->findChild<QPlainTextEdit*>("creatorSource")->toPlainText(),body);
    QVERIFY(page->findChild<QLabel*>("creatorState")->text().contains("尚未记录分析"));
    QCOMPARE(page->findChild<QTableWidget*>("creatorRelations")->rowCount(),0);
  }
  void actualOldManuscriptsIndex() {
    QString path=qEnvironmentVariable("CREATOR_REAL_BUNDLE"),out=qEnvironmentVariable("CREATOR_REAL_OUTPUT");if(path.isEmpty())QSKIP("Actual old-source export only when explicitly supplied");
    QFile input(path);QVERIFY(input.open(QIODevice::ReadOnly));auto bundle=QJsonDocument::fromJson(input.readAll()).object();auto rows=bundle["collections"].toArray();QCOMPARE(rows.size(),985);
    auto result=creatorIndex::build(rows);auto counts=result["counts"].toObject();QCOMPARE(counts["documents"].toInt(),985);QCOMPARE(result["relations"].toArray().size(),0);QCOMPARE(counts["analyzed"].toInt(),0);
    QCOMPARE(counts["pending"].toInt()+counts["blocked"].toInt(),985);qInfo().noquote()<<QJsonDocument(counts).toJson(QJsonDocument::Compact);
    QTemporaryDir temp;auto store=std::make_shared<BusinessStore>(temp.filePath("db"));store->restore(bundle);std::unique_ptr<QWidget> page(creatorPage(store));page->resize(1600,950);page->show();page->findChild<QTabWidget*>("creatorViews")->setCurrentIndex(2);
    auto label=page->findChild<QLabel*>("creatorIndexCounts");QTRY_VERIFY_WITH_TIMEOUT(label->text().contains("文稿 985"),20000);page->findChild<QComboBox*>("creatorIndexMode")->setCurrentIndex(1);auto table=page->findChild<QTableWidget*>("creatorIndexRows");QCOMPARE(table->rowCount(),100);
    for(int i=0;i<9;i++)page->findChild<QPushButton*>("creatorIndexNext")->click();QCOMPARE(table->rowCount(),85);
    auto selected=table->item(0,0)->data(Qt::UserRole).toJsonObject();QString expected;for(auto value:rows)if(value.toObject()["id"]==selected["id"])expected=value.toObject()["text"].toString();
    table->selectRow(0);page->findChild<QPushButton*>("creatorIndexOpen")->click();QCOMPARE(page->findChild<QComboBox*>("creatorDocuments")->currentData().toString(),selected["id"].toString());QCOMPARE(page->findChild<QPlainTextEdit*>("creatorSource")->toPlainText(),expected);page->findChild<QTabWidget*>("creatorViews")->setCurrentIndex(2);
    if(!out.isEmpty()){QVERIFY(QDir().mkpath(out));QVERIFY(page->grab().save(out+"/windows-actual-old-index.png"));QFile summary(out+"/actual-old-index-counts.json");QVERIFY(summary.open(QIODevice::WriteOnly));summary.write(QJsonDocument(counts).toJson());}
  }
  void crossDocumentIndexOpensExactEvidenceAndGuardsDraft() {
    QTemporaryDir dir;auto s=std::make_shared<BusinessStore>(dir.filePath("db"));
    QString body="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
    s->save("collections",{{"id","c"},{"title","汇总操作夹具"},{"channel","测试作者"},{"sourceProfile","https://www.douyin.com/user/author_A"},{"status","completed"},{"text",body},{"asrResult",QJsonObject{{"text",body},{"durationSeconds",10},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",10},{"text",body}}}}}}});
    QJsonArray edges;for(int i=0;i<101;++i)edges.append(QJsonObject{{"topic",i==100?"光器件":"光通信"},{"from","光模块"},{"to","光芯片"},{"relation","使用"},{"quote",body},{"polarity",i==100?"contradicts":"supports"},{"uncertainty",QString::number(i)}});
    auto analysis=s->saveCreatorAnalysis("c",collectionQuality::bodyHash(body),"","观点夹具",edges);
    std::unique_ptr<QWidget> page(creatorPage(s));page->resize(1500,900);page->show();
    auto table=page->findChild<QTableWidget*>("creatorIndexRows");QVERIFY2(table,"cross-document results must be an operable native subpage");
    auto views=page->findChild<QTabWidget*>("creatorViews");views->setCurrentIndex(2);
    QTRY_COMPARE_WITH_TIMEOUT(table->rowCount(),100,10000);
    page->findChild<QPushButton*>("creatorIndexNext")->click();QCOMPARE(table->rowCount(),1);
    table->selectRow(0);page->findChild<QLineEdit*>("creatorUncertainty")->setText("未保存草稿");
    page->findChild<QPushButton*>("creatorIndexOpen")->click();QCOMPARE(page->findChild<QLineEdit*>("creatorUncertainty")->text(),QString("未保存草稿"));
    for(auto b:page->findChildren<QPushButton*>())if(b->text()=="放弃草稿 / 重读")b->click();
    page->findChild<QPushButton*>("creatorIndexOpen")->click();
    QCOMPARE(page->findChild<QLineEdit*>("creatorUncertainty")->text(),QString("100"));
    QVERIFY(!page->findChild<QPushButton*>("saveCreatorRelation")->isEnabled());
    QCOMPARE(page->findChild<QPlainTextEdit*>("creatorSource")->textCursor().selectedText(),body);
    views->setCurrentIndex(2);auto topics=page->findChild<QComboBox*>("creatorIndexTopic");topics->setCurrentIndex(topics->findData("光器件"));
    QTRY_VERIFY_WITH_TIMEOUT(page->findChild<QLabel*>("creatorIndexCounts")->text().contains("引文 1 条"),10000);
    QCOMPARE(table->rowCount(),1);
    if(!qEnvironmentVariable("CREATOR_INDEX_SCREENSHOT").isEmpty())QVERIFY(page->grab().save(qEnvironmentVariable("CREATOR_INDEX_SCREENSHOT")));
    topics->setCurrentIndex(topics->findData("光通信"));topics->setCurrentIndex(topics->findData("光器件"));
    QTRY_VERIFY_WITH_TIMEOUT(page->findChild<QLabel*>("creatorIndexCounts")->text().contains("引文 1 条"),10000);QCOMPARE(table->rowCount(),1);
    page->findChild<QPushButton*>("creatorIndexReload")->click();page.reset();QTest::qWait(100);
  }
  void creatorEntryIsNative() {
    QTemporaryDir dir;auto s=std::make_shared<BusinessStore>(dir.filePath("db"));
    std::unique_ptr<QWidget> page(researchPage(s,nullptr));
    QVERIFY2(page->findChild<QComboBox*>("creatorDocuments"),"author relations must be an actual native page");
  }
  void creatorEditsGraphHistoryAndDraftGuard() {
    QTemporaryDir dir;auto s=std::make_shared<BusinessStore>(dir.filePath("db"));
    QString body="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
    auto row=s->save("collections",{{"id","c"},{"title","光通信作者文稿 · 隔离操作测试"},{"channel","示例作者，非实证"},{"status","completed"},{"text",body},{"asrResult",QJsonObject{{"text",body},{"durationSeconds",10},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",10},{"text",body}}}}}}});
    s->save("collections",{{"id","other"},{"title","其他文稿"},{"status","imported"},{"text","未满足质检"}});
    std::unique_ptr<QWidget> page(creatorPage(s));page->resize(1500,900);page->show();
    auto text=[&](const char* key,const QString& value){page->findChild<QLineEdit*>(key)->setText(value);};
    text("creatorTopic","光通信");text("creatorFrom","光模块");text("creatorTo","光芯片");
    page->findChild<QPlainTextEdit*>("creatorQuote")->setPlainText(body);
    auto docs=page->findChild<QComboBox*>("creatorDocuments");docs->setCurrentIndex(1);QCOMPARE(docs->currentData().toString(),QString("c"));
    page->findChild<QPushButton*>("saveCreatorRelation")->click();
    auto table=page->findChild<QTableWidget*>("creatorRelations");QCOMPARE(table->rowCount(),1);
    table->setCurrentCell(0,0);QCOMPARE(page->findChild<QPlainTextEdit*>("creatorQuote")->toPlainText(),body);
    text("creatorUncertainty","供应关系尚未外部核实");table->setCurrentCell(0,1);
    QCOMPARE(page->findChild<QLineEdit*>("creatorUncertainty")->text(),QString("供应关系尚未外部核实"));
    page->findChild<QPushButton*>("saveCreatorRelation")->click();
    QCOMPARE(s->read("collections")[0].toObject()["creatorAnalyses"].toArray().size(),2);
    page->findChild<QTabWidget*>("creatorViews")->setCurrentIndex(1);auto graph=page->findChild<QGraphicsView*>("creatorGraph");
    bool picked=false;for(auto item:graph->scene()->items())if(item->data(0).isValid()){item->setSelected(true);picked=true;break;}QVERIFY(picked);
    QCOMPARE(page->findChild<QPlainTextEdit*>("creatorSource")->textCursor().selectedText(),body);
    auto versions=page->findChild<QComboBox*>("creatorVersions");versions->setCurrentIndex(2);QVERIFY(!page->findChild<QPushButton*>("saveCreatorRelation")->isEnabled());
    for(auto button:page->findChildren<QPushButton*>())if(button->text()=="使用原文选中部分")QVERIFY(!button->isEnabled());
    versions->setCurrentIndex(0);table->setCurrentCell(0,0);page->findChild<QPushButton*>("removeCreatorRelation")->click();QCOMPARE(table->rowCount(),0);
    QCOMPARE(s->read("collections")[0].toObject()["creatorAnalyses"].toArray().size(),3);
    versions->setCurrentIndex(2);QCOMPARE(table->rowCount(),1);
    QApplication::processEvents();
    QVERIFY(page->findChild<QLabel*>("creatorState")->text().contains("查看历史快照"));
    if(!qEnvironmentVariable("CREATOR_SCREENSHOT").isEmpty())QVERIFY(page->grab().save(qEnvironmentVariable("CREATOR_SCREENSHOT")));
    row["text"]=body+"改文";s->save("collections",row);page.reset(creatorPage(s));
    QCOMPARE(page->findChild<QTableWidget*>("creatorRelations")->rowCount(),0);
    page->findChild<QComboBox*>("creatorVersions")->setCurrentIndex(2);QCOMPARE(page->findChild<QTableWidget*>("creatorRelations")->rowCount(),1);
  }
  void unrecordedQualityNoteBlocksRecordSwitch() {
    QTemporaryDir dir;auto s=std::make_shared<BusinessStore>(dir.filePath("db"));
    for(QString id:{"a","b"})s->save("collections",{{"id",id},{"title",id},{"text","原文"},{"status","imported"}});
    std::unique_ptr<QWidget> p(collectionPage(s,nullptr));p->resize(1300,900);p->show();
    auto list=p->findChild<QListWidget*>("collectionList");list->setCurrentRow(0);
    QString id=list->currentItem()->data(Qt::UserRole).toString();
    auto note=p->findChild<QPlainTextEdit*>("qualityReviewNote");note->setPlainText("尚未提交的核对说明");
    list->setCurrentRow(1);QCOMPARE(note->toPlainText(),QString("尚未提交的核对说明"));
    QCOMPARE(list->currentItem()->data(Qt::UserRole).toString(),id);
    p->findChild<QPushButton*>("newCollectionLink")->click();
    QCOMPARE(s->read("collections").size(),2);
    QCOMPARE(note->toPlainText(),QString("尚未提交的核对说明"));
    note->clear();list->setCurrentRow(1);QVERIFY(list->currentItem()->data(Qt::UserRole).toString()!=id);
  }
  void reviewUsesNativeTabAndKeepsOriginal() {
    QTemporaryDir dir;auto s=std::make_shared<BusinessStore>(dir.filePath("db"));
    s->save("collections",{{"id","q"},{"title","质检文稿"},{"text","待核对原稿"},{"originalText","待核对原稿"},{"status","completed"}});
    std::unique_ptr<QWidget> p(collectionPage(s,nullptr));p->resize(1300,900);p->show();
    p->findChild<QListWidget*>("collectionList")->setCurrentRow(0);
    auto note=p->findChild<QPlainTextEdit*>("qualityReviewNote");
    QVERIFY2(note,"quality native controls must exist");
    p->findChild<QTabWidget*>("collectionDocumentTabs")->setCurrentIndex(3);
    note->setPlainText("听读核对用语，数字尚需对照公告。");p->findChild<QPushButton*>("saveQualityReview")->click();
    QCOMPARE(s->read("collections")[0].toObject()["qualityReviews"].toArray().size(),1);
    QVERIFY(p->findChild<QLabel*>("collectionQualityState")->text().contains("当前正文有复核记录"));
    p->findChild<QPlainTextEdit*>("collectionText")->setPlainText("校正后的文稿");
    p->findChild<QPushButton*>("saveQualityReview")->click();
    QCOMPARE(s->read("collections")[0].toObject()["qualityReviews"].toArray().size(),1);
    p->findChild<QPushButton*>("saveCollection")->click();
    QVERIFY(p->findChild<QLabel*>("collectionQualityState")->text().contains("旧复核已过期"));
    QCOMPARE(s->read("collections")[0].toObject()["originalText"].toString(),QString("待核对原稿"));
    if(!qEnvironmentVariable("QUALITY_SCREENSHOT").isEmpty())QVERIFY(p->grab().save(qEnvironmentVariable("QUALITY_SCREENSHOT")));
  }
  void createEvidenceRelationAndReopen() {
    QTemporaryDir dir;
    auto s = std::make_shared<BusinessStore>(dir.filePath("db"));
    s->save("docs",
            {{"id", "doc"}, {"title", "原文"}, {"text", "设备收入增长10%。"}});
    std::unique_ptr<QWidget> page(researchPage(s, nullptr));
    page->resize(1200, 800);
    page->show();
    auto name = page->findChild<QLineEdit*>("topicName");
    QVERIFY2(name, "native topic editor must exist, not a pending entry");
    name->setText("半导体");
    page->findChild<QPushButton*>("saveTopic")->click();
    page->findChild<QLineEdit*>("relationClaim")->setText("设备收入增长");
    page->findChild<QPlainTextEdit*>("relationQuote")
        ->setPlainText("设备收入增长10%。");
    page->findChild<QPushButton*>("saveRelation")->click();
    QCOMPARE(s->read("topics").size(), 1);
    QCOMPARE(s->read("relations").size(), 1);
    page.reset(researchPage(s, nullptr));
    page->show();
    QCOMPARE(page->findChild<QTableWidget*>("relationTable")->rowCount(), 1);
  }
};
QTEST_MAIN(ResearchUiV9Tests)
#include "research_ui_v9_tests.moc"
