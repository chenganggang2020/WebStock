#pragma once
#include "stock_profile.hpp"
#include "unified_backup.hpp"
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QSaveFile>
#include <QCryptographicHash>
#include <functional>
#include <QObject>
#include <QPointer>
#include <memory>
#include <mutex>

class StockProfileCache {
 QString directory;std::function<void()> beforeReplace;
 // Cooperating instances share this lock; replacement is not an atomic CAS against external writers.
 inline static std::mutex writerMutex;
public:
 struct Snapshot{QJsonObject packet;QString baseline;};
 explicit StockProfileCache(QString directory,std::function<void()> beforeReplace={}):directory(std::move(directory)),beforeReplace(std::move(beforeReplace)){}
 static QString digest(QByteArray data){return QString::fromLatin1(QCryptographicHash::hash(data,QCryptographicHash::Sha256).toHex());}
 QString filePath(QString id)const{stockResearch::identity(id);return QDir(directory).absoluteFilePath("profile-"+digest(id.toUtf8())+".json");}
 Snapshot owned(QString id)const{
  auto path=filePath(id);if(!QFileInfo::exists(path))return {{},{}};stockProfile::need(QFileInfo(path).isFile()&&!QFileInfo(path).isSymLink(),"主营缓存不是普通文件，原件保留");QFile file(path);stockProfile::need(file.open(QIODevice::ReadOnly)&&file.size()<=8*stockProfile::limit,"主营缓存不可读或超过8MiB");auto raw=file.read(8*stockProfile::limit+1);stockProfile::need(raw.size()<=8*stockProfile::limit&&QString::fromUtf8(raw).toUtf8()==raw,"主营缓存长度/UTF-8无效");watchlistBackup::JsonGate{QString::fromUtf8(raw)}.run();QJsonParseError e;auto doc=QJsonDocument::fromJson(raw,&e);stockProfile::need(e.error==QJsonParseError::NoError&&doc.isObject(),"主营缓存JSON无效");auto wrapper=doc.object();stockProfile::need(wrapper.keys()==QStringList{"id","packet","schema","sha256"}&&wrapper["schema"]=="native-stock-company-profile-cache/v1"&&wrapper["id"]==id,"外来或身份不符的主营缓存，原件保留");unifiedBackup::sealed(wrapper);auto packet=wrapper["packet"].toObject();stockProfile::validate(id,packet);return {packet,digest(raw)};
 }
 Snapshot capture(QString id,QString at)const{if(!stockProfile::supported(id))return {stockProfile::merge(id,{},{},at),{}};auto prior=owned(id);return {prior.packet.isEmpty()?stockProfile::merge(id,{},{},at):stockProfile::cached(prior.packet,at),prior.baseline};}
 void save(QString id,QJsonObject packet,QString before,std::function<bool()>alive)const{
  stockProfile::need(stockProfile::supported(id),"该类型不写公司资料缓存");stockProfile::validate(id,packet);stockProfile::need(alive&&alive(),"主营更新已离开/取消，未保存");std::lock_guard<std::mutex> writerGuard(writerMutex);stockProfile::need(owned(id).baseline==before,"主营缓存已变化，未覆盖较新原件");auto wrapper=unifiedBackup::seal({{"schema","native-stock-company-profile-cache/v1"},{"id",id},{"packet",packet}});auto data=QJsonDocument(wrapper).toJson(QJsonDocument::Compact);stockProfile::need(data.size()<=8*stockProfile::limit,"完整主营缓存超过8MiB");stockProfile::need(QDir().mkpath(directory),"主营缓存目录不可写");QSaveFile file(filePath(id));stockProfile::need(file.open(QIODevice::WriteOnly)&&file.write(data)==data.size(),"主营缓存临时写入失败");try{stockProfile::need(alive()&&owned(id).baseline==before,"主营更新已取消或缓存基线变化，未提交");if(beforeReplace)beforeReplace();stockProfile::need(file.commit(),"主营缓存原子提交失败");}catch(...){file.cancelWriting();throw;}
 }
};

class QNetworkAccessManager;
class StockProfileService final:public QObject {
 struct Job;
 QPointer<QNetworkAccessManager> network;bool allowed,fixture,closed=false;std::shared_ptr<Job> active;
 bool running(const std::shared_ptr<Job>&)const;void consume(const std::shared_ptr<Job>&,QString);
 void partDone(const std::shared_ptr<Job>&,QString,QString error={});void finish(const std::shared_ptr<Job>&);
 void release(const std::shared_ptr<Job>&);
public:
 using Done=std::function<void(QString,QJsonObject,QString)>;
 StockProfileCache cache;
 StockProfileService(QString directory,bool allowed,QObject* parent=nullptr,QNetworkAccessManager* testNetwork=nullptr);
 ~StockProfileService()override;
 void start(QString token,QString id,std::function<bool()> alive,Done);
 void cancel(QString token);void close();
};
