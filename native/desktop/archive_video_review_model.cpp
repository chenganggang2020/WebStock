#include "archive_video_review_model.hpp"
#include <QJsonDocument>
#include <QCryptographicHash>
#include <QFile>
#include <QFileInfo>
#include <QRegularExpression>
#include <cmath>
#include <QDateTime>
#ifdef Q_OS_WIN
#include <windows.h>
static QString physicalPath(QString path,bool directory){HANDLE handle=CreateFileW(reinterpret_cast<LPCWSTR>(path.utf16()),0,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,directory?FILE_FLAG_BACKUP_SEMANTICS:FILE_ATTRIBUTE_NORMAL,nullptr);if(handle==INVALID_HANDLE_VALUE)return {};std::wstring buffer(32768,0);DWORD n=GetFinalPathNameByHandleW(handle,&buffer[0],DWORD(buffer.size()),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);CloseHandle(handle);if(!n||n>=buffer.size())return {};QString result=QString::fromWCharArray(buffer.data(),int(n));if(result.startsWith("\\\\?\\UNC\\",Qt::CaseInsensitive))return {};if(result.startsWith("\\\\?\\"))result=result.mid(4);return result.replace('\\','/');}
#endif
namespace archiveVideoReview {
QByteArray fingerprint(const QJsonObject& row){return QJsonDocument(row).toJson(QJsonDocument::Compact);}
double seekSeconds(const QJsonObject&s,double duration){auto a=s.value("start"),b=s.value("end"); if(!a.isDouble()||!b.isDouble()||!std::isfinite(duration)||duration<=0)return -1; double start=a.toDouble(),end=b.toDouble(); return std::isfinite(start)&&std::isfinite(end)&&start>=0&&end>=start&&end<=duration?start:-1;}
QJsonObject inspect(QJsonObject row,QJsonObject current,QStringList roots){
 QJsonObject out{{"playable",false},{"linkageVerified",false}};
 auto fail=[&](QString reason){out["reason"]=reason;return out;};
 if(!row["id"].isString()||row["id"].toString().isEmpty()||fingerprint(row)!=fingerprint(current))return fail("作品记录版本已改变或缺少身份，请重新打开");
 const auto archive=row.value("archive").toObject();QString path=row.value("assetPath").toString(),sha=archive.value("sha256").toString();double bytes=archive.value("bytes").toDouble(-1);
 const bool legacy=archive.isEmpty()&&row["legacySource"].toString()==QStringLiteral("expert_observations");
 if(legacy){
  auto original=row["legacyOriginal"].toObject();auto id=original["id"].toVariant().toString();auto content=original["external_content_id"].toString();
  if(id.isEmpty()||row["id"].toString()!=QStringLiteral("legacy-webstock:observation:")+id||original["local_asset_path"].toString()!=path||original["media_type"].toString()!=QStringLiteral("video")||!QRegularExpression("^[0-9]{10,24}$").match(content).hasMatch()||QFileInfo(path).fileName()!=content+".mp4")return fail("旧作品身份与原媒体路径不一致；未按标题猜测文件");
 }else if(path.isEmpty()||archive["assetPath"].toString()!=path||!QRegularExpression("^[0-9a-fA-F]{64}$").match(sha).hasMatch()||bytes<=0||bytes>256.0*1024*1024||std::floor(bytes)!=bytes)return fail("缺少有效的媒体归档路径、字节数或 SHA256 证据");
 if(!QFileInfo(path).isAbsolute()||path.startsWith("\\\\")||path.startsWith("//")||path.contains("://"))return fail("只允许本机归档文件");
 QFileInfo info(path);QString canonical=info.canonicalFilePath();if(canonical.isEmpty()||!info.isFile()||info.isSymLink())return fail("归档文件缺失或不是普通文件");
#ifdef Q_OS_WIN
canonical=physicalPath(canonical,false);if(canonical.isEmpty())return fail("归档真实路径不可用或指向网络位置");
#endif
bool allowed=false; for(auto root:roots){QString r=QFileInfo(root).canonicalFilePath(); if(r.isEmpty()||!QFileInfo(r).isDir())continue;
#ifdef Q_OS_WIN
r=physicalPath(r,true);if(!r.isEmpty()&&canonical.startsWith(r+"/",Qt::CaseInsensitive))allowed=true;
#else
if(canonical.startsWith(r+"/"))allowed=true;
#endif
}
 if(!allowed)return fail("文件不在允许的媒体归档目录中");
 QFile file(canonical);if(!file.open(QIODevice::ReadOnly))return fail("归档文件不可读");
 if(legacy)bytes=file.size();
 if(bytes<=0||bytes>256.0*1024*1024||file.size()!=qint64(bytes))return fail("归档字节数不一致或超过256MiB");
 auto before=info.lastModified();QCryptographicHash digest(QCryptographicHash::Sha256);qint64 readBytes=0;
 while(!file.atEnd()){auto chunk=file.read(65536);readBytes+=chunk.size();if(readBytes>qint64(bytes))return fail("核验时文件字节数改变");if(chunk.isEmpty()&&file.error()!=QFileDevice::NoError)return fail("归档读取失败");digest.addData(chunk);}
 const QString observed=QString::fromLatin1(digest.result().toHex());
 if(!legacy&&observed.compare(sha,Qt::CaseInsensitive)!=0)return fail("归档 SHA256 不匹配");
 info.refresh();if(readBytes!=qint64(bytes)||info.size()!=qint64(bytes)||info.lastModified()!=before)return fail("核验时文件发生改变");
 out["playable"]=true;out["path"]=canonical;out["sha256"]=observed;out["bytes"]=bytes;
 out["verificationBasis"]=legacy?"current-file-not-historical-hash":"stored-archive-hash";
 out["reason"]=legacy?"旧作品ID与本机原件匹配；仅核验本次文件摘要，不证明历史文件未变或文稿与画面逐字对应":"归档文件已核验；逐字稿与媒体对应关系未自动核验";return out;
}
}




