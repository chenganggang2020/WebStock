#include "cffex_disclosure_store.hpp"
#include "cffex_disclosure_model.hpp"
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QJsonDocument>
#include <QLockFile>
#include <QSaveFile>
#include <QSet>
#include <stdexcept>
namespace cffexDisclosure {
namespace {void need(bool v,const char*m){if(!v)throw std::runtime_error(m);}QJsonObject empty(){return {{"schema","native-cffex-disclosure-archive/v1"},{"revision",0},{"frames",QJsonArray{}}};}
void verify(QJsonObject a){need(a.size()==3&&a["schema"]=="native-cffex-disclosure-archive/v1"&&a["revision"].isDouble()&&a["revision"].toDouble()>=0&&a["revision"].toDouble()<9007199254740000.&&a["revision"].toDouble()==qint64(a["revision"].toDouble())&&a["frames"].isArray()&&a["frames"].toArray().size()<=20,"不是独立CFFEX档案");for(auto v:a["frames"].toArray()){auto f=v.toObject();need(f.size()==2&&f["json"].isString()&&f["sha256"]==hash(f["json"].toString().toUtf8()),"历史摘要无效");auto d=QJsonDocument::fromJson(f["json"].toString().toUtf8());need(d.isObject(),"历史JSON无效");validate(d.object());}}}
Store::Store(QString file):path(file){need(path.endsWith(".json",Qt::CaseInsensitive),"须专属JSON档案，不打开SQLite/旧库");}
QJsonObject Store::read()const{QFile file(path);if(!file.exists())return empty();need(file.open(QIODevice::ReadOnly)&&file.size()<=16*1024*1024,"档案不可读取或超过16MiB");auto d=QJsonDocument::fromJson(file.readAll());need(d.isObject(),"档案损坏，原文件保留");auto a=d.object();verify(a);return a;}
QJsonObject Store::save(const QJsonObject& report,qint64 revision)const{return saveBatch({report},revision);}
QJsonObject Store::saveBatch(const QJsonArray& reports,qint64 revision)const{
 need(!reports.isEmpty()&&reports.size()<=4,"一批只能保存1至4个披露品种");QJsonArray safe;QSet<QString> products;QString day;
 for(auto value:reports){auto r=validate(value.toObject()),q=r["request"].toObject();need((day.isEmpty()||day==q["date"].toString())&&!products.contains(q["product"].toString()),"批次日期不一致或品种重复");day=q["date"].toString();products.insert(q["product"].toString());safe.append(r);}
 QDir().mkpath(QFileInfo(path).absolutePath());QLockFile lock(path+".lock");need(lock.tryLock(100),"其他入口正在写档案");auto a=read();need(qint64(a["revision"].toDouble())==revision,"历史已改变，请重读，不覆盖");auto frames=a["frames"].toArray();
 for(auto value:safe){auto bytes=QJsonDocument(value.toObject()).toJson(QJsonDocument::Compact);auto frame=QJsonObject{{"json",QString::fromUtf8(bytes)},{"sha256",hash(bytes)}};bool exists=false;for(auto v:frames)exists|=v.toObject()["sha256"]==frame["sha256"];if(!exists)frames.append(frame);}
 need(frames.size()<=20,"档案已满20份；整批未写入，旧历史保留，请先另行归档");a["revision"]=double(revision+1);a["frames"]=frames;verify(a);auto bytes=QJsonDocument(a).toJson(QJsonDocument::Compact);need(bytes.size()<=16*1024*1024,"档案过大，不截断原文");QSaveFile file(path);need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"档案保存失败，旧文件保留");need(read()==a,"档案写后检查失败");return a;
}
}
