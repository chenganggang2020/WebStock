#pragma once
#include <QJsonObject>
#include <QJsonArray>
#include <QObject>
#include <QPointer>
#include <QElapsedTimer>
#include <QTimer>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <atomic>
#include <functional>
#include <memory>
#include <stdexcept>
namespace aiKnowledge {
constexpr int MaterialLimit=512*1024,RequestLimit=1024*1024,ResponseLimit=2*1024*1024,ArchiveLimit=12*1024*1024;
class Prepared {
 QJsonObject data; QByteArray wire; QString sha;
 Prepared(QJsonObject,QByteArray);
 friend Prepared prepare(const QJsonObject&,const QString&,const QJsonArray&);
 friend Prepared preparePaper(const QJsonObject&,const QJsonObject&);
 friend Prepared prepareEvidence(const QJsonObject&,const QJsonObject&);
public:
 QJsonObject preview()const{return data;}
 QByteArray body()const{return wire;}
 QString digest()const{return sha;}
};
Prepared prepare(const QJsonObject&,const QString&,const QJsonArray&);
Prepared preparePaper(const QJsonObject& nonSecretPreferences,const QJsonObject& preparedPaper);
Prepared prepareEvidence(const QJsonObject& nonSecretPreferences,const QJsonObject& selectedEvidenceContext);
QString hash(const QByteArray&);
QByteArray bytes(const QJsonObject&);
struct Grant {
 QString previewDigest;
 qint64 expiresAtMs=0;
 bool networkAuthorized=false,modelCompatible=false,providerBillingAccepted=false;
 std::atomic_bool consumed{false},revoked{false};
};
using Credential=std::function<QByteArray()>;
using Done=std::function<void(QJsonObject)>;
// A supplied manager is ALWAYS recorded as local-fixture. Normal use owns a fresh manager.
class Runner:public QObject {
 QNetworkAccessManager* network;
 QPointer<QNetworkReply> reply;
 QTimer deadline;
 QElapsedTimer elapsed;
 QByteArray received,secret;
 QJsonObject attempt;
 Done done;
 bool busy=false,fixture=false;
 void drain();
 void finish(const QString& code={});
public:
 explicit Runner(QObject* parent=nullptr,QNetworkAccessManager* fake=nullptr);
 ~Runner()override;
 bool running()const{return busy;}
 void start(const Prepared&,const std::shared_ptr<Grant>&,Credential,Done);
 void cancel();
};
QString writeArchive(const QString& directory,const QJsonObject& attempt);
QJsonObject readArchive(const QString& file);
}
