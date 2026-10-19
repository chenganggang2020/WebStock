#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "archive_video_review_page.hpp"
class ArchiveVideoHostTests:public QObject{
 Q_OBJECT
 static QPushButton*button(QWidget*p,QString text){for(auto*b:p->findChildren<QPushButton*>())if(b->text()==text)return b;return nullptr;}
private slots:
 void videoNative(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode("classic");
  auto root=dir.path()+"/collection-media";QDir().mkpath(root);auto path=root+"/generated-test.mp4";
  auto source=qEnvironmentVariable("NATIVE_VIDEO_FIXTURE");QVERIFY2(QFile::copy(source,path),qPrintable(source));
  QFile file(path);QVERIFY(file.open(QIODevice::ReadOnly));auto bytes=file.readAll();file.close();auto hash=QString(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex());
  auto row=w.businessStore->save("collections",QJsonObject{{"id","native-video-fixture"},{"title","生成的解码定位测试，非平台作品"},{"status","completed"},{"pipelineState","complete"},{"autoEnabled",false},{"assetPath",path},{"text","校对文字不自动绑定时间"},{"originalText","原始文本"},{"archive",QJsonObject{{"assetPath",path},{"bytes",bytes.size()},{"sha256",hash}}},{"asrResult",QJsonObject{{"text","测试识别稿"},{"segments",QJsonArray{QJsonObject{{"start",3},{"end",4},{"text","试定位3秒"}}}}}}});
  w.collectionView();auto*list=w.pages["collection"]->findChild<QListWidget*>("collectionList");QVERIFY(list);for(int i=0;i<list->count();i++)if(list->item(i)->data(Qt::UserRole)=="native-video-fixture")list->setCurrentRow(i);
  auto*entry=w.pages["collection"]->findChild<QPushButton*>("openArchiveVideo");QVERIFY(entry);entry->click();
  auto*p=dynamic_cast<ArchiveVideoReviewPage*>(w.pages.value("archiveVideo"));QVERIFY(p);QVERIFY(!p->playbackState()["ready"].toBool());QVERIFY(!button(p,"播放")->isEnabled());
  button(p,"核验并打开归档")->click();QTRY_VERIFY2_WITH_TIMEOUT(p->playbackState()["ready"].toBool(),qPrintable(p->playbackState()["status"].toString()),5000);QVERIFY(!p->playbackState()["playing"].toBool());
  button(p,"播放")->click();QTRY_VERIFY_WITH_TIMEOUT(p->playbackState()["positionSeconds"].toDouble()>0.3,5000);button(p,"暂停")->click();QTRY_VERIFY(!p->playbackState()["playing"].toBool());
  QVERIFY2(button(p,"试定位 3–4 秒（对应关系未核验）")->isEnabled(),qPrintable(QString::fromUtf8(QJsonDocument(p->playbackState()).toJson())));button(p,"试定位 3–4 秒（对应关系未核验）")->click();QTRY_VERIFY2_WITH_TIMEOUT(qAbs(p->playbackState()["positionSeconds"].toDouble()-3)<.6,qPrintable(QString::fromUtf8(QJsonDocument(p->playbackState()).toJson())),5000);
  if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v37-video.png"));
  QCOMPARE(w.businessStore->read("collections").last().toObject(),row);
  w.home();QVERIFY(!p->playbackState()["ready"].toBool());w.activatePage(p);QVERIFY(!p->playbackState()["ready"].toBool());
  button(p,"核验并打开归档")->click();QTRY_VERIFY2_WITH_TIMEOUT(p->playbackState()["ready"].toBool(),qPrintable(p->playbackState()["status"].toString()),5000);
  auto changed=row;changed["text"]="changed";w.businessStore->save("collections",changed);button(p,"播放")->click();QVERIFY(!p->playbackState()["ready"].toBool());QVERIFY(p->playbackState()["status"].toString().contains("版本"));
  QCOMPARE(QFileInfo(path).size(),qint64(bytes.size()));
 }
};
QTEST_MAIN(ArchiveVideoHostTests)
#include "archive_video_host_tests.moc"

