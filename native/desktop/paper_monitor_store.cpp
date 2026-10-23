#include "paper_monitor_store.hpp"
#include <stdexcept>
namespace paperMonitor {
namespace {
void need(bool b,const char* m){if(!b)throw std::runtime_error(m);}
QJsonObject empty(){return {{"schema","native-paper-monitor-archive/v1"},{"revision",0},{"records",QJsonArray{}}};}
void verify(const QJsonObject&a){auto r=a.value("revision");double revision=r.toDouble(-1);need(a.size()==3&&a.value("schema")=="native-paper-monitor-archive/v1"&&r.isDouble()&&revision>=0&&revision<=1e9&&revision==qint64(revision)&&a.value("records").isArray()&&a.value("records").toArray().size()<=100&&revision==a.value("records").toArray().size(),"不是完整纸面决策档案");QSet<QString> ids;for(auto v:a.value("records").toArray()){need(v.isObject(),"历史记录无效");auto record=validateRecord(v.toObject());QString prep=record.value("prepared").toObject().value("preparationId").toString();need(!ids.contains(prep),"准备记录已重复处理");ids.insert(prep);}}
}
Store::Store(QString file):path(std::move(file)){need(path.endsWith(".json",Qt::CaseInsensitive),"需要专属JSON历史路径");}
QJsonObject Store::read()const{QFile file(path);if(!file.exists())return empty();need(file.open(QIODevice::ReadOnly)&&file.size()<=32*1024*1024,"档案不可读或超过32MiB");QJsonParseError e;auto doc=QJsonDocument::fromJson(file.readAll(),&e);need(e.error==QJsonParseError::NoError&&doc.isObject(),"档案损坏，原文件保留");auto a=doc.object();verify(a);return a;}
QJsonObject Store::append(const QJsonObject& record,qint64 revision)const{
 auto safe=validateRecord(record);need(QDir().mkpath(QFileInfo(path).absolutePath()),"档案目录不可用");QLockFile lock(path+".lock");need(lock.tryLock(100),"另一个入口正在保存");auto a=read();need(a.value("revision").toDouble()==revision,"历史已变化，请重读后确认");auto rows=a.value("records").toArray();QString prep=safe.value("prepared").toObject().value("preparationId").toString();
 for(auto v:rows){auto old=v.toObject();if(old.value("prepared").toObject().value("preparationId")==prep){need(old==safe,"此准备已确认或拒绝，不能重复改变");return a;}}
 need(rows.size()<100,"历史已满，需先由宿主管理备份；未删除旧记录");rows.append(safe);a["records"]=rows;a["revision"]=double(revision+1);verify(a);auto bytes=QJsonDocument(a).toJson(QJsonDocument::Compact);need(bytes.size()<=32*1024*1024,"历史超过32MiB，未截断或删除");QSaveFile file(path);need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"保存失败，旧历史保留");need(read()==a,"保存后重读校验失败");return a;
}
}
