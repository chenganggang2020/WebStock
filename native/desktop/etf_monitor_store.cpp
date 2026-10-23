#include "etf_monitor_store.hpp"
#include <QFile>
#include <QFileInfo>
#include <QDir>
#include <QSaveFile>
#include <QLockFile>
#include <QJsonDocument>
namespace etfMonitor {
QJsonObject Store::read()const{require(QFileInfo(path).suffix().compare("json",Qt::CaseInsensitive)==0,"ETF独立档案必须使用专用JSON路径");QFile f(path);if(!f.exists())return emptyArchive();require(f.open(QIODevice::ReadOnly)&&f.size()>0&&f.size()<=8*1024*1024,"ETF独立档案无法读取或超限");auto bytes=f.readAll();QJsonParseError e;auto d=QJsonDocument::fromJson(bytes,&e);require(e.error==QJsonParseError::NoError&&d.isObject(),"ETF独立档案JSON无效");validateArchive(d.object());return d.object();}
void Store::save(const QJsonObject& archive,double expected)const{require(QFileInfo(path).suffix().compare("json",Qt::CaseInsensitive)==0,"ETF独立档案必须使用专用JSON路径");validateArchive(archive);require(archive.value("revision").toDouble()==expected+1,"ETF保存版本无效");require(QDir().mkpath(QFileInfo(path).absolutePath()),"ETF专用目录不可写");QLockFile lock(path+".lock");lock.setStaleLockTime(0);require(lock.tryLock(100),"ETF档案正在被其他写入占用");require(read().value("revision").toDouble()==expected,"ETF档案已变更，请重新读取");auto bytes=QJsonDocument(archive).toJson(QJsonDocument::Compact);QSaveFile f(path);require(f.open(QIODevice::WriteOnly)&&f.write(bytes)==bytes.size()&&f.commit(),"ETF原子保存失败");require(read()==archive,"ETF写后读回验证失败");}
}
