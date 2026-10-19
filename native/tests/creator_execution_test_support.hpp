#include <QtTest>
#include <QtWidgets>
#include "creator_ai_execution.hpp"
#include "business_store.hpp"
#include "ai_settings_model.hpp"
class Reply:public QNetworkReply {
 QByteArray body; qint64 offset=0;
public:
 Reply(const QNetworkRequest&r,QByteArray b,int delay,QObject*p):QNetworkReply(p),body(b){setRequest(r);setUrl(r.url());setHeader(QNetworkRequest::ContentTypeHeader,"application/json");setHeader(QNetworkRequest::ContentLengthHeader,body.size());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);open(QIODevice::ReadOnly);QTimer::singleShot(delay,this,[this]{setFinished(true);emit readyRead();emit finished();});}
 void abort()override{setError(OperationCanceledError,"cancelled");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return body.size()-offset+QNetworkReply::bytesAvailable();}
 qint64 readData(char*out,qint64 n)override{auto size=qMin(n,qint64(body.size())-offset);if(size<=0)return -1;memcpy(out,body.constData()+offset,size);offset+=size;return size;}
};
class Fake:public QNetworkAccessManager {
public:
 int count=0,delay=1; QString finish="stop",report="{\"summary\":\"受控全文摘要\",\"relations\":[]}";bool mismatch=false;std::function<void(int)> sent;QList<QByteArray> wires;
 QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*body)override{++count;wires.append(body->readAll());QString model=mismatch&&count==2?"other-model":"fixture-model";auto b=QJsonDocument(QJsonObject{{"id","fixture"},{"created",1},{"object","chat.completion"},{"model",model},{"choices",QJsonArray{QJsonObject{{"index",0},{"finish_reason",finish},{"message",QJsonObject{{"role","assistant"},{"content",report}}}}}}}).toJson(QJsonDocument::Compact);if(sent)sent(count);return new Reply(r,b,delay,this);}
};
static QJsonObject fixture(){auto text=QString(11980,QChar(0x4e2d));auto hash=collectionQuality::bodyHash(text);return {{"id","execution-fixture"},{"title","执行文稿"},{"status","completed"},{"text",text},{"channel","原作者"},{"qualitySource",QJsonObject{{"mediaType","video"},{"bodyHash",hash},{"asr",QJsonObject{{"status","complete"}}}}},{"unknownField",17}};}
static QJsonObject preferences(){return aiSettings::preferences({{"provider","openai"},{"model","fixture-model"},{"endpoint","https://api.openai.com/v1/chat/completions"},{"enabledPreference",true},{"timeoutMs",1000}});}
static creatorExecution::Host host(int&credentials,int&grants){return {[&grants](const aiKnowledge::Prepared&p){++grants;auto g=std::make_shared<aiKnowledge::Grant>();g->previewDigest=p.digest();g->expiresAtMs=QDateTime::currentMSecsSinceEpoch()+60000;g->networkAuthorized=g->modelCompatible=g->providerBillingAccepted=true;return g;},[&credentials]{++credentials;return QByteArray("fixture_token_0123456789");}};}
static void writeRow(QString file,QJsonObject row){auto name=QUuid::createUuid().toString();{auto db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(file);if(!db.open())throw std::runtime_error("db");{QSqlQuery q(db);q.prepare("INSERT OR REPLACE INTO records(kind,id,payload) VALUES('collections',?,?)");q.addBindValue(row["id"].toString());q.addBindValue(QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Compact)));if(!q.exec())throw std::runtime_error("fixture insert");}db.close();}QSqlDatabase::removeDatabase(name);}
