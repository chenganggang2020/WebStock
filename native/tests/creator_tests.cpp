#include <QtTest>
#include <QTemporaryDir>
#include "business_store.hpp"
#include "creator_analysis.hpp"
#include "creator_index.hpp"

class CreatorTests : public QObject {
  Q_OBJECT
 private slots:
  void uncertaintyIsOptional() {
    const QString body="作者认为光模块使用光芯片，但仍需公告和收入资料进一步核对，不代表已证实供货关系。";
    try {
      auto edge=creatorAnalysis::relation({{"topic","光通信"},{"from","光模块"},{"to","光芯片"},{"relation","使用"},{"quote",body},{"polarity","supports"}},body);
      QCOMPARE(edge["uncertainty"].toString(),QString());
    } catch(const std::exception& error) { QFAIL(error.what()); }
  }
  void crossDocumentIdentityVersionsAndGates() {
    try {
    QTemporaryDir dir;BusinessStore s(dir.filePath("db"));
    const QString text="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
    const QJsonObject edge{{"topic","光通信"},{"from","光模块"},{"to","光芯片"},{"relation","使用"},{"quote",text},{"polarity","supports"},{"uncertainty",""}};
    auto add=[&](QString id,QString author,QString name,QJsonArray edges,QString root=QString(),QString at=QString()){
      auto row=s.save("collections",{{"id",id},{"title",id},{"channel",name},{"sourceProfile",author},{"sourceRootId",root},{"sourceRevisionAt",at},{"text",text},{"originalText",text},{"status","completed"},
        {"asrResult",QJsonObject{{"text",text},{"durationSeconds",10},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",10},{"text",text}}}}}}});
      s.saveCreatorAnalysis(id,collectionQuality::bodyHash(text),"","测试作者观点，非事实",edges);return row;
    };
    QString a="https://www.douyin.com/user/author_A",b="https://www.douyin.com/user/author_B";
    add("one",a,"同名",{edge});add("two",a,"新名字",{});add("three",b,"同名",{edge});
    add("unknown1","","同名",{edge});add("unknown2","","同名",{edge});
    auto reverse=edge;reverse["polarity"]="contradicts";
    auto updated=add("one-v2",a,"新名字",{reverse},"one","2026-10-12T03:00:00Z");
    auto index=creatorIndex::build(s.read("collections"));
    QCOMPARE(index["authors"].toArray().size(),4); // Same name != same author; unknowns remain separate.
    QCOMPARE(index["counts"].toObject()["documents"].toInt(),6);
    QCOMPARE(index["counts"].toObject()["works"].toInt(),5);
    QCOMPARE(index["counts"].toObject()["superseded"].toInt(),1);
    QCOMPARE(index["counts"].toObject()["analyzed"].toInt(),5);
    auto authorKey=index["documents"].toArray()[0].toObject()["authorKey"].toString();
    QVERIFY(!authorKey.isEmpty());
    auto selected=creatorIndex::build(s.read("collections"),authorKey);
    QCOMPARE(selected["counts"].toObject()["documents"].toInt(),3);
    QCOMPARE(selected["counts"].toObject()["empty"].toInt(),1);
    auto relations=selected["relations"].toArray();QCOMPARE(relations.size(),1);
    auto relation=relations[0].toObject();QCOMPARE(relation["documentId"].toString(),QString("one-v2"));
    QCOMPARE(relation["edge"].toObject()["polarity"].toString(),QString("contradicts"));
    QVERIFY(!relation["analysisId"].toString().isEmpty());QCOMPARE(relation["bodyHash"].toString(),collectionQuality::bodyHash(text));
    updated["text"]=text+"正文更正";s.save("collections",updated);
    selected=creatorIndex::build(s.read("collections"),authorKey);
    QCOMPARE(selected["relations"].toArray().size(),0); // Never fall back to the old source version.
    QCOMPARE(selected["counts"].toObject()["blocked"].toInt(),1);
    bool stopped=false;try{creatorIndex::build(s.read("collections"),{},{},[]{return true;});}catch(const std::exception&){stopped=true;}QVERIFY(stopped);
    } catch(const std::exception& error) { QFAIL(error.what()); }
  }
  void revisionsAndEvidence() {
    QTemporaryDir d;BusinessStore s(d.filePath("data"));
    QString text="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
    auto row=s.save("collections",{{"id","c"},{"title","作者文稿"},{"channel","研究作者"},{"status","completed"},{"text",text},{"originalText",text},{"asrResult",QJsonObject{{"text",text},{"durationSeconds",10},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",10},{"text",text}}}}}}});
    QJsonObject edge{{"topic","光通信"},{"from","光模块"},{"to","光芯片"},{"relation","使用"},{"quote",text},{"polarity","supports"},{"uncertainty","作者推断，未外部核验"}};
    auto hash=collectionQuality::bodyHash(text);
    auto a=s.saveCreatorAnalysis("c",hash,"","作者观点",{edge});
    QCOMPARE(a["sourceSnapshot"].toObject()["channel"].toString(),QString("研究作者"));
    auto metadataEdit=row;metadataEdit["channel"]="更正后的来源作者";metadataEdit["sourceUrl"]="https://example.org/updated";s.save("collections",metadataEdit);
    QCOMPARE(s.read("collections")[0].toObject()["creatorAnalyses"].toArray()[0].toObject()["sourceSnapshot"].toObject()["channel"].toString(),QString("研究作者"));
    QVERIFY(creatorAnalysis::sourceLabel(a,metadataEdit).contains("研究作者"));
    QVERIFY(!creatorAnalysis::sourceLabel(a,metadataEdit).contains("更正后的来源作者"));
    auto old=a;old.remove("sourceSnapshot");creatorAnalysis::validate(old);QVERIFY(creatorAnalysis::sourceLabel(old,metadataEdit).contains("缺少来源快照"));
    auto malformed=a;malformed["sourceSnapshot"]=true;QVERIFY_EXCEPTION_THROWN(creatorAnalysis::validate(malformed),std::exception);
    QCOMPARE(creatorAnalysis::current(s.read("collections")[0].toObject())["id"],a["id"]);
    auto bad=edge;bad["quote"]="光模块使用光芯片但不是连续引用";
    QVERIFY_EXCEPTION_THROWN(s.saveCreatorAnalysis("c",hash,a["id"].toString(),"",{bad}),std::exception);
    bad=edge;bad["to"]="未提及公司";
    QVERIFY_EXCEPTION_THROWN(s.saveCreatorAnalysis("c",hash,a["id"].toString(),"",{bad}),std::exception);
    QVERIFY_EXCEPTION_THROWN(s.saveCreatorAnalysis("c",hash,"","",{edge}),std::exception);
    s.save("collections",row); // stale downloader snapshot cannot erase analysis
    QCOMPARE(s.read("collections")[0].toObject()["creatorAnalyses"].toArray().size(),1);
    auto second=s.saveCreatorAnalysis("c",hash,a["id"].toString(),"暂无明确产业关系",{});
    QVERIFY(second["id"]!=a["id"]);QCOMPARE(creatorAnalysis::current(s.read("collections")[0].toObject())["relations"].toArray().size(),0);
    row["text"]=text+"追加更正";s.save("collections",row);
    QVERIFY(creatorAnalysis::current(s.read("collections")[0].toObject()).isEmpty());
    QCOMPARE(s.read("collections")[0].toObject()["creatorAnalyses"].toArray().size(),2);
    QVERIFY_EXCEPTION_THROWN(s.saveCreatorAnalysis("c",hash,second["id"].toString(),"",{edge}),std::exception);
    QVERIFY_EXCEPTION_THROWN(s.saveCreatorAnalysis("c",collectionQuality::bodyHash(row["text"].toString()),"","",{edge}),std::exception);
    BusinessStore restored(d.filePath("restore"));restored.restore(s.backup());
    QCOMPARE(restored.read("collections")[0].toObject()["creatorAnalyses"],s.read("collections")[0].toObject()["creatorAnalyses"]);
  }
  void unknownIdentityAndObservedSourceReturn() {
    QTemporaryDir d;BusinessStore s(d.filePath("db"));
    QString text="作者认为光模块使用光芯片，相关技术路线仍需公告与实际收入交叉验证，不能据此认定供货关系。";
    auto add=[&](QString id,QString root,QString at){
      s.save("collections",{{"id",id},{"title",id},{"channel","作者甲"},{"sourceRootId",root},{"sourceRevisionAt",at},{"status","completed"},{"text",text},{"asrResult",QJsonObject{{"text",text},{"durationSeconds",10},{"segments",QJsonArray{QJsonObject{{"start",0},{"end",10},{"text",text}}}}}}});
      s.saveCreatorAnalysis(id,collectionQuality::bodyHash(text),"","",{QJsonObject{{"topic","光通信"},{"from","光模块"},{"to","光芯片"},{"relation","使用"},{"quote",text},{"polarity","supports"}}});
      for(auto v:s.read("collections"))if(v.toObject()["id"]==id)return v.toObject();return QJsonObject();
    };
    auto first=add("a",{},{}),second=add("b","a","2026-10-12T03:00:00Z");
    auto stable=add("known",{},{});stable["sourceProfile"]="https://www.douyin.com/user/known_author";s.save("collections",stable);auto fresh=s.saveCreatorAnalysis("known",collectionQuality::bodyHash(text),creatorAnalysis::lastId(stable),"",{});stable["creatorAnalyses"]=QJsonArray{fresh};stable["channel"]="作者改名";
    auto stableResult=creatorIndex::build({stable});QCOMPARE(stableResult["counts"].toObject()["analyzed"].toInt(),1);QCOMPARE(stableResult["authors"].toArray()[0].toObject()["aliases"].toArray().size(),2);
    auto result=creatorIndex::build({first,second});QCOMPARE(result["counts"].toObject()["works"].toInt(),1);QCOMPARE(result["relations"].toArray().size(),1);
    auto renamed=first;renamed["channel"]="作者乙";QCOMPARE(creatorIndex::build({renamed})["counts"].toObject()["blocked"].toInt(),1);
    auto old=first;auto history=old["creatorAnalyses"].toArray();auto a=history[0].toObject();a.remove("sourceIdentity");history[0]=a;old["creatorAnalyses"]=history;
    QCOMPARE(creatorIndex::build({old})["counts"].toObject()["blocked"].toInt(),1);QVERIFY(!creatorAnalysis::current(old).isEmpty());
    auto captured=[](QJsonObject row,QString title,QString time){QJsonObject meta{{"title",title},{"description","内容"},{"capturedAt",time},{"coverage","visible_page_only"}};row["sourceMetadata"]=meta;row["sourceFingerprint"]=collectionQuality::bodyHash(title+"\n内容");return row;};
    first=captured(first,"初版","2026-10-12T03:02:00Z");second=captured(second,"修订版","2026-10-12T03:01:00Z");
    result=creatorIndex::build({first,second});QCOMPARE(result["relations"].toArray().size(),1);QCOMPARE(result["relations"].toArray()[0].toObject()["documentId"].toString(),QString("a"));
    second["sourceFingerprint"]="invalid";result=creatorIndex::build({first,second});QCOMPARE(result["relations"].toArray().size(),0);QCOMPARE(result["counts"].toObject()["blocked"].toInt(),2);
    auto conflict=add("c","a","2026-10-12T03:00:00Z");QCOMPARE(creatorIndex::build({add("d",{},{}),conflict,add("e","a","2026-10-12T03:00:00Z")})["counts"].toObject()["blocked"].toInt(),2);
  }
};
QTEST_GUILESS_MAIN(CreatorTests)
#include "creator_tests.moc"
