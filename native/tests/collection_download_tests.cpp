#include <QCryptographicHash>
#include <QFile>
#include <QNetworkReply>
#include <QTemporaryDir>
#include <QTimer>
#include <QtTest>

#include "collection_download.hpp"
#include "media_network.hpp"
struct Response {
  QByteArray bytes;
  int code = 200;
  QByteArray type = "video/mp4";
  QString redirect;
  bool hold = false;
  bool metadataOnly = false;
};
class Reply : public QNetworkReply {
 public:
  Reply(const QNetworkRequest& req, Response r, QObject* p)
      : QNetworkReply(p), data(r.bytes) {
    setRequest(req);
    setUrl(req.url());
    open(ReadOnly | Unbuffered);
    setAttribute(QNetworkRequest::HttpStatusCodeAttribute, r.code);
    setHeader(QNetworkRequest::ContentTypeHeader, r.type);
    if (!r.redirect.isEmpty())
      setAttribute(QNetworkRequest::RedirectionTargetAttribute,
                   QUrl(r.redirect));
    if (!r.hold)
      QTimer::singleShot(0, this, [this,r] {
        emit metaDataChanged();
        if (!r.metadataOnly) emit readyRead();
        setFinished(true);
        emit finished();
      });
  }
  void abort() override {
    setError(OperationCanceledError, "cancelled");
    setFinished(true);
    emit finished();
  }
  qint64 bytesAvailable() const override {
    return data.size() + QNetworkReply::bytesAvailable();
  }

 protected:
  qint64 readData(char* p, qint64 n) override {
    if (data.isEmpty()) return -1;
    auto count = qMin(n, qint64(data.size()));
    memcpy(p, data.constData(), size_t(count));
    data.remove(0, count);
    return count;
  }

 private:
  QByteArray data;
};
class Network : public QNetworkAccessManager {
 public:
  QList<Response> responses;
  int requests = 0;

 protected:
  QNetworkReply* createRequest(Operation, const QNetworkRequest& req,
                               QIODevice*) override {
    requests++;
    return new Reply(
        req, responses.isEmpty() ? Response{{}, 500} : responses.takeFirst(),
        this);
  }
};
class DownloadTests : public QObject {
  Q_OBJECT
 private slots:
  void triesSameWorkOfficialMirrorOnceWithoutWritingDeniedBody() {
    Network n; QTemporaryDir d;
    const QByteArray body=QByteArray::fromHex("000000186674797069736f6d")+QByteArray(64,'x');
    n.responses={{"denied",403,"text/html",{},false,true},{body}};
    CollectionDownload job(&n); QSignalSpy ok(&job,&CollectionDownload::completed), bad(&job,&CollectionDownload::failed);
    job.start(QUrl("https://v3.douyinvod.com/a"),d.path(),{}, {QUrl("https://v11.douyinvod.com/a")});
    QTRY_COMPARE_WITH_TIMEOUT(ok.size(),1,1000); QCOMPARE(bad.size(),0); QCOMPARE(n.requests,2);
    QFile file(ok[0][0].toJsonObject()["assetPath"].toString()); QVERIFY(file.open(QIODevice::ReadOnly)); QCOMPARE(file.readAll(),body);
  }
  void mirrorsCannotRelaxLoginRedirectIntegrityOrCancellationChecks() {
    for(const auto response : {Response{"login",401,"text/html"}, Response{"login",200,"text/html"},
        Response{{},302,"video/mp4","https://evil.test/a"}, Response{"bad",200,"video/mp4"}}){
      Network n; QTemporaryDir d; n.responses.append(response); CollectionDownload job(&n);
      QSignalSpy bad(&job,&CollectionDownload::failed);
      job.start(QUrl("https://v3.douyinvod.com/a"),d.path(),{}, {QUrl("https://v11.douyinvod.com/a")});
      QTRY_COMPARE(bad.size(),1); QCOMPARE(n.requests,1); QCOMPARE(QDir(d.path()).entryList(QDir::Files).size(),0);
    }
    Network n; QTemporaryDir d; n.responses.append(Response{{},200,"video/mp4",{},true});
    CollectionDownload job(&n); QSignalSpy bad(&job,&CollectionDownload::failed);
    job.start(QUrl("https://v3.douyinvod.com/a"), d.path(), {}, {QUrl("https://v11.douyinvod.com/a")});
    job.cancel(); QCoreApplication::processEvents();
    QCOMPARE(n.requests,1); QCOMPARE(bad.size(),1); QCOMPARE(QDir(d.path()).entryList(QDir::Files).size(),0);
  }
  void nativeTransportRejectsUnsafeUrlAndCancellationIsTerminal() {
    MediaNetwork network;
    auto reply = network.get(QNetworkRequest(QUrl("http://127.0.0.1/not-permitted")));
    QSignalSpy finished(reply, &QNetworkReply::finished);
    QTRY_COMPARE(finished.size(), 1);
    QVERIFY(reply->error() != QNetworkReply::NoError);
    reply->abort();
    QCOMPARE(finished.size(), 1);
    QCOMPARE(reply->bytesAvailable(), 0);
    delete reply;
  }
  void immediateNativeCancelCannotFinishTwice() {
    MediaNetwork network;
    auto reply = network.get(QNetworkRequest(QUrl("http://127.0.0.1/not-permitted")));
    QSignalSpy finished(reply, &QNetworkReply::finished);
    reply->abort();
    QCOMPARE(finished.size(), 1);
    QCoreApplication::processEvents();
    QCOMPARE(finished.size(), 1);
    delete reply;
  }
  void whitelist() {
    QVERIFY(CollectionDownload::allowed(QUrl("https://v3.douyinvod.com/a")));
    for (auto url :
         {"http://v3.douyinvod.com/a", "https://douyinvod.com.evil.org/a",
          "https://user:secret@v3.douyinvod.com/a", "https://127.0.0.1/a",
          "https://v3.douyinvod.com:444/a"})
      QVERIFY(!CollectionDownload::allowed(QUrl(url)));
  }
  void atomicMediaAndHash() {
    Network n;
    QTemporaryDir d;
    QByteArray media =
        QByteArray::fromHex("000000186674797069736f6d") + QByteArray(128, 'x');
    n.responses.append({media});
    CollectionDownload job(&n);
    QSignalSpy ok(&job, &CollectionDownload::completed),
        bad(&job, &CollectionDownload::failed);
    job.start(QUrl("https://v3.douyinvod.com/test.mp4"), d.path());
    QTRY_COMPARE(ok.size(), 1);
    QCOMPARE(bad.size(), 0);
    QCOMPARE(n.requests, 1);
    auto result = ok[0][0].toJsonObject();
    QFile file(result["assetPath"].toString());
    QVERIFY(file.open(QIODevice::ReadOnly));
    QCOMPARE(file.readAll(), media);
    QCOMPARE(result["sha256"].toString(),
             QString::fromLatin1(
                 QCryptographicHash::hash(media, QCryptographicHash::Sha256)
                     .toHex()));
    QCOMPARE(result["bytes"].toDouble(), double(media.size()));
    QVERIFY(!job.busy());
  }
  void rejectsLoginAndUnsafeRedirect() {
    for (auto response :
         {Response{"<html>login</html>", 200, "text/html"},
          Response{{}, 302, "video/mp4", "http://127.0.0.1/secret"},
          Response{"not mp4", 200, "video/mp4"}}) {
      Network n;
      QTemporaryDir d;
      n.responses.append(response);
      CollectionDownload job(&n);
      QSignalSpy bad(&job, &CollectionDownload::failed);
      job.start(QUrl("https://v3.douyinvod.com/a"), d.path());
      QTRY_COMPARE(bad.size(), 1);
      QCOMPARE(n.requests, 1);
      QCOMPARE(QDir(d.path()).entryList(QDir::Files).size(), 0);
    }
  }
  void hashMismatchAndCancelPreserveExisting() {
    Network n;
    QTemporaryDir d;
    QFile old(d.filePath("old.mp4"));
    QVERIFY(old.open(QIODevice::WriteOnly));
    old.write("keep");
    old.close();
    n.responses.append({QByteArray::fromHex("000000186674797069736f6d") +
                        QByteArray(64, 'x')});
    CollectionDownload job(&n);
    QSignalSpy bad(&job, &CollectionDownload::failed);
    job.start(QUrl("https://v3.douyinvod.com/a"), d.path(), QString(64, '0'));
    QTRY_COMPARE(bad.size(), 1);
    n.responses.append({{}, 200, "video/mp4", {}, true});
    job.start(QUrl("https://v3.douyinvod.com/a"), d.path());
    QVERIFY(job.busy());
    job.cancel();
    QTRY_COMPARE(bad.size(), 2);
    QVERIFY(old.open(QIODevice::ReadOnly));
    QCOMPARE(old.readAll(), QByteArray("keep"));
    QCOMPARE(QDir(d.path()).entryList(QDir::Files).size(), 1);
  }
};
QTEST_GUILESS_MAIN(DownloadTests)
#include "collection_download_tests.moc"
