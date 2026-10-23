#include <QTemporaryDir>
#include <QtTest>

#include "business_store.hpp"
#include "legacy_data.hpp"
#include "collection_quality.hpp"
class ResearchV9Tests : public QObject {
  Q_OBJECT
 private slots:
  void sharedQualityContract() {
    QFile file(QFINDTESTDATA("../contracts/document-quality.json"));QVERIFY(file.open(QIODevice::ReadOnly));
    auto cases=QJsonDocument::fromJson(file.readAll()).array();QCOMPARE(cases.size(),9);
    for(auto v:cases){const auto test=v.toObject();auto state=collectionQuality::evaluate(test["row"].toObject());const auto expected=test["expected"].toObject();for(auto it=expected.begin();it!=expected.end();++it)QVERIFY2(state[it.key()]==it.value(),qPrintable(test["name"].toString()+" "+it.key()));}
  }
  void qualityRulesDoNotPromoteOldCompletionOrHumanReview() {
    const QString text = QString("设备需求增长尚需后续公告与实际收入交叉核对，作者观点不等于已证实的投资结论。");
    QJsonObject row{{"id","quality"},{"title","文稿"},{"status","completed"},{"text",text}};
    QCOMPARE(collectionQuality::evaluate(row)["machineQuality"].toString(),QString("not_evaluated"));
    row["asrResult"] = QJsonObject{{"transcript",text},{"durationSeconds",12},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",12},{"text",text}}}}};
    QCOMPARE(collectionQuality::evaluate(row)["gate"].toString(),QString("ready"));
    auto asr=row["asrResult"].toObject(); asr["segments"]=QJsonArray{QJsonObject{{"start",0},{"end",14}}};row["asrResult"]=asr;
    QVERIFY(collectionQuality::evaluate(row)["qualityReasons"].toArray().contains("timestamp_out_of_range"));
    row["text"]="请使用中国大陆简体中文逐字转写"+text;
    QCOMPARE(collectionQuality::evaluate(row)["gate"].toString(),QString("suspected_prompt_echo"));
    row["text"]=text+"人工校正";
    QCOMPARE(collectionQuality::evaluate(row)["gate"].toString(),QString("asr_review_required"));
    QTemporaryDir dir;BusinessStore s(dir.filePath("quality.db"));s.save("collections",row);
    const auto hash=collectionQuality::bodyHash(row["text"].toString());
    auto reviewed=s.reviewCollection("quality",hash,"逐段听读核对，仍需查证作者观点");
    QCOMPARE(collectionQuality::evaluate(reviewed)["humanReview"].toString(),QString("reviewed"));
    QVERIFY(!collectionQuality::evaluate(reviewed)["eligibleForAnalysis"].toBool());
    QCOMPARE(reviewed["verification"].toString(),QString());
    reviewed["text"]=text;s.save("collections",reviewed);
    QCOMPARE(collectionQuality::evaluate(reviewed)["humanReview"].toString(),QString("outdated"));
    QVERIFY_EXCEPTION_THROWN(s.reviewCollection("quality",hash,"过期界面"),std::exception);
    QCOMPARE(s.read("collections")[0].toObject()["qualityReviews"].toArray().size(),1);
    QVERIFY_EXCEPTION_THROWN(s.reviewCollection("quality",collectionQuality::bodyHash(text),"  "),std::exception);
    QVERIFY_EXCEPTION_THROWN(s.reviewCollection("quality",collectionQuality::bodyHash(text),QString(QChar(0x3000))+QChar(0xa0)),std::exception);
    QCOMPARE(collectionQuality::evaluate({{"text",QString(QChar(0x3000))+QChar(0xa0)}})["gate"].toString(),QString("missing_text"));
    BusinessStore copy(dir.filePath("copy.db"));copy.restore(s.backup());
    QCOMPARE(copy.read("collections")[0].toObject()["qualityReviews"].toArray().size(),1);
  }
  void missingNativeEvidenceAndIncompleteReviewNeverPass() {
    QString text=QString("设备收入仍需核对原始报告与公告，作者观点只作为线索，不能作为证实的事实。");
    QJsonObject row{{"text",text},{"asrResult",QJsonObject{{"transcript",text}}},{"qualityReviews",QJsonArray{QJsonObject{{"bodyHash",collectionQuality::bodyHash(text)}}}}};
    QVERIFY(!collectionQuality::evaluate(row)["eligibleForAnalysis"].toBool());
    QVERIFY(collectionQuality::evaluate(row)["humanReview"]!="reviewed");
    QTemporaryDir d;BusinessStore s(d.filePath("db"));row["title"]="坏复核";row["status"]="imported";
    QVERIFY_EXCEPTION_THROWN(s.save("collections",row),std::exception);
    auto backup=s.backup();row["id"]="bad";backup["collections"]=QJsonArray{row};
    QVERIFY_EXCEPTION_THROWN(s.restore(backup),std::exception);QVERIFY(s.read("collections").isEmpty());
  }
  void oldOcrCasesAndEditedAsrRemainDistinct() {
    const QString text="保偏光纤用于光引擎的激光传输，这一技术路线与高速光互联有关。";
    QJsonObject note{{"status","needs_review"},{"imageCount",1},{"pages",QJsonArray{QJsonObject{{"index",1},{"status","recognized"},{"text",text}}}}};
    auto state=[&](QJsonObject n,QString body){return collectionQuality::evaluate({{"text",body},{"qualitySource",collectionQuality::safeSource("note",body,{{"note",n}})}});};
    QCOMPARE(state(note,text)["gate"].toString(),QString("ready"));
    QCOMPARE(state(note,text)["humanReview"].toString(),QString("unreviewed"));
    auto bad=note;bad["imageCount"]=2;QVERIFY(!state(bad,text)["eligibleForAnalysis"].toBool());
    bad=note;bad["pages"]=QJsonArray{QJsonObject{{"index",2},{"status","recognized"},{"text",text}}};QVERIFY(!state(bad,text)["eligibleForAnalysis"].toBool());
    bad=note;bad["status"]="partial";QCOMPARE(state(bad,text)["gate"].toString(),QString("note_ocr_required"));
    bad=note;bad["quality"]=QJsonObject{{"needsReview",true},{"reasons",QJsonArray{"uncertain_entities"}}};QCOMPARE(state(bad,text)["machineQuality"].toString(),QString("review_required"));
    bad=note;bad["status"]="no_text";bad["pages"]=QJsonArray{QJsonObject{{"index",1},{"status","no_text"},{"text",""}}};QCOMPARE(state(bad,text)["extraction"].toString(),QString("empty"));
    QVERIFY(!state(note,"另一份正文，不属于当前识别图片，不能仅凭状态完毕就认为当前文稿已经完整处理。")["eligibleForAnalysis"].toBool());
    auto source=collectionQuality::safeSource("video",text+"已修改",{{"asr",QJsonObject{{"status","complete"},{"transcript",text}}}});
    auto edited=collectionQuality::evaluate({{"text",text+"已修改"},{"qualitySource",source}});
    QVERIFY(edited["qualityReasons"].toArray().contains("body_edited"));
  }
  void asynchronousRecordSaveKeepsReviewHistory() {
    QTemporaryDir d;BusinessStore s(d.filePath("db"));
    auto old=s.save("collections",{{"id","r"},{"title","原稿"},{"text","正文"},{"status","imported"}});
    s.reviewCollection("r",collectionQuality::bodyHash("正文"),"听读核对过正文");
    old["title"]="后台更新标题";s.save("collections",old);
    QCOMPARE(s.read("collections")[0].toObject()["qualityReviews"].toArray().size(),1);
  }
  void relationNeedsExistingTopicAndExactEvidence() {
    QTemporaryDir dir;
    BusinessStore s(dir.filePath("store.db"));
    auto topic = s.save("topics", {{"id", "topic"}, {"name", "半导体"}});
    s.save(
        "docs",
        {{"id", "doc"}, {"title", "原始公告"}, {"text", "设备收入增长10%。"}});
    QJsonObject rel{{"id", "rel"},
                    {"topicId", "topic"},
                    {"documentId", "doc"},
                    {"stage", "equipment"},
                    {"claim", "设备收入增长"},
                    {"quote", "设备收入增长10%。"},
                    {"polarity", "supports"}};
    s.save("relations", rel);
    QCOMPARE(s.read("relations").size(), 1);
    rel["documentId"] = "missing";
    QVERIFY_EXCEPTION_THROWN(s.save("relations", rel), std::exception);
    rel["documentId"] = "doc";
    rel["quote"] = "虚构引文";
    QVERIFY_EXCEPTION_THROWN(s.save("relations", rel), std::exception);
    QVERIFY_EXCEPTION_THROWN(s.remove("docs", "doc"), std::exception);
    QVERIFY_EXCEPTION_THROWN(s.save("docs", {{"id", "doc"},
                                             {"title", "修改"},
                                             {"text", "删除了被引用原文"}}),
                             std::exception);
    QCOMPARE(s.read("docs")[0].toObject()["text"].toString(),
             QString("设备收入增长10%。"));
  }
  void collectionBackupKeepsOriginalAndOldBackupCompatible() {
    QTemporaryDir dir;
    BusinessStore s(dir.filePath("s.db"));
    auto before = s.backup();
    s.save("collections", {{"id", "media"},
                           {"title", "旧文稿"},
                           {"status", "imported"},
                           {"originalText", "原转写"},
                           {"text", "校对稿"},
                           {"sourceUrl", "https://example.com/a"}});
    auto b = s.backup();
    QCOMPARE(b["collections"].toArray().size(), 1);
    BusinessStore target(dir.filePath("t.db"));
    target.restore(b);
    target.restore(before);
    QCOMPARE(
        target.read("collections")[0].toObject()["originalText"].toString(),
        QString("原转写"));
    QCOMPARE(target.read("collections")[0].toObject()["text"].toString(),
             QString("校对稿"));
  }
};
QTEST_GUILESS_MAIN(ResearchV9Tests)
#include "research_v9_tests.moc"
