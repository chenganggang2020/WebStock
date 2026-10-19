#pragma once
#include "unified_backup.hpp"
#include <QSqlDatabase>
#include <QSqlQuery>
#include <QCryptographicHash>
#include <QThread>
#include <algorithm>
#include <functional>

// Only these two already-owned receipt contracts may coexist in BusinessStore.
// Callers validate schema first and supply each original receipt validator.
namespace knownBusinessReceipts {
inline const QString business="business_restore_receipts",industry="industry_restore_receipts";
inline QString empty(){return QString::fromLatin1(QCryptographicHash::hash(QByteArray{},QCryptographicHash::Sha256).toHex());}
inline bool known(QString name){return name==business||name==industry;}
inline void columns(QSqlDatabase db,QString table){
 using unifiedBackup::need;need(known(table),"未审阅的回执表");QSqlQuery q(db);need(q.exec("PRAGMA table_xinfo("+table+")"),"已知回执列不可读");int at=0;QStringList names{"source_key","payload"};while(q.next()){need(at<2&&q.value(0).toInt()==at&&q.value(1).toString()==names[at]&&q.value(2).toString().compare("TEXT",Qt::CaseInsensitive)==0&&q.value(3).toInt()==(at==0?0:1)&&q.value(4).isNull()&&q.value(5).toInt()==(at==0?1:0)&&q.value(6).toInt()==0,"已知回执列/约束/隐藏布局不符");++at;}need(at==2,"已知回执列不完整");
}
inline void valid(QJsonObject value){
 using namespace unifiedBackup;watchlistBackup::keys(value,{"schema",business,industry});need(value["schema"]=="native-known-business-receipt-bytes/v1","已知回执字节保护格式错误");for(auto name:{business,industry}){auto s=value[name].toObject();watchlistBackup::keys(s,{"present","count","sha256"});auto n=s["count"];need(s["present"].isBool()&&n.isDouble()&&n.toInt(-1)==n.toDouble()&&n.toInt()>=0&&n.toInt()<=10000&&QRegularExpression("^[a-f0-9]{64}$").match(s["sha256"].toString()).hasMatch(),"已知回执字节统计无效");if(!s["present"].toBool())need(n.toInt()==0&&s["sha256"]==empty(),"缺失回执表统计不符");}
}
using Validator=std::function<void(QString,QJsonObject,QString)>;
inline QJsonObject scan(QSqlDatabase db,Validator validate){
 using namespace unifiedBackup;QJsonObject result{{"schema","native-known-business-receipt-bytes/v1"}};
 for(auto table:{business,industry}){QSqlQuery exists(db);exists.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?");exists.addBindValue(table);need(exists.exec()&&exists.next(),"已知回执存在性不可读");bool present=exists.value(0).toInt()==1;exists.finish();QCryptographicHash digest(QCryptographicHash::Sha256);int count=0;
  if(present){columns(db,table);QSqlQuery total(db);need(total.exec("SELECT count(*),coalesce(sum(length(CAST(payload AS BLOB))),0) FROM "+table)&&total.next()&&total.value(0).toLongLong()<=10000&&total.value(1).toLongLong()<=64*1024*1024,"已知回执数量/原字节总量超限，未裁剪");total.finish();QSqlQuery rows(db);need(rows.exec("SELECT source_key,length(CAST(payload AS BLOB)),typeof(source_key),typeof(payload) FROM "+table+" ORDER BY source_key COLLATE BINARY"),"已知回执目录不可读");while(rows.next()){need(!QThread::currentThread()->isInterruptionRequested(),"已知回执读取取消");auto key=rows.value(0).toString();auto length=rows.value(1).toLongLong();need(rows.value(2)=="text"&&rows.value(3)=="text"&&QRegularExpression("^[a-f0-9]{64}$").match(key).hasMatch()&&length>0&&length<=(table==business?8*1024*1024:1024*1024),"已知回执原类型/键/长度无效");QByteArray bytes;bytes.reserve(int(length));for(qint64 start=1;start<=length;start+=65536){QSqlQuery part(db);part.prepare("SELECT substr(CAST(payload AS BLOB),?,65536) FROM "+table+" WHERE source_key=?");part.addBindValue(start);part.addBindValue(key);need(part.exec()&&part.next()&&!part.value(0).isNull(),"已知回执原字节缺块");auto b=part.value(0).toByteArray();need(b.size()==std::min<qint64>(65536,length-start+1),"已知回执原字节长度不完整");bytes+=b;}auto raw=QString::fromUtf8(bytes);need(raw.toUtf8()==bytes,"已知回执UTF8损坏，未替换");watchlistBackup::JsonGate{raw}.run();QJsonParseError error;auto doc=QJsonDocument::fromJson(bytes,&error);need(error.error==QJsonParseError::NoError&&doc.isObject(),"已知回执JSON无效");validate(table,doc.object(),key);digest.addData(key.toLatin1());digest.addData(QByteArray(1,'\0'));digest.addData(QByteArray::number(length));digest.addData(QByteArray(1,'\0'));digest.addData(bytes);digest.addData("\n");++count;}}
  result[table]=QJsonObject{{"present",present},{"count",count},{"sha256",QString::fromLatin1(digest.result().toHex())}};
 }valid(result);return result;
}
}
