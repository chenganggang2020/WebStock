#include <QtTest>
#include <QtWidgets>
#include "legacy_data.hpp"
#include "collection_page.hpp"
#include "source_history.hpp"
class QualityLiveTests:public QObject {
  Q_OBJECT
 private slots:
  void realOldManuscriptsReadOnlyAndNativeControls() {
    try {
    QString oldPath=qEnvironmentVariable("QUALITY_OLD_DB"),out=qEnvironmentVariable("QUALITY_OUTPUT");
    QVERIFY(!oldPath.isEmpty()&&!out.isEmpty());QFile old(oldPath);QVERIFY(old.open(QIODevice::ReadOnly));
    auto before=QCryptographicHash::hash(old.readAll(),QCryptographicHash::Sha256);old.close();
    auto bundle=legacydata::readBusiness(oldPath);auto bytes=QJsonDocument(bundle).toJson(QJsonDocument::Compact);QVERIFY(bytes.size()<=business::backupByteLimit);auto rows=bundle["collections"].toArray();QCOMPARE(rows.size(),985);
    QJsonObject gates;QJsonObject selected;int sources=0;
    for(auto v:rows){auto row=v.toObject();auto q=collectionQuality::evaluate(row);QString gate=q["gate"].toString();gates[gate]=gates[gate].toInt()+1;
      QVERIFY(q["humanReview"]=="unreviewed");if(row["qualitySource"].toObject().contains("asr")||row["qualitySource"].toObject().contains("note"))++sources;
      if(selected.isEmpty()&&row["text"].toString().size()>30)selected=row;}
    QVERIFY(!selected.isEmpty());QTemporaryDir temp;auto store=std::make_shared<BusinessStore>(temp.filePath("db"));store->restore(bundle);QCOMPARE(store->read("collections").size(),985);
    std::unique_ptr<QWidget> page(collectionPage(store,nullptr));page->resize(1500,960);page->show();
    auto list=page->findChild<QListWidget*>("collectionList");QCOMPARE(list->count(),985);
    for(int n=0;n<list->count();++n)if(list->item(n)->data(Qt::UserRole)==selected["id"].toString()){list->setCurrentRow(n);break;}
    page->findChild<QTabWidget*>("collectionDocumentTabs")->setCurrentIndex(3);
    QVERIFY(page->findChild<QLabel*>("collectionQualityState")->text().contains("未复核"));
    QApplication::processEvents();QVERIFY(page->grab().save(out+"/windows-real-manuscript-quality.png"));
    sourceHistory::saveNewJson(out+"/quality-real-business.json",bundle);
    sourceHistory::saveNewJson(out+"/quality-real-summary.json",{{"collections",rows.size()},{"bundleBytes",bytes.size()},{"withQualityMetadata",sources},{"gates",gates},{"sourceSha256",QString(before.toHex())},{"nativeWidgetRows",list->count()},{"humanReviewCount",0}});
    QVERIFY(old.open(QIODevice::ReadOnly));QCOMPARE(QCryptographicHash::hash(old.readAll(),QCryptographicHash::Sha256),before);
    }catch(const std::exception& e){QFAIL(e.what());}
  }
};
QTEST_MAIN(QualityLiveTests)
#include "quality_live_tests.moc"
